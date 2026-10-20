(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['plotmap'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {
// Markup for the optional cemetery plot map (the WikiTree "Cemetery Plot Map" app).
// The map reads a wiki table on a WikiTree Space page, so the table here uses exactly the columns and
// cell wrappers that app writes itself: WikiTree | FindAGrave | FamilySearch | Long | Lat | Image link |
// Given Names | Surname | Maiden | Birth | Death | [Section | Plot | Row | Monument | Reference] | Notes

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const US = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' };

const dispDate = (iso) => {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || '');
  if (!m || +m[1] === 0) return '';
  return +m[3] ? `${+m[3]} ${MON[+m[2] - 1]} ${+m[1]}` : +m[2] ? `${MON[+m[2] - 1]} ${+m[1]}` : String(+m[1]);
};
const cell = (v) => String(v ?? '').replace(/\|/g, '&#124;').replace(/\s+/g, ' ').trim();
const hasProfile = (id) => /-\d+$/.test(id || '');
const underscored = (s) => String(s).trim().replace(/\s+/g, '_');

// "Fairmont Cemetery", Raton, New Mexico -> Fairmont_Cemetery,_Raton,_New_Mexico
function suggestCategory(c) {
  const parts = [c.name, c.city, c.state].map((s) => (s || '').trim()).filter(Boolean);
  return parts.length ? 'Category:' + underscored(parts.join(', ')) : '';
}
// "Fairmont Cemetery Raton NM USA Plot Map Table"
function suggestTitle(c) {
  const country = /^(usa|united states( of america)?)$/i.test(c.country || '') ? 'USA' : (c.country || '');
  const st = US[c.state] || c.state || '';
  return [c.name, c.city, st, country, 'Plot Map Table'].map((s) => (s || '').trim()).filter(Boolean).join(' ');
}
const categoryLine = (cat) => `[[${/^Category:/i.test(cat) ? cat : 'Category:' + cat}]]`;

function build(db, batchId) {
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) throw new Error('No such album');
  const cem = batch.cemetery || {};
  const stoneOf = (p) => db.stones.find((s) => s.id === p.stoneId) || {};
  const people = db.people.filter((p) => p.batchId === batchId && p.status !== 'skip');

  const rows = people.map((p) => {
    const s = stoneOf(p);
    const profile = hasProfile(p.wikitreeId);
    return {
      wt: profile ? p.wikitreeId : '', fag: p.findagrave, fs: p.familysearch,
      lon: s.lon != null ? (+s.lon).toFixed(6) : '', lat: s.lat != null ? (+s.lat).toFixed(6) : '',
      photo: s.photoUrl || '',
      // The map names a row from WikiTree when it has a profile; only a burial without one needs its own names.
      given: profile ? '' : [p.given, p.suffix].filter(Boolean).join(' '), surname: profile ? '' : p.surname, maiden: profile ? '' : p.maiden,
      born: profile ? '' : dispDate(p.birth), died: profile ? '' : dispDate(p.death),
      section: s.section || '', plot: s.plot || '', row: s.row || '', monument: s.monument || '', reference: s.reference || '',
      notes: p.notes || '', person: p,
    };
  });
  const sortKey = (r) => (r.wt ? r.wt : `~${r.surname} ${r.given}`);
  rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  // Optional columns appear only when some row has a value, like the app's own export.
  const extra = [['Section', 'section'], ['Plot', 'plot'], ['Row', 'row'], ['Monument', 'monument'], ['Reference', 'reference']].filter(([, k]) => rows.some((r) => r[k]));
  const header = ['WikiTree', 'FindAGrave', 'FamilySearch', 'Long', 'Lat', 'Image link', 'Given Names', 'Surname', 'Maiden', 'Birth', 'Death', ...extra.map(([h]) => h), 'Notes'];

  const markup = ['{| border="1" class="sortable"', `! ${header.join(' !! ')}`, ...rows.map((r) => '|-\n| ' + [
    r.wt ? `[[${cell(r.wt)}]]` : '',
    r.fag ? `{{FindAGrave|${cell(r.fag)}}}` : '',
    r.fs ? `{{FamilySearch|${cell(r.fs)}}}` : '',
    r.lon, r.lat,
    r.photo ? `[${cell(r.photo)} Headstone]` : '',
    ...[r.given, r.surname, r.maiden, r.born, r.died].map(cell),
    ...extra.map(([, k]) => cell(r[k])),
    cell(r.notes),
  ].join(' || ')), '|}'].join('\n');

  // Same rows as a tab-separated file for the map app's "Import data" (names written for every row).
  const tsvHeader = ['WikiTree ID', 'FindAGrave', 'FamilySearch', 'Long', 'Lat', 'Image link', 'Given Names', 'Surname', 'Maiden', 'Birth', 'Death', 'Section', 'Plot', 'Row', 'Monument', 'Reference', 'Notes'];
  const t = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const tsv = [tsvHeader.join('\t'), ...rows.map((r) => [r.wt, r.fag, r.fs, r.lon, r.lat, r.photo,
    [r.person.given, r.person.suffix].filter(Boolean).join(' '), r.person.surname, r.person.maiden, dispDate(r.person.birth), dispDate(r.person.death),
    r.section, r.plot, r.row, r.monument, r.reference, r.notes].map(t).join('\t'))].join('\n') + '\n';

  const category = cem.category || suggestCategory(cem);
  const title = cem.tablePage || suggestTitle(cem);
  const n = (f) => rows.filter(f).length;
  const warnings = [];
  if (!n((r) => r.lon)) warnings.push('No row has GPS coordinates, so nothing can be placed on the map.');
  else if (n((r) => !r.lon)) warnings.push(`${n((r) => !r.lon)} row(s) have no GPS coordinates and will not be placed on the map.`);
  if (n((r) => !r.photo)) warnings.push(`${n((r) => !r.photo)} row(s) have no headstone image link. Upload the photo to the person's WikiTree profile, then paste its link in the Location and photo card.`);
  if (n((r) => !r.wt)) warnings.push(`${n((r) => !r.wt)} row(s) have no WikiTree ID yet. They are kept as burials with their own names and listed under "Needs WikiTree ID" on the map.`);
  if (n((r) => r.person.flags && r.person.flags.length)) warnings.push(`${n((r) => r.person.flags && r.person.flags.length)} row(s) still carry ⚠ checks from the photo reading. Check those names and dates first.`);
  if (!cem.category) warnings.push('No WikiTree category is set for this cemetery and none could be found, so the one shown is a guess. Use "Look up on WikiTree" or check that it exists.');

  return {
    albumName: batch.name, cemetery: cem, rowCount: rows.length, markup, tsv, warnings,
    title, categoryLines: [categoryLine(category), '[[Category:Plotting_Pages]]'],
    pageUrl: 'https://www.wikitree.com/wiki/Space:' + underscored(title),
  };
}

return { build, suggestCategory, suggestTitle, categoryLine };
});
