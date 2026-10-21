(function (root, factory) {
  // Loads in Node (require) and in the browser (scripts attach to window.HW, which is also how files find each other)
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else { root.HW = root.HW || {}; root.HW['places'] = factory(function (n) { return root.HW[n.replace(/^.*\//, '').replace(/\.js$/, '')]; }); }
})(typeof self !== 'undefined' ? self : this, function (require) {

  // Finds the cemetery a photo was taken in from its GPS position.
  //   - the cemetery outline and name: OpenStreetMap, through the Overpass API
  //   - town, county, state and country: OpenStreetMap's Nominatim reverse geocoder
  // Both answer web pages from any site. They are shared community services, so this makes one call of each per album.
  const cfg = globalThis.HW_CONFIG || {};
  const OVERPASS = cfg.overpass || 'https://overpass-api.de/api/interpreter';
  const NOMINATIM = cfg.nominatim || 'https://nominatim.openstreetmap.org/reverse';
  const NOMINATIM_SEARCH = cfg.nominatimSearch || NOMINATIM.replace(/reverse$/, 'search');
  const inNode = typeof window === 'undefined';
  const headers = inNode ? { 'User-Agent': 'HeadstonePhotoTool/0.1 (WikiTree)' } : {}; // browsers send their own

  const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const metres = (lat1, lon1, lat2, lon2) => {
    const R = 6371000, rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  // The middle of the photos' positions, and how far the farthest is from it (metres)
  function centre(points) {
    const lat = median(points.map((p) => p.lat)), lon = median(points.map((p) => p.lon));
    return { lat, lon, spread: Math.max(...points.map((p) => metres(lat, lon, p.lat, p.lon))) };
  }

  // Of the cemeteries OpenStreetMap returned, the one whose outline holds the point (smallest first), else the nearest.
  function pickCemetery(elements, lat, lon) {
    const rank = (el) => {
      const b = el.bounds; if (!b) return null;
      const inside = lat >= b.minlat && lat <= b.maxlat && lon >= b.minlon && lon <= b.maxlon;
      const dLat = Math.max(b.minlat - lat, 0, lat - b.maxlat), dLon = Math.max(b.minlon - lon, 0, lon - b.maxlon);
      return { el, inside, area: (b.maxlat - b.minlat) * (b.maxlon - b.minlon), dist: Math.hypot(dLat, dLon), named: !!(el.tags && (el.tags.name || el.tags['name:en'])) };
    };
    return (elements || []).map(rank).filter(Boolean)
      .sort((a, b) => b.named - a.named || b.inside - a.inside || (a.inside ? a.area - b.area : a.dist - b.dist))[0] || null;
  }

  const cleanCounty = (c) => String(c || '').replace(/\s+(County|Parish|Borough)$/i, '').trim();
  const cleanCountry = (c) => (/^united states$/i.test(c || '') ? 'United States of America' : c || '');
  const town = (a) => a.city || a.town || a.village || a.hamlet || a.municipality || '';

  // A slow or blocked service must not leave an import waiting for ever
  async function timed(url, options, ms = 25000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...options, signal: ctl.signal }); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'the service did not answer in time' : e.message); }
    finally { clearTimeout(t); }
  }

  async function post(url, body) {
    const res = await timed(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(body) }, 8000);
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    return res.json();
  }

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  // Overpass is a shared service that is sometimes at capacity; if it does not answer quickly, Nominatim is used instead
  async function viaOverpass(lat, lon) {
    for (const radius of [150, 500]) {
      const q = `[out:json][timeout:25];(way(around:${radius},${lat},${lon})[landuse=cemetery];relation(around:${radius},${lat},${lon})[landuse=cemetery];way(around:${radius},${lat},${lon})[amenity=grave_yard];);out tags bb;`;
      const data = await post(OVERPASS, q);
      const best = pickCemetery(data.elements, lat, lon);
      if (best) return { ...best, radius, via: 'Overpass' };
    }
    return null;
  }

  // The same outlines through Nominatim's search, within about a kilometre (a different service, used when Overpass is busy)
  function fromNominatimSearch(results) {
    return (results || []).filter((r) => /^(cemetery|grave_yard)$/.test(r.type) && r.boundingbox).map((r) => ({
      type: r.osm_type, id: r.osm_id, tags: { name: r.name || '' },
      bounds: { minlat: +r.boundingbox[0], maxlat: +r.boundingbox[1], minlon: +r.boundingbox[2], maxlon: +r.boundingbox[3] },
    }));
  }
  async function viaNominatim(lat, lon) {
    const d = 0.01;
    await pause(1100); // Nominatim asks for at most one request a second
    const res = await timed(`${NOMINATIM_SEARCH}?q=cemetery&format=jsonv2&bounded=1&limit=15&viewbox=${lon - d},${lat + d},${lon + d},${lat - d}&accept-language=en`, { headers }, 15000);
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const best = pickCemetery(fromNominatimSearch(await res.json()), lat, lon);
    return best ? { ...best, via: 'Nominatim' } : null;
  }

  async function addressAt(lat, lon) {
    const res = await timed(`${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&accept-language=en`, { headers }, 15000);
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return (await res.json()).address || {};
  }

  // -> {name, city, county, state, country, outline: 'inside'|'near'|'none', osm, via, outlineError}; throws if nothing answered
  async function findCemetery(lat, lon) {
    let addr = null, addrError = '';
    try { addr = await addressAt(lat, lon); } catch (e) { addrError = e.message; }
    let cem = null, outlineError = '';
    try { cem = await viaOverpass(lat, lon); }
    catch (e1) {
      try { cem = await viaNominatim(lat, lon); }
      catch (e2) { outlineError = `${e1.message}; ${e2.message}`; }
    }
    if (!cem && !addr) throw new Error(outlineError || addrError || 'OpenStreetMap did not answer');
    const tags = (cem && cem.el.tags) || {};
    const a = addr || {};
    return {
      name: tags.name || tags['name:en'] || '',
      city: town(a) || tags['addr:city'] || '',
      county: cleanCounty(a.county),
      state: a.state || '',
      country: cleanCountry(a.country),
      outline: cem ? (cem.inside ? 'inside' : 'near') : 'none',
      osm: cem ? cem.el.type + '/' + cem.el.id : '',
      via: cem ? cem.via : '',
      outlineError,
    };
  }

  return { findCemetery, centre, pickCemetery, fromNominatimSearch, cleanCounty, cleanCountry, metres };
});
