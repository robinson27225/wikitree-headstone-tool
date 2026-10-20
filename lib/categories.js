(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['categories'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {
// Finds a cemetery's WikiTree category through the public API's getCategories action, which lists the
// categories of a profile or a Space page. Two places to look:
//   1. the cemetery's own Space page (if one is entered), which is normally in the cemetery category;
//   2. profiles already on WikiTree from this album, which are in the category of the cemetery they are buried in.
const { call } = require('./wikitree');

const CEMETERY_RE = /cemetery|cemeteries|graveyard|churchyard|burial_ground|burying_ground|memorial_park|memorial_gardens/i;
const NOT_RE = /^(Cemeterist|Plotting_Pages|Cemeteries_in_|Cemeteries_of_|Cemetery_Project)/i;
const GENERIC = new Set(['cemetery', 'cemeteries', 'the', 'of', 'and', 'memorial', 'park', 'graveyard', 'churchyard']);

const tokens = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((t) => t && !GENERIC.has(t));

async function getCategories(key) {
  const r = await call({ action: 'getCategories', key }, { fields: false });
  if (r.status && r.status !== 0 && r.status !== '0') return { ok: false, status: String(r.status), categories: [] };
  return { ok: true, categories: r.categories || [] };
}

// The category that looks like this cemetery, best first.
function rankCemeteryCategories(categories, cem) {
  const want = new Set([...tokens(cem.name), ...tokens(cem.city)]);
  return categories
    .filter((c) => CEMETERY_RE.test(c) && !NOT_RE.test(c))
    .map((c) => ({ category: c, overlap: tokens(c.replace(/_/g, ' ')).filter((t) => want.has(t)).length }))
    .sort((a, b) => b.overlap - a.overlap);
}

const underscored = (s) => String(s).trim().replace(/\s+/g, '_');

async function lookup(db, batch) {
  const cem = batch.cemetery || {};
  const notes = [];
  // 1. The cemetery's Space page
  if (cem.space) {
    const key = 'Space:' + underscored(cem.space).replace(/^Space:/i, '');
    const r = await getCategories(key);
    if (!r.ok) notes.push(`Space page ${key} not found on WikiTree (${r.status}).`);
    else {
      const best = rankCemeteryCategories(r.categories, cem)[0];
      if (best) return { category: best.category, source: 'space page', evidence: key, notes };
      notes.push(`Space page ${key} is not in a cemetery category.`);
    }
  }
  // 2. Profiles from this album that are already on WikiTree
  const ids = [...new Set(db.people.filter((p) => p.batchId === batch.id).map((p) => p.wikitreeId || (p.wt && p.wt.state === 'match' ? p.wt.best : '')).filter((id) => /-\d+$/.test(id || '')))].slice(0, 6);
  const tally = new Map();
  for (const id of ids) {
    const r = await getCategories(id);
    if (!r.ok) continue;
    for (const c of rankCemeteryCategories(r.categories, cem)) {
      const t = tally.get(c.category) || { category: c.category, count: 0, overlap: c.overlap };
      t.count++; tally.set(c.category, t);
    }
  }
  const named = !!(tokens(cem.name).length || tokens(cem.city).length);
  const ranked = [...tally.values()].sort((a, b) => b.overlap - a.overlap || b.count - a.count);
  const top = ranked[0];
  // With a cemetery name entered, a category must share a word with it; without one, take the commonest.
  if (top && (!named || top.overlap > 0)) return { category: top.category, source: 'profiles', evidence: `${top.count} of ${ids.length} profile(s) from this album`, notes, candidates: ranked.map((r) => r.category) };
  if (!ids.length && !cem.space) notes.push('No Space page or WikiTree profiles to look at yet. Match or enter some WikiTree IDs, or enter the cemetery Space page.');
  return { category: '', source: '', notes, candidates: ranked.map((r) => r.category) };
}

// Does the plot-map table page exist yet, and which of the two required categories is it missing?
async function pageStatus(title, cemeteryCategory) {
  if (!title) return null;
  const key = 'Space:' + underscored(title).replace(/^Space:/i, '');
  const r = await getCategories(key);
  const need = [cemeteryCategory, 'Plotting_Pages'].filter(Boolean).map((c) => c.replace(/^Category:/i, ''));
  if (!r.ok) return { key, exists: false };
  const have = new Set(r.categories);
  return { key, exists: true, categories: r.categories, missing: need.filter((c) => !have.has(c)) };
}

return { lookup, pageStatus, rankCemeteryCategories };
});
