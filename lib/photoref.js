(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['photoref'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {
// Accepts the ways a WikiTree photo gets referenced and returns the one address the plot map stores,
// e.g. https://www.wikitree.com/photo.php/c/cf/Tapia-408.jpg. Same rules as the Cemetery Plot Map app.
// Anything that is not recognisably a WikiTree image is kept as typed (the map accepts any address).
const md5 = require('./md5');
const WT = 'https://www.wikitree.com';

function urlForName(name) {
  const file = name.trim().replace(/^(Image|File):/i, '').replace(/ /g, '_');
  const h = md5(file);
  return `${WT}/photo.php/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(file).replace(/%2C/g, ',')}`;
}

function normalize(input) {
  const v = String(input ?? '').trim();
  if (!v) return '';
  const direct = /(?:wikitree\.com)?\/photo\.php\/(?:thumb\/)?([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+?\.[A-Za-z0-9]+)(?:\/[^?#]*)?(?:[?#].*)?$/i.exec(v);
  if (direct) return `${WT}/photo.php/${direct[1].toLowerCase()}/${direct[2].toLowerCase()}/${direct[3]}`;
  const page = /wikitree\.com\/photo\/([A-Za-z0-9]+)\/([^/?#]+)/i.exec(v);
  if (page) return urlForName(`${decodeURIComponent(page[2])}.${page[1].toLowerCase()}`);
  const wiki = /wikitree\.com\/wiki\/(?:Image|File):([^?#]+)/i.exec(v);
  const name = wiki ? decodeURIComponent(wiki[1]) : /^(?:Image:|File:)?[^/\\?#:]+\.(?:jpe?g|png|gif|webp)$/i.test(v) ? v : '';
  return name ? urlForName(name) : v;
}

// The WikiTree page describing a stored photo (title, date, location), or ''.
function imagePageUrl(photoUrl) {
  const m = /\/photo\.php\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+?)\.([A-Za-z0-9]+)$/i.exec(String(photoUrl || ''));
  return m ? `${WT}/photo/${m[2].toLowerCase()}/${m[1]}` : '';
}

return { normalize, imagePageUrl };
});
