// Monumental-inscription source citation. Works in the browser and in Node.
(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['citation'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const year = (iso) => { const y = iso && iso.slice(0, 4); return y && y !== '0000' ? String(+y) : ''; };

  // "2020:11:21 14:03:00" or "2020-11-21..." -> "21 Nov 2020"
  function takenText(t) {
    const m = String(t || '').match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})/);
    return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` : '';
  }

  function placeText(c) {
    return [c.city, c.county, c.state].map((s) => (s || '').trim()).filter(Boolean).join(', ');
  }

  function spaceLink(c) {
    const name = (c.name || '').trim() || 'Unknown cemetery';
    const space = (c.space || '').trim().replace(/^\[\[|\]\]$/g, '').replace(/ /g, '_');
    return space ? `[[${space.startsWith('Space:') ? space : 'Space:' + space}|${name}]]` : name;
  }

  function personName(p) {
    const given = [p.given, p.suffix].filter(Boolean).join(' ').trim();
    let n = [(p.surname || '').toUpperCase(), given].filter(Boolean).join(', ');
    if (p.maiden) n += ` (née ${p.maiden})`;
    return n;
  }

  function dateRange(p) {
    const d = year(p.death), b = year(p.birth);
    if (d && b) return `${d} (${b})`;
    if (d) return d;
    if (b) return `(${b})`;
    return '';
  }

  // person: {given, surname, maiden, suffix, birth, death}; stone: {lat, lon, takenAt};
  // cemetery: {name, space, city, county, state, country}; photographer: {name, wikitreeId}
  function build(person, stone, cemetery, photographer) {
    const c = cemetery || {};
    const parts = ['*Monumental inscription.'];
    if (c.country) parts.push(`${c.country}.`);
    const where = [spaceLink(c), placeText(c)].filter(Boolean).join(', ');
    parts.push(`${where}.`);
    const range = dateRange(person);
    if (range) parts.push(`${range}.`);
    const nm = personName(person);
    parts.push(nm.endsWith('.') ? nm : `${nm}.`);
    if (stone && stone.lat != null && stone.lon != null) {
      parts.push(`GPS: ${Number(stone.lat).toFixed(6)}, ${Number(stone.lon).toFixed(6)}.`);
    }
    const ph = photographer || {};
    if (ph.name) {
      const link = ph.wikitreeId ? `[[${ph.wikitreeId}|${ph.name}]]` : ph.name;
      const taken = takenText(stone && stone.takenAt);
      parts.push(`Photographed by: ${link}${taken ? ': taken ' + taken : ''}.`);
    }
    return parts.join(' ');
  }

  return { build, takenText, year };
});
