const assert = require('assert');
const C = require('../lib/citation');
const person = { given: 'Bartonus A.', surname: 'Taylor', birth: '1905-00-00', death: '1919-00-00' };
const stone = { lat: 36.904, lon: -104.430471, takenAt: '2020:11:21 14:03:00' };
const cem = { name: 'Fairmont Cemetery', space: 'Fairmont_Cemetery_Raton_NM_USA', city: 'Raton', county: 'Colfax', state: 'New Mexico', country: 'United States of America' };

// Your example, exactly
assert.strictEqual(C.build(person, stone, cem, { name: 'Azure Robinson', wikitreeId: 'Robinson-27225' }),
  '*Monumental inscription. United States of America. [[Space:Fairmont_Cemetery_Raton_NM_USA|Fairmont Cemetery]], Raton, Colfax, New Mexico. 1919 (1905). TAYLOR, Bartonus A. GPS: 36.904000, -104.430471. Photographed by: [[Robinson-27225|Azure Robinson]]: taken 21 Nov 2020.');
// No photographer set: the date taken must still be there
const noName = C.build(person, stone, cem, { name: '', wikitreeId: '' });
assert(noName.endsWith('Photographed: taken 21 Nov 2020.'), noName);
assert(C.build(person, stone, cem, undefined).includes('taken 21 Nov 2020'));
// Name but no WikiTree ID: plain name, with the date
assert(C.build(person, stone, cem, { name: 'Azure Robinson' }).endsWith('Photographed by: Azure Robinson: taken 21 Nov 2020.'));
// No date known: no "taken"
assert(!C.build(person, { ...stone, takenAt: '' }, cem, { name: 'A B' }).includes('taken'));
console.log('citation tests ok');
