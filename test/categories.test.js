const assert = require('assert');
const { rankCemeteryCategories } = require('../lib/categories');
const cats = ['Cemeterist_Project_Example_Pages', 'Colfax_County,_New_Mexico', 'Fairmont_Cemetery,_Raton,_New_Mexico', 'Raton,_New_Mexico', 'Plotting_Pages', 'Cemeteries_in_New_Mexico'];
assert.deepStrictEqual(rankCemeteryCategories(cats, { name: 'Fairmont Cemetery', city: 'Raton' }).map((c) => c.category), ['Fairmont_Cemetery,_Raton,_New_Mexico']);
const two = ['Fairview_Cemetery,_Raton,_New_Mexico', 'Fairmont_Cemetery,_Raton,_New_Mexico'];
assert.strictEqual(rankCemeteryCategories(two, { name: 'Fairmont Cemetery', city: 'Raton' })[0].category, 'Fairmont_Cemetery,_Raton,_New_Mexico');
console.log('category tests ok');
