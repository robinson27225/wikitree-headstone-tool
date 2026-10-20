const assert = require('assert');
const { merge } = require('../lib/ocr_merge');
const B = (text, x, y, w, h, c = 1) => ({ text, x, y, w, h, confidence: c });
const texts = (r) => r.lines.map((l) => l.text);

// Same text, different spacing: keep the spaced one, no disagreement
let r = merge([B('MATILDA K SCARAFIOTTI', .3, .4, .4, .05)], [B('MATILDA K.SCARAFIOTTI', .3, .4, .4, .05, .93)]);
assert.deepStrictEqual(texts(r), ['MATILDA K SCARAFIOTTI']); assert.strictEqual(r.disagreements.length, 0);
// One letter differs: Paddle's letters, Vision's spacing
r = merge([B('GLORGE N', .3, .3, .2, .05)], [B('GEORGEN', .3, .3, .2, .05, .99)]);
assert.deepStrictEqual(texts(r), ['GEORGE N']); assert.strictEqual(r.disagreements.length, 1);
// Same, with Paddle unsure: Vision wins
r = merge([B('MARY A. MOCLAIN', .3, .3, .4, .05, .9)], [B('MARY A MOCLAIM', .3, .3, .4, .05, .4)]);
assert.deepStrictEqual(texts(r), ['MARY A. MOCLAIN']);
// Only one engine saw a line: keep it
r = merge([B('MARY A. MOCLAIN', .3, .3, .4, .05), B('1847', .4, .4, .1, .04)], []);
assert.strictEqual(r.lines.length, 2);
r = merge([B('NOISE', .1, .1, .1, .05, .2)], [B('REAL NAME', .5, .5, .3, .05, .9)]);
assert.deepStrictEqual(texts(r), ['NOISE', 'REAL NAME'].sort((a, b) => 0)); // different places: both kept
// Different line splitting: Paddle's whole line replaces Vision's pieces when it is confident
r = merge([B('AHLELIS', .32, .62, .15, .025, .3), B('PIETRO', .52, .62, .11, .034), B('1860-1827', .5, .66, .16, .031)],
  [B('ANCELINA PIETRO', .3, .615, .35, .04, .82), B('1872-19311859-1927', .3, .655, .4, .04, .92)]);
assert.deepStrictEqual(texts(r), ['ANCELINA PIETRO', '1872-1931 / 1859-1927']);
// Date line: the reading with valid years wins
r = merge([B('1B6O ~ 1925', .4, .5, .2, .04, .95)], [B('1860 --1925', .4, .5, .2, .04, .9)]);
assert.deepStrictEqual(texts(r), ['1860 --1925']);
// Several PaddleOCR passes at different sizes plus Apple Vision: vote letter by letter
const pass = (t, c = 0.9) => [B(t, .3, .6, .4, .04, c)];
r = merge([B('AHLELIS', .32, .6, .15, .025, .3), B('PIETRO', .52, .6, .11, .034)],
  [pass('ANCELINAPIETRO'), pass('ANCELINA  PIETRO'), pass('AHCELINAPIETRO'), pass('ANCELIHA PIETRO')]);
assert.deepStrictEqual(texts(r), ['ANCELINA PIETRO']);
r = merge([B('1860-1827', .3, .6, .4, .04, .9)], [pass('1872-19311859-1927'), pass('1872-19311859-1827'), pass('1272-1931 1859-1927'), pass('1872-1931 1859-1927')]);
assert.strictEqual(r.lines.length, 1);
assert.strictEqual(r.lines[0].text.replace(/\D/g, ''), '1872193118591927');
// Vision outvoted by two agreeing PaddleOCR passes
r = merge([B('GLORGE N', .3, .6, .4, .04, .9)], [pass('GEORGE N'), pass('GEORGEN'), pass('GEORGE N')]);
assert.deepStrictEqual(texts(r), ['GEORGE N']);
// A line only Apple Vision saw survives
r = merge([B('MARY A. MOCLAIN', .3, .6, .4, .04, .9)], [[], [], []]);
assert.deepStrictEqual(texts(r), ['MARY A. MOCLAIN']);
// Unanimous: no disagreement recorded
r = merge([B('DAVID LEE BEARS', .3, .6, .4, .04, .9)], [pass('DAVID LEE BEARS'), pass('DAVID LEE BEARS'), pass('DAVID LEE BEARS')]);
assert.strictEqual(r.disagreements.length, 0);
// Real boxes from IMG_8059: Apple Vision's tall name box overlaps the date line, which must not chain them together
const petePass = (name) => [B(name, .23, .53, .39, .06, .98), B('1909 1969', .28, .58, .29, .06, 1)];
r = merge([B('PETE SCARAFIOTII', .23, .53, .39, .09), B('1909', .28, .59, .09, .04), B('1969', .49, .59, .08, .05)],
  [petePass('PETESCARAFIOTTI'), petePass('PETESCARAFIOTTI'), petePass('PETE SCARAFIOTTI')]);
assert.deepStrictEqual(r.lines.map((l) => l.text).filter((t) => /[A-Z]/.test(t)), ['PETE SCARAFIOTTI']);
// Noise seen by one PaddleOCR pass only is dropped
r = merge([B('MARY A. MOCLAIN', .3, .3, .4, .05)], [[B('DIB', .3, .05, .1, .04, .6)], [], []]);
assert.deepStrictEqual(r.lines.map((l) => l.text), ['MARY A. MOCLAIN']);
console.log('merge tests ok');
