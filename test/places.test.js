const assert = require('assert');
const P = require('../lib/places');
const el = (name, b, id = 1) => ({ type: 'way', id, tags: name ? { name, landuse: 'cemetery' } : { landuse: 'cemetery' }, bounds: { minlat: b[0], minlon: b[1], maxlat: b[2], maxlon: b[3] } });
const at = [36.9041, -104.4303];

// The outline that holds the point wins, even if another is nearer its edge
let r = P.pickCemetery([el('Elsewhere Cemetery', [36.9, -104.5, 36.91, -104.49], 2), el('Fairmont Cemetery', [36.9032, -104.4309, 36.9071, -104.4289], 3)], ...at);
assert.strictEqual(r.el.tags.name, 'Fairmont Cemetery'); assert(r.inside);
// Two outlines hold it: the smaller (a section inside a bigger cemetery) wins
r = P.pickCemetery([el('Big Cemetery', [36.8, -104.5, 37, -104.3], 4), el('Old Section', [36.904, -104.4305, 36.905, -104.4295], 5)], ...at);
assert.strictEqual(r.el.tags.name, 'Old Section');
// Nothing holds it: nearest, flagged as not inside
r = P.pickCemetery([el('Near Cemetery', [36.9050, -104.4300, 36.9060, -104.4290], 6), el('Far Cemetery', [36.95, -104.4, 36.96, -104.39], 7)], ...at);
assert.strictEqual(r.el.tags.name, 'Near Cemetery'); assert(!r.inside);
// Named beats unnamed; none returns null
assert.strictEqual(P.pickCemetery([el('', [36.9, -104.5, 36.91, -104.4], 8), el('Named', [36.9, -104.5, 36.91, -104.4], 9)], ...at).el.tags.name, 'Named');
assert.strictEqual(P.pickCemetery([], ...at), null);
// Place names
assert.strictEqual(P.cleanCounty('Colfax County'), 'Colfax'); assert.strictEqual(P.cleanCounty('Orleans Parish'), 'Orleans');
assert.strictEqual(P.cleanCountry('United States'), 'United States of America'); assert.strictEqual(P.cleanCountry('Canada'), 'Canada');
// Centre and spread of the photos
const c = P.centre([{ lat: 36.9041, lon: -104.4303 }, { lat: 36.9042, lon: -104.4302 }, { lat: 36.9040, lon: -104.4304 }]);
assert(Math.abs(c.lat - 36.9041) < 1e-6 && c.spread < 30);
// Nominatim search results become outlines the same chooser can use (real response for Fairmont and Fairview)
const found = P.fromNominatimSearch([
  { osm_type: 'way', osm_id: 58600019, type: 'cemetery', name: 'Fairmont Cemetery', boundingbox: ['36.9032520', '36.9071469', '-104.4309315', '-104.4289467'] },
  { osm_type: 'way', osm_id: 12, type: 'cemetery', name: 'Fairview Presbyterian Cemetery', boundingbox: ['36.9033089', '36.9052094', '-104.4238083', '-104.4222827'] },
  { osm_type: 'node', osm_id: 5, type: 'church', name: 'Not a cemetery', boundingbox: ['1', '2', '3', '4'] },
]);
assert.strictEqual(found.length, 2);
assert.strictEqual(P.pickCemetery(found, ...at).el.tags.name, 'Fairmont Cemetery');
console.log('places tests ok');
