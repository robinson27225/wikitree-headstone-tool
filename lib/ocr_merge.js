(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['ocr_merge'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {
// Combines the lines read by Apple Vision and PaddleOCR from the same photo.
// Lines that sit in the same place are one reading of the same text. Where the engines agree the text is kept;
// where they differ the more trustworthy reading is chosen and the other is kept as an alternative to show.

const { findDates } = require('./parse');

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

function distance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// PaddleOCR runs neighbouring years together ("19311859"); give them a separator.
const splitRunOnYears = (t) => t.replace(/(\d{4})(?=\d{4})/g, '$1 / ').replace(/\b([A-Z])\.(?=[A-Za-z]{2})/g, '$1. ');

// Put the letters of `letters` into the spacing and punctuation of `pattern` (same number of letters/digits).
function respace(pattern, letters) {
  const src = norm(letters);
  if (norm(pattern).length !== src.length) return null;
  let i = 0;
  return pattern.replace(/[A-Za-z0-9]/g, () => src[i++]);
}

const yearsOK = (t) => { const d = findDates(t).map((x) => +x.iso.slice(0, 4)); return d.length; };

function pick(v, p, disagreements) {
  const nv = norm(v.text), np = norm(p.text);
  const geo = { x: v.x, y: v.y, w: v.w, h: v.h };
  if (nv === np) return { ...geo, text: v.text, confidence: Math.max(v.confidence, p.confidence), engine: 'both' };
  const close = distance(nv, np) <= Math.max(2, Math.ceil(0.3 * Math.max(nv.length, np.length)));
  // Prefer the reading that contains valid years when the line is made of digits; otherwise the more confident one.
  const isDates = /\d{4}/.test(v.text) || /\d{4}/.test(p.text);
  let usePaddle;
  if (isDates && yearsOK(p.text) !== yearsOK(v.text)) usePaddle = yearsOK(p.text) > yearsOK(v.text);
  else usePaddle = p.confidence >= Math.max(0.6, v.confidence - 0.15);
  let text = usePaddle ? p.text : v.text;
  // PaddleOCR drops the spaces between words; keep Apple Vision's spacing when the letter count matches.
  if (usePaddle && close) { const spaced = respace(v.text, p.text); if (spaced) text = spaced; }
  disagreements.push({ used: text, vision: v.text, paddle: p.text, engine: usePaddle ? 'paddle' : 'vision', close });
  return { ...(usePaddle ? { x: p.x, y: p.y, w: p.w, h: p.h } : geo), text, confidence: usePaddle ? p.confidence : v.confidence, engine: usePaddle ? 'paddle' : 'vision', alt: usePaddle ? v.text : p.text };
}

// Several readings of the same text (Apple Vision once, PaddleOCR at a few image sizes). Vote letter by letter
// across readings that have the same number of letters/digits; the letters and digits are the readings'
// consensus and the spacing comes from a reading that has it. Returns {line, unanimous}.
function consensus(cands) {
  const byLen = new Map();
  for (const c of cands) { const n = norm(c.text).length; (byLen.get(n) || byLen.set(n, []).get(n)).push(c); }
  const groups = [...byLen.values()].sort((x, y) => y.length - x.length || Math.max(...y.map((c) => c.confidence)) - Math.max(...x.map((c) => c.confidence)));
  const same = groups[0];
  const best = [...same].sort((x, y) => y.confidence - x.confidence)[0];
  const unanimous = cands.every((c) => norm(c.text) === norm(best.text));
  let letters, minAgree = unanimous ? 1 : 0.5;
  if (same.length >= 3) {
    minAgree = 1;
    letters = [...norm(best.text)].map((_, i) => {
      const tally = new Map();
      for (const c of same) { const ch = norm(c.text)[i]; tally.set(ch, (tally.get(ch) || 0) + 1 + c.confidence * 0.01); }
      const [ch, votes] = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
      minAgree = Math.min(minAgree, Math.floor(votes) / same.length);
      return ch;
    }).join('');
    if (same.length < cands.length) minAgree = Math.min(minAgree, same.length / cands.length); // some readings had a different length
  } else letters = norm(best.text);
  // Spacing and punctuation: from the reading with the most of it (Apple Vision wins ties)
  const template = [...same].sort((x, y) => (y.text.match(/[^A-Za-z0-9]/g) || []).length - (x.text.match(/[^A-Za-z0-9]/g) || []).length || (y.src === 'v') - (x.src === 'v'))[0];
  const text = (respace(template.text, letters) || best.text).replace(/\s+/g, ' ').trim();
  const conf = same.reduce((a, c) => a + c.confidence, 0) / same.length;
  return { line: { x: best.x, y: best.y, w: best.w, h: best.h, text, confidence: conf, engine: unanimous ? 'both' : 'combined' }, unanimous, minAgree };
}

// vision: lines; paddle: lines from one pass, or an array of line arrays (one per pass)
function merge(vision, paddle) {
  const passes = Array.isArray(paddle) && Array.isArray(paddle[0]) ? paddle : paddle ? [paddle] : [];
  const V = (vision || []).map((l) => ({ ...l, src: 'v' }));
  const P = passes.flatMap((lines, i) => lines.map((l) => ({ ...l, text: splitRunOnYears(l.text), src: 'p' + i })));
  if (!P.length) return { lines: V.map(({ src, ...l }) => ({ ...l, engine: 'vision' })), disagreements: [] };
  if (!V.length && passes.length === 1) return { lines: P.map(({ src, ...l }) => ({ ...l, engine: 'paddle' })), disagreements: [] };

  // Group the readings. PaddleOCR's passes use consistent boxes, so first group those across passes; then give each
  // Apple Vision line to the single group it matches best (its boxes are taller, so plain overlap would chain
  // neighbouring lines together).
  const parent = P.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    if (P[i].src !== P[j].src && overlap(P[i], P[j]) > 0.5) parent[find(i)] = find(j);
  }
  const clusters = new Map();
  P.forEach((l, i) => { const r = find(i); (clusters.get(r) || clusters.set(r, []).get(r)).push(l); });
  const box = (ls) => { const x0 = Math.min(...ls.map((l) => l.x)), y0 = Math.min(...ls.map((l) => l.y)), x1 = Math.max(...ls.map((l) => l.x + l.w)), y1 = Math.max(...ls.map((l) => l.y + l.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  const iou = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); if (w <= 0 || h <= 0) return 0; const i = w * h; return i / (a.w * a.h + b.w * b.h - i); };
  const groups = [...clusters.values()].map((ls) => ({ box: box(ls), members: [...ls] }));
  for (const v of V) {
    let best = null, bestScore = 0;
    for (const g of groups) { const sc = iou(v, g.box); if (sc > bestScore && overlap(v, g.box) >= 0.5) { best = g; bestScore = sc; } }
    if (best) best.members.push(v); else groups.push({ box: v, members: [v] });
  }

  const lines = [], disagreements = [];
  const strip = ({ src, ...l }) => l;
  for (const grp of groups) {
    const g = grp.members;
    // Text only one PaddleOCR pass saw, that Apple Vision did not, is usually texture: keep it only if it is clear
    if (!g.some((n) => n.src === 'v')) {
      const seen = new Set(g.map((n) => n.src)).size;
      const top = Math.max(...g.map((n) => n.confidence));
      const letters = norm(g[0].text).replace(/\d/g, '').length, digits = norm(g[0].text).replace(/\D/g, '').length;
      if (passes.length >= 2 && seen < 2 && (top < 0.9 || norm(g[0].text).length < 5)) continue;
      if (letters && !digits && letters <= 2) continue;
    }
    const bySrc = new Map();
    for (const n of g) (bySrc.get(n.src) || bySrc.set(n.src, []).get(n.src)).push(n);
    const single = [...bySrc.values()].filter((a) => a.length === 1).map((a) => a[0]);
    const multi = [...bySrc.values()].filter((a) => a.length > 1);
    if (!single.length) { // every reading split the text into several lines: keep the most confident reading's lines
      const mean = (a) => a.reduce((s, l) => s + l.confidence, 0) / a.length;
      const top = [...multi].sort((a, b) => mean(b) - mean(a))[0];
      lines.push(...top.map((l) => ({ ...strip(l), engine: l.src === 'v' ? 'vision' : 'paddle' })));
      continue;
    }
    if (single.length === 1) { const l = single[0]; lines.push({ ...strip(l), engine: l.src === 'v' ? 'vision' : 'paddle' }); if (multi.length) disagreements.push(describe(l.text, V, g, multi)); continue; }
    const allText = (ls) => norm(ls.map((n) => n.text).join(''));
    const v = single.find((l) => l.src === 'v'), ps = single.filter((l) => l.src !== 'v');
    // Prefer readings with valid years when the text is a date line
    let cands = single;
    if (cands.some((c) => /\d{4}/.test(c.text))) { const best = Math.max(...cands.map((c) => yearsOK(c.text))); cands = cands.filter((c) => yearsOK(c.text) === best); }
    if (cands.length === 2 && v && cands.includes(v) && ps.length === 1) { lines.push(pick(v, ps[0], disagreements)); continue; }
    const { line, unanimous, minAgree } = consensus(cands);
    lines.push(line);
    const sameLetters = g.every((n) => n.src === 'v' || norm(n.text) === norm(line.text)) && allText(g.filter((n) => n.src === 'v')) === norm(line.text);
    if (!sameLetters) disagreements.push({ used: line.text, vision: v ? v.text : (multi.find((a) => a[0].src === 'v') || []).map((l) => l.text).join(' | '), paddle: [...new Set(ps.map((l) => l.text))].join('  ·  '), engine: 'combined', close: true, severity: minAgree >= 0.66 && !multi.length ? 'minor' : 'major' });
  }
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  return { lines, disagreements };
}

function describe(used, V, g, multi) {
  const vs = g.filter((n) => n.src === 'v').map((n) => n.text).join(' | ');
  const ps = [...new Set(g.filter((n) => n.src !== 'v').map((n) => n.text))].join('  ·  ');
  return { used, vision: vs, paddle: ps, engine: 'combined', close: false };
}

return { merge, norm };
});
