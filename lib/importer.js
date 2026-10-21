'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const store = require('./store');
const core = require('./core');
const paddle = require('./ocr_paddle');
const { merge } = require('./ocr_merge');

const OCR_BIN = path.join(__dirname, '..', 'helper', 'headstone_ocr');
const IMG_RE = /\.(jpe?g|png|heic|heif|tiff?)$/i;
const PREVIEWS = path.join(store.DATA, 'previews');
const ALBUMS = path.join(store.DATA, 'albums');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (IMG_RE.test(e.name)) out.push(p);
  }
  return out.sort();
}

async function listAlbums() {
  const script = 'tell application "Photos" to get name of every album';
  const { stdout } = await run('osascript', ['-e', script], { timeout: 60000 });
  return stdout.trim().split(/,\s*/).filter(Boolean);
}

async function exportAlbum(name) {
  const dest = path.join(ALBUMS, name.replace(/[^\w.\- ]+/g, '_'));
  // Our own cache folder: start clean so Photos does not write "_1" copies beside an earlier export.
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const script = [
    'on run argv',
    '  set albumName to item 1 of argv',
    '  set destFolder to POSIX file (item 2 of argv)',
    '  tell application "Photos"',
    '    set theAlbum to first album whose name is albumName',
    '    set theItems to media items of theAlbum',
    '    export theItems to destFolder with using originals',
    '    return (count of theItems) as text',
    '  end tell',
    'end run',
  ].join('\n');
  await run('osascript', ['-e', script, name, dest], { timeout: 30 * 60 * 1000 });
  return dest;
}

async function makePreview(src, stoneId) {
  fs.mkdirSync(PREVIEWS, { recursive: true });
  const out = path.join(PREVIEWS, stoneId + '.jpg');
  await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '1800', src, '--out', out]);
  await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-Z', '240', out, '--out', path.join(PREVIEWS, stoneId + '.thumb.jpg')]); // list thumbnail
  return out;
}

async function ocr(file) {
  const { stdout } = await run(OCR_BIN, [file], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  return JSON.parse(stdout);
}

// PaddleOCR's mistakes change with the image size, so read each photo at a few sizes and let the readings vote.
const PADDLE_SIZES = [1600, 2000, 2400];
async function paddlePasses(stone, file) {
  const tmp = path.join(store.DATA, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const passes = [];
  for (const z of PADDLE_SIZES) {
    const out = path.join(tmp, `${stone.id}_${z}.jpg`);
    try {
      await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', '-Z', String(z), file, '--out', out]);
      const lines = await paddle.read(out);
      if (!lines) return null; // engine not installed
      passes.push(lines);
    } finally { fs.rmSync(out, { force: true }); }
  }
  return passes;
}

// Read a photo with Apple Vision (on the original, which carries the EXIF rotation, GPS and date) and, when it is
// installed, PaddleOCR (at several sizes), then combine all the readings.
async function readStone(stone, file, job) {
  const v = await ocr(file);
  let p = null;
  try { p = await paddlePasses(stone, file); }
  catch (e) { if (job) job.log.push(`${stone.name}: PaddleOCR failed (${String(e.message).split('\n')[0]}), using Apple Vision only`); }
  const m = merge(v.lines, p);
  stone.ocrLines = m.lines;
  stone.ocr = { engines: p ? ['Apple Vision', 'PaddleOCR'] : ['Apple Vision'], passes: p ? p.length : 0, disagreements: m.disagreements };
  stone.inscription = [...m.lines].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.text).join('\n');
  return v;
}

function mtimeStamp(file) {
  const d = fs.statSync(file).mtime;
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${z(d.getMonth() + 1)}:${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

async function processFile(file, batch, job, opts) {
  const db = store.load();
  const existing = db.stones.find((s) => s.file === file);
  if (existing) { job.log.push(`Skipped (already imported): ${path.basename(file)}`); return; }
  const stone = { id: store.id(), batchId: batch.id, file, name: path.basename(file), lat: null, lon: null, takenAt: '', inscription: '', ocrLines: [] };
  try {
    await makePreview(file, stone.id);
    const r = await readStone(stone, file, job);
    stone.lat = r.exif.lat ?? null;
    stone.lon = r.exif.lon ?? null;
    stone.takenAt = r.exif.date || mtimeStamp(file);
    db.stones.push(stone);
    const n = core.addPeople(ctx, stone, stone.ocrLines, batch);
    job.log.push(`${stone.name}: ${n} person(s)${stone.lat == null ? ', no GPS' : ''}`);
    store.save();
    if (opts.checkWikiTree) {
      for (const p of db.people.filter((x) => x.stoneId === stone.id)) await core.checkPerson(ctx, p);
    }
  } catch (e) {
    job.log.push(`${path.basename(file)}: FAILED ${e.message.split('\n')[0]}`);
  }
}

// The context the shared routes work in (see lib/routes.js)
const ctx = { db: store.load, save: store.save, id: store.id, jobs: new Map(), platform: null };

function startImport({ kind, source, batchName, cemetery, checkWikiTree }) {
  const job = core.newJob(ctx);
  (async () => {
    try {
      let dir = source;
      if (kind === 'album') { job.current = 'Exporting from Photos…'; dir = await exportAlbum(source); }
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Folder not found: ' + dir);
      const files = walk(dir);
      job.total = files.length;
      const db = store.load();
      const batch = { id: store.id(), name: batchName || (kind === 'album' ? source : path.basename(dir)), source: `${kind}:${source}`, cemetery: { name: '', space: '', city: '', county: '', state: '', country: db.settings.defaultCountry, ...cemetery }, createdAt: new Date().toISOString() };
      db.batches.push(batch);
      store.save();
      for (const f of files) {
        job.current = path.basename(f);
        await processFile(f, batch, job, { checkWikiTree });
        job.done++;
      }
      if (!batch.cemetery.name) {
        job.current = 'Finding the cemetery from the photos\' GPS…';
        const r = await core.findCemeteryFromGps(ctx, batch);
        job.log.push(r.found ? `Cemetery found from GPS: ${batch.cemetery.name}, ${batch.cemetery.city}` : r.notes[0]);
      }
      job.status = 'done';
    } catch (e) {
      job.status = 'error'; job.error = e.message;
    }
    job.current = '';
  })();
  return job;
}

async function rescan(stoneId) {
  const db = store.load();
  const stone = db.stones.find((s) => s.id === stoneId);
  if (!stone) throw new Error('No such stone');
  const batch = db.batches.find((b) => b.id === stone.batchId);
  if (!fs.existsSync(path.join(PREVIEWS, stone.id + '.jpg'))) await makePreview(stone.file, stone.id);
  await readStone(stone, stone.file, null);
  // Keep anything the user has touched; replace only untouched auto-people.
  db.people = db.people.filter((p) => p.stoneId !== stoneId || p.status !== 'todo' || p.wikitreeId || p.notes || p.edited);
  const keep = new Set(db.people.filter((p) => p.stoneId === stoneId).map((p) => `${p.given} ${p.surname}`.toLowerCase()));
  const before = db.people.length;
  core.addPeople(ctx, stone, stone.ocrLines, batch);
  db.people = db.people.filter((p, i) => i < before || p.stoneId !== stoneId || !keep.has(`${p.given} ${p.surname}`.toLowerCase()));
  store.save();
  return db.people.length - before;
}

function engines() {
  const installed = fs.existsSync(path.join(__dirname, '..', 'node_modules', '@gutenye', 'ocr-node'));
  return [{ name: 'Apple Vision', available: true }, { name: 'PaddleOCR', available: installed, note: installed ? '' : 'not installed (run npm install in the tool folder)' }];
}

const ok = (json) => ({ status: 200, json });
ctx.platform = {
  engines: async () => engines(),
  listAlbums: async () => {
    try { return ok({ albums: await listAlbums() }); }
    catch (e) { return { status: 500, json: { error: 'Could not read Photos albums (allow Automation access to Photos): ' + e.message.split('\n')[0] } }; }
  },
  chooseFolder: () => new Promise((resolve) => execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose a folder of headstone photos")'], (err, out) =>
    resolve(ok(err ? { cancelled: true } : { path: out.trim().replace(/\/$/, '') })))),
  startImport: async (b) => {
    if (!b.source) return { status: 400, json: { error: 'source required' } };
    return ok(startImport({ ...b, source: b.kind === 'folder' ? b.source.replace(/^~(?=\/)/, process.env.HOME) : b.source }));
  },
  rescan,
};

module.exports = { ctx, PREVIEWS };
