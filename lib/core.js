(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['core'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {

  // Domain logic shared by the Mac tool and the browser version. `ctx` is {db(), save(), id(), jobs, platform}.
  const { parseInscription } = require('./parse');
  const wikitree = require('./wikitree');
  const places = require('./places');
  const plotmap = require('./plotmap');
  const categories = require('./categories');

  // Turn the lines read from one stone into people on the worklist. Returns how many were added.
  function addPeople(ctx, stone, lines, batch) {
    const db = ctx.db();
    const parsed = parseInscription(lines);
    // Only real disagreements mark a person; small differences that a clear majority of readings settled do not
    const disputed = ((stone.ocr && stone.ocr.disagreements) || []).filter((d) => d.severity !== 'minor').flatMap((d) => d.used.split(' | '));
    for (const p of parsed) {
      if (disputed.some((t) => p.rawLines.some((r) => r.includes(t) || t.includes(r)))) p.flags.push('The text readers disagreed about this stone (see the text below the photo)');
      db.people.push({
        id: ctx.id(), stoneId: stone.id, batchId: batch.id,
        given: p.given, surname: p.surname, maiden: p.maiden, suffix: p.suffix,
        birth: p.born, death: p.died,
        wikitreeId: '', findagrave: '', familysearch: '', notes: '',
        relationship: p.relationship || '', flags: p.flags || [],
        status: 'todo', // todo | done | skip
        wt: { state: 'unchecked', candidates: [] },
        createdAt: new Date().toISOString(),
      });
    }
    return parsed.length;
  }

  async function checkPerson(ctx, p) {
    try {
      p.wt = await wikitree.check(p);
      if (p.wt.state === 'match' && !p.wikitreeId) { p.wikitreeId = p.wt.best; p.wt.autoFilled = true; }
    } catch (e) {
      p.wt = { state: 'error', candidates: [], note: e.message };
    }
    ctx.save();
  }

  function newJob(ctx) {
    const job = { id: ctx.id(), status: 'running', total: 0, done: 0, current: '', log: [] };
    ctx.jobs.set(job.id, job);
    return job;
  }

  function startCheckAll(ctx, onlyUnchecked) {
    const job = newJob(ctx);
    (async () => {
      const todo = ctx.db().people.filter((p) => p.status === 'todo' && !p.wikitreeId.trim() && (!onlyUnchecked || p.wt.state === 'unchecked'));
      job.total = todo.length;
      for (const p of todo) {
        job.current = `${p.given} ${p.surname}`;
        await checkPerson(ctx, p);
        job.done++;
      }
      job.status = 'done'; job.current = '';
    })();
    return job;
  }

  // Fill in an album's cemetery from the photos' GPS: name and place from OpenStreetMap, then the WikiTree Space page and
  // category if they can be found. Fields the user already filled in are kept unless force is set.
  async function findCemeteryFromGps(ctx, batch, { force = false } = {}) {
    const db = ctx.db();
    const pts = db.stones.filter((s) => s.batchId === batch.id && s.lat != null && s.lon != null).map((s) => ({ lat: +s.lat, lon: +s.lon }));
    if (!pts.length) return { found: false, notes: ['None of the photos has GPS, so the cemetery cannot be found from them.'] };
    const c = places.centre(pts);
    const notes = [];
    if (c.spread > 1500) notes.push(`The photos are spread over about ${Math.round(c.spread / 100) / 10} km, so they may not all be in one cemetery. The middle of them was used.`);
    let r;
    try { r = await places.findCemetery(c.lat, c.lon); } catch (e) { return { found: false, notes: ['Could not look up the place: ' + e.message] }; }
    const cem = batch.cemetery;
    for (const k of ['name', 'city', 'county', 'state', 'country']) if (r[k] && (force || !cem[k])) cem[k] = r[k];
    if (!r.name && r.outlineError) notes.push("OpenStreetMap's cemetery map did not answer just now (" + r.outlineError + '). The town, county and state were filled in. Try again in a few minutes, or type the cemetery name.');
    else if (!r.name) notes.push('The photos are not inside a cemetery that OpenStreetMap knows by name. The town, county and state were filled in; type the cemetery name.');
    else if (r.outline === 'near') notes.push('The photos are close to this cemetery but not inside its mapped outline, so check it is the right one.');
    if (r.name) cem.gpsSource = 'OpenStreetMap' + (r.osm ? ' (' + r.osm + ')' : '');
    if (/^Photos \d/.test(batch.name || '') && cem.name) batch.name = cem.name;
    // WikiTree: the cemetery's Space page is usually "<Name> <Town> <ST> USA"; use it only if WikiTree has that page
    if (cem.name && (!cem.space || force)) {
      const title = plotmap.suggestTitle(cem).replace(/ Plot Map Table$/, '');
      try {
        const st = await categories.pageStatus(title, '');
        if (st && st.exists) { cem.space = title.replace(/\s+/g, '_'); notes.push('Found the cemetery\'s WikiTree Space page.'); }
      } catch (e) { /* WikiTree not reachable from here: leave it for the lookup in the plot map dialog */ }
    }
    ctx.save();
    return { found: !!r.name, cemetery: cem, notes, spreadMetres: Math.round(c.spread) };
  }

  return { addPeople, checkPerson, newJob, startCheckAll, findCemeteryFromGps };
});
