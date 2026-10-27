const assert = require('assert');
const P = require('../lib/photoref');

// WikiTree: direct, thumb, image page and bare file name all give the photo.php address
const wt = 'https://www.wikitree.com/photo.php/9/98/Babnick-2.jpg';
assert.strictEqual(P.normalize(wt), wt);
assert.strictEqual(P.normalize('https://www.wikitree.com/photo.php/7/7e/Weatherall-96-4.jpg'), 'https://www.wikitree.com/photo.php/7/7e/Weatherall-96-4.jpg');
assert.strictEqual(P.normalize('https://www.wikitree.com/photo.php/thumb/9/98/Babnick-2.jpg/300px-Babnick-2.jpg'), wt);
assert.strictEqual(P.normalize('https://www.wikitree.com/photo/jpg/Babnick-2'), wt);
assert.strictEqual(P.normalize('Babnick-2.jpg'), wt);
assert.strictEqual(P.normalize('Weatherall-96-4.jpg'), 'https://www.wikitree.com/photo.php/7/7e/Weatherall-96-4.jpg');
assert.strictEqual(P.imagePageUrl(wt), 'https://www.wikitree.com/photo/jpg/Babnick-2');

// Google Drive: every share form gives the same /file/d/<id>/view address
const id = '15dMe9TSeOXwNz6z5rDDJUEdz0l0ehQ6g';
const drive = `https://drive.google.com/file/d/${id}/view`;
assert.strictEqual(P.normalize(`https://drive.google.com/file/d/${id}/view?usp=drive_link`), drive);
assert.strictEqual(P.normalize(`https://drive.google.com/file/d/${id}/edit`), drive);
assert.strictEqual(P.normalize(`https://drive.google.com/open?id=${id}`), drive);
assert.strictEqual(P.normalize(`https://drive.google.com/uc?export=view&id=${id}`), drive);
assert.strictEqual(P.normalize(`  https://drive.google.com/file/d/${id}/view?usp=sharing `), drive);
assert.strictEqual(P.imagePageUrl(drive), '');

// Google Photos: kept as typed
const gp = 'https://photos.app.goo.gl/SzpSQDh1dbGuTSm56';
assert.strictEqual(P.normalize(gp), gp);
assert.strictEqual(P.normalize('https://photos.google.com/share/AF1Q?key=abc'), 'https://photos.google.com/share/AF1Q?key=abc');

// Kind and preview
assert.strictEqual(P.kind(wt), 'wikitree');
assert.strictEqual(P.kind(drive), 'drive');
assert.strictEqual(P.kind(gp), 'gphotos');
assert.strictEqual(P.kind('https://example.com/x.jpg'), 'other');
assert.strictEqual(P.kind(''), '');
assert.strictEqual(P.previewUrl(wt), wt);
assert.strictEqual(P.previewUrl(drive), `https://drive.google.com/thumbnail?id=${id}&sz=w800`);
assert.strictEqual(P.previewUrl(gp), '');
assert.strictEqual(P.previewUrl('https://example.com/x.jpg'), '');
assert.strictEqual(P.normalize(''), '');
console.log('photoref ok');
