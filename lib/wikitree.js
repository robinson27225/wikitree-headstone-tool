(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['wikitree'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {
// Looks people up with the public WikiTree API (no login needed for public profiles).
const API = (globalThis.HW_CONFIG && globalThis.HW_CONFIG.apiBase) || 'https://api.wikitree.com/api.php';
const APP_ID = 'HeadstoneWorklist';
const FIELDS = 'Name,FirstName,MiddleName,LastNameAtBirth,LastNameCurrent,BirthDate,DeathDate,BirthLocation,DeathLocation,Gender';

let lastCall = 0;
async function call(params, { fields = true } = {}) {
  const wait = 350 - (Date.now() - lastCall); // be polite to the API
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = `${API}?${new URLSearchParams({ appId: APP_ID, ...(fields ? { fields: FIELDS } : {}), ...params })}`;
  const res = await fetch(url, typeof window === 'undefined' ? { headers: { 'User-Agent': 'HeadstoneWorklist/1.0' } } : {}); // browsers set their own User-Agent
  if (!res.ok) throw new Error(`WikiTree API HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json[0] : json;
}

const yearOf = (d) => { const y = d && /^(\d{4})/.exec(d); return y && y[1] !== '0000' ? +y[1] : null; };
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();

function score(person, m) {
  let s = 0;
  const reasons = [];
  const first = norm(person.given).split(/\s+/)[0] || '';
  const mFirst = norm(m.FirstName);
  if (first && mFirst) {
    if (first === mFirst) { s += 30; reasons.push('first name'); }
    else if (first[0] === mFirst[0] && (first.length === 1 || mFirst.length === 1 || mFirst.startsWith(first) || first.startsWith(mFirst))) { s += 15; reasons.push('first name (partial)'); }
    else s -= 20;
  }
  const sur = norm(person.surname);
  const maiden = norm(person.maiden);
  const names = [norm(m.LastNameAtBirth), norm(m.LastNameCurrent)];
  if (sur && names.includes(sur)) { s += 25; reasons.push('surname'); }
  else if (maiden && names.includes(maiden)) { s += 20; reasons.push('maiden name'); }
  else s -= 25;
  // Middle names / initials
  const mid = norm(person.given).split(/\s+/).slice(1).join(' ');
  if (mid && m.MiddleName && norm(m.MiddleName)[0] === mid[0]) { s += 5; reasons.push('middle name'); }
  const dy = yearOf(person.death), my = yearOf(m.DeathDate);
  if (dy && my) {
    if (dy === my) { s += 25; reasons.push('death year'); }
    else if (Math.abs(dy - my) <= 1) { s += 15; reasons.push('death year ±1'); }
    else s -= 25;
  }
  const by = yearOf(person.birth), mby = yearOf(m.BirthDate);
  if (by && mby) {
    if (by === mby) { s += 20; reasons.push('birth year'); }
    else if (Math.abs(by - mby) <= 1) { s += 12; reasons.push('birth year ±1'); }
    else s -= 20;
  }
  // Exact full-date agreement is the strongest signal.
  if (person.death && person.death === m.DeathDate && !/-00/.test(person.death)) { s += 10; reasons.push('exact death date'); }
  if (person.birth && person.birth === m.BirthDate && !/-00/.test(person.birth)) { s += 5; reasons.push('exact birth date'); }
  return { score: s, reasons };
}

async function findCandidates(person) {
  const first = (person.given || '').split(/\s+/)[0];
  const surnames = [person.surname, person.maiden].filter(Boolean);
  if (!first || !surnames.length) return { state: 'skipped', candidates: [], note: 'Needs a given name and surname to search.' };
  const seen = new Map();
  for (const ln of surnames) {
    const base = { action: 'searchPerson', FirstName: first, LastName: ln, lastNameMatch: 'all', limit: '25' };
    const dated = { ...base };
    if (person.death && yearOf(person.death)) dated.DeathDate = String(yearOf(person.death));
    // The API only searches birth dates after 1940 inside a logged-in member's watchlist.
    if (person.birth && yearOf(person.birth) && yearOf(person.birth) <= 1940) dated.BirthDate = String(yearOf(person.birth));
    const tries = dated.DeathDate || dated.BirthDate ? [{ ...dated, dateSpread: '3' }, base] : [base];
    for (const params of tries) {
      const r = await call(params);
      if (r.status && r.status !== 0 && r.status !== '0') {
        if (params !== base) continue; // dated search refused: fall back to a names-only search
        throw new Error(`WikiTree: ${r.status}`);
      }
      for (const m of r.matches || []) if (m.Name && !seen.has(m.Name)) seen.set(m.Name, m); // private profiles have no Name
      if (seen.size) break;
    }
  }
  const candidates = [...seen.values()].map((m) => {
    const { score: sc, reasons } = score(person, m);
    return {
      wikitreeId: m.Name, score: sc, reasons,
      name: [m.FirstName, m.MiddleName, m.LastNameAtBirth].filter(Boolean).join(' ') + (m.LastNameCurrent && m.LastNameCurrent !== m.LastNameAtBirth ? ` (${m.LastNameCurrent})` : ''),
      birthDate: m.BirthDate || '', deathDate: m.DeathDate || '', birthLocation: m.BirthLocation || '', deathLocation: m.DeathLocation || '',
    };
  }).filter((c) => c.score >= 15).sort((a, b) => b.score - a.score).slice(0, 6); // hide implausible hits
  return { state: candidates.length ? 'candidates' : 'none', candidates };
}

// A match is "strong" when name and at least one date agree and nobody else comes close.
function classify(result) {
  const c = result.candidates;
  if (!c.length) return { ...result, state: result.state === 'skipped' ? 'skipped' : 'none' };
  const top = c[0];
  const second = c[1];
  const strong = top.score >= 70 && (!second || top.score - second.score >= 20);
  const possible = top.score >= 40;
  return { ...result, state: strong ? 'match' : possible ? 'possible' : 'none', best: strong || possible ? top.wikitreeId : null };
}

async function check(person) {
  const r = classify(await findCandidates(person));
  r.checkedAt = new Date().toISOString();
  return r;
}

return { check, score, classify, call };
});
