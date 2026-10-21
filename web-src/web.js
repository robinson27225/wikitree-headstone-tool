// Browser version of the Headstone Photo Tool: everything the Mac version does through its server, done in the page.
//   - the worklist and photos live in this browser (IndexedDB)
//   - photos are read with PaddleOCR running in WebAssembly (see ocr-entry.js), at several sizes, and the readings vote
//   - EXIF GPS and date come from exifr; HEIC photos are converted in the browser when it cannot open them itself
// The same API code as the Mac version (lib/routes.js) answers the page's calls, so both behave alike.
(function () {
  'use strict';
  const HW = window.HW;
  const VERSION = '0.1.0';
  // PaddleOCR's mistakes change with image size, so each photo is read at several sizes and the readings vote.
  const PASS_SIZES = { 3: [1600, 2000, 2400], 5: [1400, 1700, 2000, 2300, 2600], 7: [1300, 1500, 1750, 2000, 2250, 2500, 2800] };
  const passSizes = () => PASS_SIZES[db.settings.passes] || PASS_SIZES[5];
  const FULL_SIZE = 2400, THUMB_SIZE = 240;

  /* ---------- storage (IndexedDB) ---------- */
  const DEFAULTS = () => ({ settings: { photographer: { name: '', wikitreeId: '' }, defaultCountry: 'United States of America' }, batches: [], stones: [], people: [] });
  let db = DEFAULTS();
  let idbPromise = null;
  const urls = new Map(); // "<stoneId>:full|thumb" -> object URL

  function openIdb() {
    if (!idbPromise) idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('headstone-photo-tool', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); req.result.createObjectStore('images'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return idbPromise;
  }
  const tx = (store, mode, fn) => openIdb().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode); const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && r.result); t.onerror = () => reject(t.error);
  }));
  const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
  const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
  const imgPut = (k, blob) => tx('images', 'readwrite', (s) => s.put(blob, k));
  const imgAll = () => openIdb().then((d) => new Promise((resolve, reject) => {
    const out = []; const c = d.transaction('images', 'readonly').objectStore('images').openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else resolve(out); };
    c.onerror = () => reject(c.error);
  }));
  const imgGet = (k) => tx('images', 'readonly', (s) => s.get(k));

  let saveTimer = null, storageError = '';
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { kvSet('db', db).then(() => { storageError = ''; }).catch((e) => { storageError = e.message; console.error('Could not save', e); }); }, 250);
  }
  const id = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');

  const ready = (async () => {
    try {
      const saved = await kvGet('db');
      if (saved) db = { ...DEFAULTS(), ...saved };
      for (const [k, blob] of await imgAll()) urls.set(k, URL.createObjectURL(blob));
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) { storageError = e.message; console.error('Storage unavailable', e); }
  })();

  const ctx = { db: () => db, save, id, jobs: new Map(), platform: null };

  /* ---------- scripts loaded on demand ---------- */
  const scripts = new Map();
  function loadScript(src) {
    if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.append(s);
    }));
    return scripts.get(src);
  }

  /* ---------- images ---------- */
  const isHeic = (f) => /\.hei[cf]$/i.test(f.name) || /hei[cf]/i.test(f.type);
  async function decode(file) {
    try { return await createImageBitmap(file); }
    catch (e) {
      if (!isHeic(file)) throw new Error('This browser cannot open ' + file.name);
      await loadScript('vendor/heic2any.min.js'); // Chrome and Firefox cannot open HEIC themselves
      const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
      return createImageBitmap(Array.isArray(out) ? out[0] : out);
    }
  }
  function drawn(bitmap, maxSide) {
    const sc = maxSide / Math.max(bitmap.width, bitmap.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bitmap.width * sc)); c.height = Math.max(1, Math.round(bitmap.height * sc));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, 0, 0, c.width, c.height);
    return c;
  }
  const toBlob = (canvas, q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
  // Let the page repaint between heavy steps. A message channel is used instead of setTimeout because browsers slow
  // setTimeout to a crawl in background tabs, which would stall a long import if you switch to another tab.
  const channel = new MessageChannel(), waiting = [];
  channel.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
  const tick = () => new Promise((r) => { waiting.push(r); channel.port2.postMessage(0); });

  /* ---------- PaddleOCR in the page ---------- */
  let ocrPromise = null;
  function engine(job) {
    if (!ocrPromise) {
      if (job) job.current = 'Loading the text reader (about 16 MB the first time)…';
      ocrPromise = (async () => {
        await loadScript('vendor/ocr-web.js');
        return window.HWOcr.create(new URL('vendor/', location.href).href);
      })().catch((e) => { ocrPromise = null; throw e; });
    }
    return ocrPromise;
  }
  // The models are trained for Chinese too; on Latin text they sometimes emit a CJK character for a dash.
  const clean = (t) => t.replace(/[⺀-鿿豈-﫿＀-￯]+/g, ' - ').replace(/\s+/g, ' ').trim();
  function toLines(r) {
    return (r.texts || []).filter((t) => t.text && t.text.trim()).map((t) => {
      const xs = t.box.map((p) => p[0]), ys = t.box.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      return { text: clean(t.text), confidence: t.mean, x: x0 / r.resizedImageWidth, y: y0 / r.resizedImageHeight, w: (x1 - x0) / r.resizedImageWidth, h: (y1 - y0) / r.resizedImageHeight };
    }).filter((l) => l.text);
  }
  async function readText(bitmap, job, label) {
    const ocr = await engine(job);
    const passes = [], sizes = passSizes();
    for (let i = 0; i < sizes.length; i++) {
      if (job) job.current = `${label} (reading ${i + 1} of ${sizes.length})`;
      await tick();
      const c = drawn(bitmap, sizes[i]);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      passes.push(toLines(await ocr.detect({ data: d.data, width: d.width, height: d.height })));
    }
    const m = HW.ocr_merge.merge([], passes);
    return { lines: m.lines, ocr: { engines: ['PaddleOCR'], passes: passes.length, disagreements: m.disagreements } };
  }
  const textOf = (lines) => [...lines].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.text).join('\n');

  /* ---------- import ---------- */
  const z2 = (n) => String(n).padStart(2, '0');
  const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}:${z2(d.getMonth() + 1)}:${z2(d.getDate())} ${z2(d.getHours())}:${z2(d.getMinutes())}:${z2(d.getSeconds())}`; };

  async function exif(file) {
    try {
      await loadScript('vendor/exifr.js');
      const [gps, dt] = await Promise.all([window.exifr.gps(file).catch(() => null), window.exifr.parse(file, { pick: ['DateTimeOriginal'], reviveValues: false }).catch(() => null)]);
      return { lat: gps && gps.latitude != null ? gps.latitude : null, lon: gps && gps.longitude != null ? gps.longitude : null, date: dt && dt.DateTimeOriginal ? String(dt.DateTimeOriginal) : '' };
    } catch (e) { return { lat: null, lon: null, date: '' }; }
  }

  async function processFile(file, batch, job, opts) {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (db.stones.some((s) => s.fileKey === key)) { job.log.push(`Skipped (already imported): ${file.name}`); return; }
    const stone = { id: id(), batchId: batch.id, file: '', fileKey: key, name: file.name, lat: null, lon: null, takenAt: '', inscription: '', ocrLines: [] };
    try {
      const [info, bitmap] = await Promise.all([exif(file), decode(file)]);
      stone.lat = info.lat; stone.lon = info.lon; stone.takenAt = info.date || stamp(file.lastModified);
      const full = drawn(bitmap, Math.min(FULL_SIZE, Math.max(bitmap.width, bitmap.height)));
      await imgPut(stone.id + ':full', await toBlob(full, 0.88));
      await imgPut(stone.id + ':thumb', await toBlob(drawn(bitmap, THUMB_SIZE), 0.8));
      for (const k of ['full', 'thumb']) urls.set(`${stone.id}:${k}`, URL.createObjectURL(await imgGet(`${stone.id}:${k}`)));
      const r = await readText(bitmap, job, file.name);
      bitmap.close && bitmap.close();
      stone.ocrLines = r.lines; stone.ocr = r.ocr; stone.inscription = textOf(r.lines);
      db.stones.push(stone);
      const n = HW.core.addPeople(ctx, stone, stone.ocrLines, batch);
      job.log.push(`${stone.name}: ${n} person(s)${stone.lat == null ? ', no GPS' : ''}`);
      save();
      if (opts.checkWikiTree) for (const p of db.people.filter((x) => x.stoneId === stone.id)) { job.current = `${file.name} (checking WikiTree)`; await HW.core.checkPerson(ctx, p); }
    } catch (e) {
      job.log.push(`${file.name}: FAILED ${e.message}`);
    }
  }

  function startImport({ files, cemetery, checkWikiTree }) {
    const job = HW.core.newJob(ctx);
    (async () => {
      try {
        job.total = files.length;
        const name = (cemetery && cemetery.name) || `Photos ${new Date().toLocaleDateString()}`; // renamed to the cemetery once it is found
        const batch = { id: id(), name, source: 'browser', cemetery: { name: '', space: '', city: '', county: '', state: '', country: db.settings.defaultCountry, ...cemetery }, createdAt: new Date().toISOString() };
        db.batches.push(batch);
        save();
        for (const f of files) { job.current = f.name; await processFile(f, batch, job, { checkWikiTree }); job.done++; }
        if (!batch.cemetery.name) {
          job.current = "Finding the cemetery from the photos' GPS…";
          const r = await HW.core.findCemeteryFromGps(ctx, batch);
          job.log.push(r.found ? `Cemetery found from GPS: ${batch.cemetery.name}, ${batch.cemetery.city}` : r.notes[0]);
        }
        job.status = 'done';
      } catch (e) { job.status = 'error'; job.error = e.message; }
      job.current = '';
    })();
    return { status: 200, json: job };
  }

  async function rescan(stoneId) {
    const stone = db.stones.find((s) => s.id === stoneId);
    if (!stone) throw new Error('No such stone');
    const batch = db.batches.find((b) => b.id === stone.batchId);
    const blob = await imgGet(stoneId + ':full');
    if (!blob) throw new Error('The photo is no longer stored in this browser');
    const bitmap = await createImageBitmap(blob);
    const r = await readText(bitmap, null, stone.name);
    stone.ocrLines = r.lines; stone.ocr = r.ocr; stone.inscription = textOf(r.lines);
    // Keep anything the user has touched; replace only untouched auto-people.
    db.people = db.people.filter((p) => p.stoneId !== stoneId || p.status !== 'todo' || p.wikitreeId || p.notes || p.edited);
    const keep = new Set(db.people.filter((p) => p.stoneId === stoneId).map((p) => `${p.given} ${p.surname}`.toLowerCase()));
    const before = db.people.length;
    HW.core.addPeople(ctx, stone, stone.ocrLines, batch);
    db.people = db.people.filter((p, i) => i < before || p.stoneId !== stoneId || !keep.has(`${p.given} ${p.surname}`.toLowerCase()));
    save();
    return db.people.length - before;
  }

  ctx.platform = {
    engines: async () => [{ name: 'PaddleOCR (runs in this browser)', available: true, note: '' }, ...(storageError ? [{ name: 'Browser storage', available: false, note: 'Could not save: ' + storageError }] : [])],
    startImport,
    rescan,
  };

  /* ---------- what the page calls ---------- */
  window.HWWeb = {
    version: VERSION,
    async api(path, body, method) {
      await ready;
      const pathname = path.split('?')[0];
      const r = await HW.routes.handle(ctx, method || (body === undefined ? 'GET' : 'POST'), pathname, body || {});
      if (r.text !== undefined) return { text: r.text, type: r.type, filename: r.filename };
      if (r.status >= 400) throw new Error((r.json && r.json.error) || 'Something went wrong');
      return JSON.parse(JSON.stringify(r.json)); // the page gets copies, never the live worklist
    },
    imageUrl: (stoneId, kind) => urls.get(`${stoneId}:${kind}`) || '',
  };
})();
