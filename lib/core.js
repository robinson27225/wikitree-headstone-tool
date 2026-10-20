(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['core'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {

  // Domain logic shared by the Mac tool and the browser version. `ctx` is {db(), save(), id(), jobs, platform}.
  const { parseInscription } = require('./parse');
  const wikitree = require('./wikitree');

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

  return { addPeople, checkPerson, newJob, startCheckAll };
});
