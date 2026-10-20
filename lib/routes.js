(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['routes'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {

  // Every /api/* call, shared by the Mac tool's server and the browser version.
  //   handle(ctx, method, pathname, body) -> {status, json} or {status, text, type, filename}
  // ctx: {db(), save(), id(), jobs: Map, platform: {engines, listAlbums, chooseFolder, startImport, rescan}}
  const Citation = require('./citation');
  const plotmap = require('./plotmap');
  const photoref = require('./photoref');
  const categories = require('./categories');
  const core = require('./core');
  const { normalizeDate } = require('./parse');

  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const ok = (json) => ({ status: 200, json });
  const fail = (status, error) => ({ status, json: { error } });

  function citationFor(db, person) {
    const stone = db.stones.find((s) => s.id === person.stoneId) || {};
    const batch = db.batches.find((b) => b.id === person.batchId) || { cemetery: {} };
    return Citation.build(person, stone, batch.cemetery, db.settings.photographer);
  }

  // What a browser extension (e.g. WikiTree Sourcer) reads from the person page.
  function sourcerData(db, person) {
    const stone = db.stones.find((s) => s.id === person.stoneId) || {};
    const batch = db.batches.find((b) => b.id === person.batchId) || { cemetery: {} };
    return {
      schema: 'headstone-worklist/1',
      recordType: 'MonumentalInscription',
      name: { given: person.given, surname: person.surname, maiden: person.maiden, suffix: person.suffix },
      birthDate: person.birth, deathDate: person.death,
      cemetery: batch.cemetery,
      gps: stone.lat != null ? { lat: stone.lat, lon: stone.lon } : null,
      headstonePhoto: stone.photoUrl || '',
      photographed: { by: db.settings.photographer, takenAt: stone.takenAt },
      inscription: stone.inscription,
      ids: { wikitree: person.wikitreeId, findagrave: person.findagrave, familysearch: person.familysearch },
      citation: citationFor(db, person),
    };
  }

  const unavailable = () => fail(404, 'This is not available in this version of the tool.');

  async function handle(ctx, method, pathname, body = {}) {
    const db = ctx.db();
    const pf = ctx.platform || {};
    const m = (re) => pathname.match(re);
    let x;

    if (method === 'GET' && pathname === '/api/state') {
      const stones = db.stones.map(({ ocrLines, inscription, ...s }) => s);
      return ok({ settings: db.settings, batches: db.batches, stones, people: db.people });
    }
    if (method === 'POST' && pathname === '/api/settings') {
      db.settings = { ...db.settings, ...body, photographer: { ...db.settings.photographer, ...(body.photographer || {}) } };
      ctx.save();
      return ok(db.settings);
    }
    if (method === 'GET' && pathname === '/api/engines') return pf.engines ? ok({ engines: await pf.engines() }) : unavailable();
    if (method === 'GET' && pathname === '/api/albums') return pf.listAlbums ? pf.listAlbums() : unavailable();
    if (method === 'POST' && pathname === '/api/choose-folder') return pf.chooseFolder ? pf.chooseFolder() : unavailable();
    if (method === 'POST' && pathname === '/api/import') return pf.startImport ? pf.startImport(body) : unavailable();
    if (method === 'POST' && pathname === '/api/check-all') return ok(core.startCheckAll(ctx, !!body.onlyUnchecked));
    if ((x = m(/^\/api\/jobs\/(\w+)$/))) {
      const j = ctx.jobs.get(x[1]);
      return j ? ok(j) : fail(404, 'no such job');
    }
    if ((x = m(/^\/api\/batches\/(\w+)$/)) && method === 'POST') {
      const batch = db.batches.find((b) => b.id === x[1]);
      if (!batch) return fail(404, 'no such batch');
      if (body.name != null) batch.name = body.name;
      if (body.cemetery) {
        const before = batch.cemetery.category;
        batch.cemetery = { ...batch.cemetery, ...body.cemetery };
        if (body.cemetery.category !== undefined && body.cemetery.category !== before) batch.cemetery.categorySource = body.cemetery.category ? 'entered by you' : '';
      }
      ctx.save();
      return ok(batch);
    }
    if ((x = m(/^\/api\/batches\/(\w+)\/wikitree-check$/)) && method === 'POST') {
      const batch = db.batches.find((b) => b.id === x[1]);
      if (!batch) return fail(404, 'no such album');
      try {
        const cem = batch.cemetery;
        let found = null;
        if (!cem.category || body.force) {
          found = await categories.lookup(db, batch);
          if (found.category) { cem.category = 'Category:' + found.category; cem.categorySource = found.source; ctx.save(); }
        }
        const category = cem.category || plotmap.suggestCategory(cem);
        const title = cem.tablePage || plotmap.suggestTitle(cem);
        return ok({ category: cem.category || '', source: cem.categorySource || (cem.category ? 'entered by you' : ''), lookup: found, page: await categories.pageStatus(title, category) });
      } catch (e) { return fail(502, 'WikiTree lookup failed: ' + e.message); }
    }
    if ((x = m(/^\/api\/batches\/(\w+)\/plotmap(\.tsv)?$/)) && method === 'GET') {
      try {
        const r = plotmap.build(db, x[1]);
        return x[2] ? { status: 200, text: r.tsv, type: 'text/tab-separated-values', filename: 'plot-map-import.tsv' } : ok(r);
      } catch (e) { return fail(404, e.message); }
    }
    if (method === 'POST' && pathname === '/api/people') {
      const stone = db.stones.find((s) => s.id === body.stoneId);
      if (!stone) return fail(400, 'stoneId required');
      const p = { id: ctx.id(), stoneId: stone.id, batchId: stone.batchId, given: '', surname: '', maiden: '', suffix: '', birth: '', death: '', wikitreeId: '', findagrave: '', familysearch: '', notes: '', relationship: '', flags: ['added manually'], status: 'todo', wt: { state: 'unchecked', candidates: [] }, edited: true, createdAt: new Date().toISOString() };
      db.people.push(p); ctx.save();
      return ok(p);
    }
    if ((x = m(/^\/api\/people\/(\w+)(?:\/(\w+(?:\.json)?))?$/))) {
      const p = db.people.find((q) => q.id === x[1]);
      if (!p) return fail(404, 'no such person');
      const sub = x[2];
      if (method === 'GET' && !sub) {
        const stone = db.stones.find((s) => s.id === p.stoneId);
        const batch = db.batches.find((s) => s.id === p.batchId);
        const siblings = db.people.filter((q) => q.stoneId === p.stoneId && q.id !== p.id).map((q) => ({ id: q.id, given: q.given, surname: q.surname, birth: q.birth, death: q.death }));
        return ok({ person: p, stone, batch, siblings, photoPage: photoref.imagePageUrl(stone && stone.photoUrl), citation: citationFor(db, p), settings: db.settings });
      }
      if (method === 'GET' && sub === 'citation') return ok({ citation: citationFor(db, p) });
      if (method === 'GET' && sub === 'sourcer.json') return ok(sourcerData(db, p));
      if (method === 'POST' && sub === 'check') { await core.checkPerson(ctx, p); return ok(p); }
      if (method === 'POST' && !sub) {
        const allowed = ['given', 'surname', 'maiden', 'suffix', 'birth', 'death', 'wikitreeId', 'findagrave', 'familysearch', 'notes', 'status'];
        for (const k of allowed) if (body[k] !== undefined) p[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
        const bad = [];
        for (const k of ['birth', 'death']) if (body[k] !== undefined) { const n = normalizeDate(body[k]); if (n === null) bad.push(k); else p[k] = n; }
        if (body.findagrave !== undefined) { const f = String(body.findagrave); const mm = f.match(/memorial\/(\d+)/) || f.match(/^\s*(\d+)\s*$/); p.findagrave = mm ? mm[1] : f.trim(); }
        if (body.familysearch !== undefined) { const f = String(body.familysearch); const mm = f.match(/\b([A-Z0-9]{4}-[A-Z0-9]{3,4})\b/i); p.familysearch = mm ? mm[1].toUpperCase() : f.trim(); }
        if (body.wikitreeId !== undefined) p.wikitreeId = String(body.wikitreeId).replace(/^.*wikitree\.com\/wiki\//i, '').replace(/[\[\]]/g, '').trim();
        p.edited = true;
        ctx.save();
        return ok({ person: p, citation: citationFor(db, p), badDates: bad });
      }
      if (method === 'DELETE' && !sub) {
        db.people = db.people.filter((q) => q.id !== p.id); ctx.save();
        return ok({ ok: true });
      }
    }
    if ((x = m(/^\/api\/stones\/(\w+)\/rescan$/)) && method === 'POST') {
      if (!pf.rescan) return unavailable();
      try { return ok({ added: await pf.rescan(x[1]) }); } catch (e) { return fail(500, e.message); }
    }
    if ((x = m(/^\/api\/stones\/(\w+)$/)) && method === 'GET') {
      const s = db.stones.find((q) => q.id === x[1]);
      return s ? ok(s) : fail(404, 'no such stone');
    }
    if ((x = m(/^\/api\/stones\/(\w+)$/)) && method === 'POST') {
      const s = db.stones.find((q) => q.id === x[1]);
      if (!s) return fail(404, 'no such stone');
      if (body.photoUrl !== undefined) s.photoUrl = photoref.normalize(body.photoUrl);
      for (const k of ['section', 'plot', 'row', 'monument', 'reference']) if (body[k] !== undefined) s[k] = String(body[k]).trim();
      for (const k of ['lat', 'lon']) if (body[k] !== undefined) s[k] = body[k] === '' || body[k] === null ? null : Number(body[k]);
      if (body.takenAt !== undefined) s.takenAt = body.takenAt;
      ctx.save();
      return ok(s);
    }
    if (method === 'GET' && pathname === '/api/export.csv') {
      const cols = ['Status', 'Given', 'Surname', 'Maiden', 'Birth', 'Death', 'WikiTree ID', 'Find a Grave', 'FamilySearch', 'Headstone photo', 'Cemetery', 'Lat', 'Lon', 'Photo', 'Citation', 'Notes'];
      const rows = db.people.map((p) => {
        const s = db.stones.find((q) => q.id === p.stoneId) || {};
        const b = db.batches.find((q) => q.id === p.batchId) || { cemetery: {} };
        return [p.status, p.given, p.surname, p.maiden, p.birth, p.death, p.wikitreeId, p.findagrave, p.familysearch, s.photoUrl, b.cemetery.name, s.lat, s.lon, s.name, citationFor(db, p), p.notes].map(csvCell).join(',');
      });
      return { status: 200, text: [cols.map(csvCell).join(','), ...rows].join('\n'), type: 'text/csv', filename: 'headstone-worklist.csv' };
    }
    if (method === 'GET' && pathname === '/api/backup.json') {
      const copy = { ...db, stones: db.stones.map(({ ocrLines, ...s }) => s) };
      return { status: 200, text: JSON.stringify(copy, null, 1), type: 'application/json', filename: 'headstone-worklist-backup.json' };
    }
    return fail(404, 'not found');
  }

  return { handle, citationFor };
});
