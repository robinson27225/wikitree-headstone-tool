(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['parse'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {
// Turns OCR lines from a headstone photo into candidate people.
// Input lines: [{text, confidence, x, y, w, h}] (normalised 0..1, y from top).

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// Words that appear on stones but are not names.
const STOP = new Set(('beloved husband wife father mother son daughter brother sister grandfather grandmother grandson ' +
  'granddaughter infant baby child of and in loving memory rest peace rip at born died death birth age aged years yrs ' +
  'yr days mos months gone home sleeping asleep forever remembered mom dad papa mama family our dear sweet ' +
  'a the to he she god lord jesus christ with his her their they who was is for we you mr mrs miss ' +
  'pvt sgt cpl lt capt col maj gen co inf cav regt reg army navy usn usa usmc korea vietnam wwi wwii world war ' +
  'veteran company infantry mason masons lodge son-of daughter-of wife-of husband-of will thy thee ' +
  'father-of mother-of brother-of sister-of cherished treasured always together').split(/\s+/));
const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'jr.', 'sr.', 'esq']);
const PARTICLES = new Set(['van', 'von', 'de', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'st', 'st.', 'ten', 'ter', 'der', 'den', 'mac', 'mc']);

function fixDigits(s) {
  // OCR often reads digits as letters inside year-like tokens.
  return s.replace(/\b[0-9OolI|Z]{4}\b/g, (t) => {
    if (!/[0-9]/.test(t)) return t;
    return t.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/Z/g, '2');
  });
}

function pad(n, w) { return String(n).padStart(w, '0'); }
function isoDate(y, m, d) { return `${pad(y, 4)}-${pad(m || 0, 2)}-${pad(d || 0, 2)}`; }
const validYear = (y) => y >= 1600 && y <= new Date().getFullYear() + 1;

// Find date expressions in a string. Returns [{iso, index, end, text}] in order of appearance.
function findDates(raw) {
  const s = fixDigits(raw);
  const found = [];
  const taken = [];
  const overlaps = (a, b) => taken.some(([x, y]) => a < y && b > x);
  const add = (m, iso) => {
    const a = m.index, b = m.index + m[0].length;
    if (overlaps(a, b)) return;
    taken.push([a, b]);
    found.push({ iso, index: a, end: b, text: m[0] });
  };
  let m;
  // 5 Jan 1905 / 5th January, 1905
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTH_RE})\\.?,?\\s*(\\d{4})\\b`, 'gi');
  while ((m = dmy.exec(s))) if (validYear(+m[3])) add(m, isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  // Jan 5, 1905
  const mdy = new RegExp(`\\b(${MONTH_RE})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})\\b`, 'gi');
  while ((m = mdy.exec(s))) if (validYear(+m[3])) add(m, isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
  // Jan 1905
  const my = new RegExp(`\\b(${MONTH_RE})\\.?,?\\s*(\\d{4})\\b`, 'gi');
  while ((m = my.exec(s))) if (validYear(+m[2])) add(m, isoDate(+m[2], MONTHS[m[1].toLowerCase()], 0));
  // 01/05/1905 or 1-5-1905 (US order unless the first part cannot be a month)
  const num = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/g;
  while ((m = num.exec(s))) {
    let a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) [a, b] = [b, a];
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && validYear(+m[3])) add(m, isoDate(+m[3], a, b));
  }
  // Bare year
  const yr = /(?<![\d])(1[6-9]\d\d|20\d\d)(?![\d])/g;
  while ((m = yr.exec(s))) if (validYear(+m[1])) add(m, isoDate(+m[1], 0, 0));
  return found.sort((a, b) => a.index - b.index);
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s\-'.(])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, (x) => x.toUpperCase())
    .replace(/\b(Van|Von|De|Del|Della|Di|Da|Du|La|Le|Der|Den|Ten|Ter)\s/g, (x) => x.toLowerCase());
}

function isMostlyLetters(s) {
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  return letters >= 2 && letters / s.replace(/\s/g, '').length >= 0.8;
}

// A line "looks like a name" if it is alphabetic and not entirely made of stop words.
function nameTokens(line) {
  const cleaned = line.replace(/[“”"*†‡✝]/g, '').replace(/[,;:]+$/g, '').trim();
  if (!cleaned || /\d/.test(cleaned) || !isMostlyLetters(cleaned)) return null;
  const toks = cleaned.split(/\s+/).filter(Boolean);
  const meaningful = toks.filter((t) => !STOP.has(t.toLowerCase().replace(/[.,]/g, '')));
  if (!meaningful.length) return null;
  if (meaningful.length < toks.length / 2) return null; // mostly filler words
  if (toks.length > 6) return null;
  return toks;
}

function splitName(toks) {
  // toks: ['MARY','ANN','TAYLOR'] -> {given:'Mary Ann', surname:'Taylor'}
  let t = toks.map((x) => x.replace(/,$/, ''));
  let suffix = '';
  while (t.length > 1 && SUFFIX.has(t[t.length - 1].toLowerCase())) suffix = ' ' + t.pop();
  if (t.length === 1 || /^[A-Za-z]\.?$/.test(t[t.length - 1])) return { given: titleCase(t.join(' ')), surname: '', suffix: suffix.trim() };
  let idx = t.length - 1;
  while (idx > 1 && PARTICLES.has(t[idx - 1].toLowerCase())) idx--;
  return {
    given: titleCase(t.slice(0, idx).join(' ')),
    surname: titleCase(t.slice(idx).join(' ')),
    suffix: suffix.trim(),
  };
}

// Pull "(Smith)" or "nee Smith" out of a name line.
function extractMaiden(line) {
  let maiden = '';
  let rest = line;
  let m = rest.match(/\(\s*([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+)?)\s*\)/);
  if (m && !/\d/.test(m[1]) && !STOP.has(m[1].toLowerCase())) {
    maiden = titleCase(m[1]);
    rest = rest.replace(m[0], ' ');
  } else if ((m = rest.match(/\b(?:n[ée]e|born)\s+([A-Za-z'\-]+)/i))) {
    maiden = titleCase(m[1]);
    rest = rest.replace(m[0], ' ');
  }
  return { maiden, rest: rest.replace(/\s+/g, ' ').trim() };
}

// Split lines into column groups when a stone carries two people side by side.
function columnize(lines) {
  if (lines.length < 4) return [lines];
  const centers = lines.map((l) => l.x + l.w / 2).sort((a, b) => a - b);
  let best = 0, at = -1;
  for (let i = 1; i < centers.length; i++) {
    const gap = centers[i] - centers[i - 1];
    if (gap > best) { best = gap; at = i; }
  }
  if (best < 0.18) return [lines];
  const cut = (centers[at] + centers[at - 1]) / 2;
  const left = lines.filter((l) => l.x + l.w / 2 < cut);
  const right = lines.filter((l) => l.x + l.w / 2 >= cut);
  // Only a real column split if both sides have several lines and share vertical range.
  if (left.length < 2 || right.length < 2) return [lines];
  // A centred heading (e.g. the family surname) spans both sides; keep those with the left column.
  return [left, right];
}

function parseBlock(inLines) {
  // Reading order: top to bottom, but lines in the same row go left to right.
  const lines = [...inLines].sort((a, b) => a.y - b.y);
  const ordered = [];
  for (const l of lines) {
    const last = ordered[ordered.length - 1];
    ordered.push(l);
    if (last && Math.abs(l.y - last.y) < 0.5 * Math.min(l.h, last.h)) {
      // same row: put the leftmost first
      const i = ordered.length - 1;
      if (ordered[i].x < ordered[i - 1].x) [ordered[i], ordered[i - 1]] = [ordered[i - 1], ordered[i]];
    }
  }
  const all = [];
  let familySurname = '';
  let cur = null;
  let lastDated = null;
  const items = ordered.filter((l) => l.text.trim());

  // A much larger one-word line above the others is a family surname heading.
  if (items.length >= 3) {
    const first = nameTokens(items[0].text.trim());
    const rest = items.slice(1);
    const avgH = rest.reduce((a, l) => a + l.h, 0) / rest.length;
    if (first && first.length === 1 && !findDates(items[0].text).length && items[0].h >= 1.3 * avgH && nameTokens(items[1].text.trim())) {
      familySurname = titleCase(first[0]);
      items.shift();
    }
  }

  // One OCR line can hold several people side by side: "1872-1931 / 1859-1927", or "ANCELINA PIETRO" under a
  // family heading. Cut such lines into pieces laid out across the original box so each piece can pair with its own.
  const piece = (L, from, to, text) => ({ ...L, text, x: L.x + (L.w * from) / L.text.length, w: (L.w * (to - from)) / L.text.length });
  let expanded = [];
  for (const L of items) {
    const ds = findDates(L.text);
    if (ds.length >= 4 && ds.length % 2 === 0) {
      for (let i = 0; i < ds.length; i += 2) {
        const from = i === 0 ? 0 : ds[i].index, to = i + 2 >= ds.length ? L.text.length : ds[i + 2].index;
        expanded.push(piece(L, from, to, L.text.slice(from, to)));
      }
    } else expanded.push(L);
  }
  let pairedByOrder = expanded.length > items.length;
  // Stray digits on the stone ('V1889') look like a date line. When there are year ranges, count only those.
  const rangeLines = expanded.filter((L) => findDates(L.text).length >= 2).length;
  const dateLineCount = rangeLines >= 2 ? rangeLines : expanded.filter((L) => findDates(L.text).length).length;
  const nameLines = expanded.filter((L) => !findDates(L.text).length && nameTokens(extractMaiden(L.text.trim()).rest));
  if (familySurname && nameLines.length === 1 && dateLineCount >= 2) {
    const L = nameLines[0];
    const toks = [...L.text.matchAll(/\S+/g)];
    if (toks.length === dateLineCount && toks.every((t) => nameTokens(t[0]))) {
      expanded = expanded.flatMap((E) => (E === L ? toks.map((t) => piece(L, t.index, t.index + t[0].length, t[0])) : [E]));
      pairedByOrder = true;
    }
  }
  items.splice(0, items.length, ...expanded);

  const newPerson = (L, o) => {
    const p = Object.assign({ given: '', surname: '', suffix: '', maiden: '', dated: false, born: '', died: '', relationship: '', rawLines: [], flags: [], y: L.y, cx: L.x + L.w / 2, h: L.h }, o);
    all.push(p);
    return p;
  };

  let pendingRel = false;
  for (const L of items) {
    const raw = L.text.trim();
    const dates = findDates(raw);
    const nameLike = !dates.length && nameTokens(extractMaiden(raw).rest);
    if (nameLike) {
      const { maiden, rest } = extractMaiden(raw);
      const toks = nameTokens(rest);
      if (!toks) continue;
      // "WIFE OF JOHN" style lines are not new people.
      if (/\b(wife|husband|son|daughter|father|mother|brother|sister)\s+of\b/i.test(raw) || pendingRel) {
        pendingRel = /\bof\s*$/i.test(raw);
        if (cur) cur.relationship = (cur.relationship ? cur.relationship + ' ' : '') + raw;
        continue;
      }
      const meaningful = toks.filter((t) => !STOP.has(t.toLowerCase()));
      // Under a family heading, lines are given names unless they already end in that surname.
      const endsInFamily = familySurname && meaningful[meaningful.length - 1].toLowerCase() === familySurname.toLowerCase();
      const sp = familySurname && !endsInFamily
        ? { given: titleCase(meaningful.join(' ')), surname: '', suffix: '' }
        : splitName(meaningful);
      // A surname on its own line right after the given names ("FLORA" / "WHITFIELD").
      if (cur && !cur.dated && !cur.surname && cur.given && !sp.surname && meaningful.length === 1 && !familySurname) {
        cur.surname = sp.given; cur.rawLines.push(raw); continue;
      }
      cur = newPerson(L, { given: sp.given, surname: sp.surname || familySurname, suffix: sp.suffix, maiden, rawLines: [raw] });
      if (!sp.surname && familySurname) cur.flags.push('surname from family heading');
      continue;
    }
    if (dates.length) {
      // Attach to the nearest undated name above this line, else to the person who last got a date.
      const above = all.filter((q) => !q.dated && q.y < L.y);
      let target = null;
      if (above.length) {
        const maxY = Math.max(...above.map((q) => q.y));
        const row = above.filter((q) => maxY - q.y < 0.6 * q.h + 0.01);
        target = row.sort((a, b) => Math.abs(a.cx - (L.x + L.w / 2)) - Math.abs(b.cx - (L.x + L.w / 2)))[0];
      }
      target = target || lastDated || cur || newPerson(L, { surname: familySurname });
      target.rawLines.push(raw);
      target.dated = true;
      assignDates(target, raw, dates);
      lastDated = cur = target;
      continue;
    }
    if (cur && /\bof\b|beloved|wife|husband/i.test(raw)) cur.relationship = (cur.relationship ? cur.relationship + ' ' : '') + raw;
    if (/\bof\s*$/i.test(raw)) pendingRel = true;
    if (cur) cur.rawLines.push(raw);
  }
  for (const p of all) {
    if (dateLineCount > all.length && all.length) p.flags.push('The stone has more date ranges than names found: there may be another person here');
    if (pairedByOrder && p.rawLines.length) p.flags.push('names and dates paired left to right, check the pairing');
    if (p.born && p.died && p.born > p.died) { [p.born, p.died] = [p.died, p.born]; p.flags.push('dates were out of order, swapped'); }
    if (p.born && p.died && +p.died.slice(0, 4) - +p.born.slice(0, 4) > 110) p.flags.push('lifespan over 110 years, check dates');
  }
  return all.filter((p) => p.given || p.born || p.died);
}

function assignDates(p, raw, dates) {
  const keyBefore = (d) => {
    const before = raw.slice(0, d.index).toLowerCase();
    if (/(born|birth|b\.|\bb\b|\*)\s*[:.]?\s*$/.test(before)) return 'b';
    if (/(died|death|d\.|\bd\b|†|✝|\+)\s*[:.]?\s*$/.test(before)) return 'd';
    return '';
  };
  for (const d of dates) {
    const k = keyBefore(d);
    if (k === 'b' && !p.born) p.born = d.iso;
    else if (k === 'd' && !p.died) p.died = d.iso;
    else if (!k) {
      if (p.assumedDeath && !p.born) {
        // Dates stacked on separate lines: the earlier "death" was really the birth.
        p.born = p.died; p.died = d.iso; p.assumedDeath = false;
        p.flags = p.flags.filter((f) => f !== 'single date assumed to be death');
      } else if (!p.born && dates.length > 1 && d === dates[0]) p.born = d.iso;
      else if (!p.died && (dates.length > 1 || p.born)) p.died = d.iso;
      else if (!p.born && !p.died) { p.died = d.iso; p.assumedDeath = true; p.flags.push('single date assumed to be death'); }
    }
  }
}

function parseInscription(lines, opts = {}) {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const cols = columnize(sorted);
  const people = [];
  for (const col of cols) {
    const colSorted = [...col].sort((a, b) => a.y - b.y);
    for (const p of parseBlock(colSorted)) {
      const confs = lines.filter((l) => p.rawLines.includes(l.text.trim())).map((l) => l.confidence);
      p.confidence = confs.length ? Math.min(...confs) : 0;
      if (p.confidence && p.confidence < 0.5) p.flags.push('low OCR confidence');
      if (!p.surname) p.flags.push('no surname found');
      if (!p.died && !p.born) p.flags.push('no dates found');
      delete p.dated; delete p.assumedDeath; delete p.y; delete p.cx; delete p.h;
      people.push(p);
    }
  }
  return people;
}

// Free-typed date -> "YYYY-MM-DD" with 00 for unknown parts. Returns '' for blank, or null if unparseable.
function normalizeDate(input) {
  const t = String(input || '').trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = findDates(t);
  return d.length ? d[0].iso : null;
}

return { parseInscription, findDates, titleCase, splitName, normalizeDate };
});
