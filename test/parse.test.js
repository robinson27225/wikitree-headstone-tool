const assert = require('assert');
const { parseInscription, findDates } = require('../lib/parse');
// helper: build OCR-ish lines top-to-bottom, centred
const L = (texts, x = 0.3, h = 0.05) => texts.map((t, i) => ({ text: t, confidence: 0.9, x, y: 0.1 + i * 0.1, w: 0.4, h }));

function names(ppl) { return ppl.map((p) => `${p.given}|${p.surname}|${p.maiden}|${p.born}|${p.died}`); }

// 1. simple
assert.deepStrictEqual(names(parseInscription(L(['BARTONUS A. TAYLOR', '1905 - 1919']))), ['Bartonus A.|Taylor||1905-00-00|1919-00-00']);
// 2. full dates with keywords
assert.deepStrictEqual(names(parseInscription(L(['Mary Ann Jones', 'BORN Jan 5, 1850', 'DIED 12 March 1921']))), ['Mary Ann|Jones||1850-01-05|1921-03-12']);
// 3. maiden in parens
assert.deepStrictEqual(names(parseInscription(L(['MARY (SMITH) JONES', '1850-1921']))), ['Mary|Jones|Smith|1850-00-00|1921-00-00']);
// 4. family heading + two people
const fam = [
  { text: 'TAYLOR', confidence: .95, x: .35, y: .05, w: .3, h: .12 },
  ...L(['JOHN H.', '1880 - 1950', 'MARTHA E.', '1884 - 1961']).map((l) => ({ ...l, y: l.y + .1 })),
];
assert.deepStrictEqual(names(parseInscription(fam)), ['John H.|Taylor||1880-00-00|1950-00-00', 'Martha E.|Taylor||1884-00-00|1961-00-00']);
// 5. two columns
const two = [
  ...L(['JOHN SMITH', '1900', '1970'], 0.05).map((l) => ({ ...l, w: .25 })),
  ...L(['JANE SMITH', '1905', '1990'], 0.65).map((l) => ({ ...l, w: .25 })),
];
assert.deepStrictEqual(names(parseInscription(two)), ['John|Smith||1900-00-00|1970-00-00', 'Jane|Smith||1905-00-00|1990-00-00']);
// 6. noise lines ignored
assert.deepStrictEqual(names(parseInscription(L(['BELOVED HUSBAND', 'JAMES O\'BRIEN', 'DIED', 'JUNE 3, 1932', 'IN LOVING MEMORY']))), ["James|O'Brien||0000-00-00|1932-06-03"].map((s) => s.replace('0000-00-00', '')));
// 7. dates
assert.strictEqual(findDates('5/12/1905')[0].iso, '1905-05-12');
assert.strictEqual(findDates('l9O5')[0].iso, '1905-00-00');
console.log('parse tests ok');
// Real-photo regressions (boxes taken from the Fairmont test album)
const B = (text, x, y, w, h, c = 1) => ({ text, x, y, w, h, confidence: c });
let r = parseInscription([B('FLORA', .32, .33, .13, .055), B('WHITFIELD', .27, .39, .21, .055), B('1884 -1949', .26, .44, .23, .051)]);
assert.deepStrictEqual(names(r), ['Flora|Whitfield||1884-00-00|1949-00-00']);
r = parseInscription([B('GLORGE N', .3, .3, .2, .05), B('WHITFIELD', .27, .39, .21, .055), B('1882 - 1943', .26, .44, .23, .05)]);
assert.deepStrictEqual(names(r), ['Glorge N|Whitfield||1882-00-00|1943-00-00']);
r = parseInscription([B('PETE SCARAFIOTII', .2, .3, .5, .05), B('1969', .4, .4, .1, .05), B('1909', .4, .5, .1, .05)]);
assert.deepStrictEqual(names(r), ['Pete|Scarafiotii||1909-00-00|1969-00-00']);
// heading + two names side by side, date under the right-hand one
r = parseInscription([B('SCARAFIOTTI', .31, .42, .35, .083), B('AHLELIS', .32, .62, .15, .025, .3), B('PIETRO', .52, .62, .11, .034), B('1860-1927', .5, .66, .16, .031)]);
assert.deepStrictEqual(names(r), ['Ahlelis|Scarafiotti|||', 'Pietro|Scarafiotti||1860-00-00|1927-00-00'].map((x) => x));
console.log('real-photo tests ok');
// Couple stone as read by the merged engines: heading, two names on one line, two year ranges on one line
r = parseInscription([B('SCARAFIOTTI', .31, .42, .35, .083), B('ANCELINA PIETRO', .3, .615, .35, .04, .82), B('1872-1931 / 1859-1927', .3, .655, .4, .04, .92)]);
assert.deepStrictEqual(names(r), ['Ancelina|Scarafiotti||1872-00-00|1931-00-00', 'Pietro|Scarafiotti||1859-00-00|1927-00-00']);
assert(r[0].flags.some((f) => /paired/.test(f)));
// A single person's name and range must not be split
r = parseInscription([B('SCARAFIOTTI', .31, .42, .35, .083), B('PIETRO', .52, .62, .11, .034), B('1859-1927', .5, .66, .16, .031)]);
assert.deepStrictEqual(names(r), ['Pietro|Scarafiotti||1859-00-00|1927-00-00']);
console.log('couple tests ok');
// Couple stone with a stray number below the dates (PaddleOCR read "188887" as "V1889")
r = parseInscription([B('SCARAFIOTTI', .31, .42, .35, .083), B('ANGELINA PIETRO', .3, .615, .35, .04, .8), B('1872-1931 / 1858-1927', .3, .655, .4, .04, .9), B('V1889', .3, .72, .1, .03, .5)]);
assert.deepStrictEqual(names(r), ['Angelina|Scarafiotti||1872-00-00|1931-00-00', 'Pietro|Scarafiotti||1858-00-00|1927-00-00']);
console.log('stray-number test ok');
