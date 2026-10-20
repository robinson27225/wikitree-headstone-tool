'use strict';
// Headstone Photo Tool (Mac version): local web app. Run with `node server.js` and open http://localhost:8777
// The API itself lives in lib/routes.js and is shared with the browser version; this file adds the Mac-only parts:
// static files, headstone photos and thumbnails, and the local-only safety checks.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const importer = require('./lib/importer');
const routes = require('./lib/routes');

const PORT = +process.env.PORT || 8777;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 5e6) req.destroy(); });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
});

async function api(req, res, url) {
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
  const r = await routes.handle(importer.ctx, req.method, url.pathname, body);
  if (r.text === undefined) return send(res, r.status, r.json);
  // File results (CSV, TSV, backup): a real download with ?download=1, otherwise JSON for the page to save itself
  if (url.searchParams.get('download')) {
    res.writeHead(r.status, { 'Content-Type': r.type + '; charset=utf-8', 'Content-Disposition': `attachment; filename="${r.filename}"` });
    return res.end(r.text);
  }
  return send(res, r.status, { text: r.text, type: r.type, filename: r.filename });
}

const server = http.createServer(async (req, res) => {
  try {
    // Local-only: refuse other Host headers (DNS rebinding) and cross-site writes.
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'forbidden' });
    if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'forbidden' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let m;
    if ((m = url.pathname.match(/^\/thumb\/(\w+)$/))) {
      const f = path.join(importer.PREVIEWS, m[1] + '.thumb.jpg');
      const src = path.join(importer.PREVIEWS, m[1] + '.jpg');
      if (!fs.existsSync(f)) {
        if (!fs.existsSync(src)) return send(res, 404, { error: 'no image' });
        await new Promise((ok) => execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', '-Z', '240', src, '--out', f], () => ok()));
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' });
      return fs.createReadStream(f).pipe(res);
    }
    if ((m = url.pathname.match(/^\/img\/(\w+)$/))) {
      const f = path.join(importer.PREVIEWS, m[1] + '.jpg');
      if (!fs.existsSync(f)) return send(res, 404, { error: 'no image' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' });
      return fs.createReadStream(f).pipe(res);
    }
    // Static files (the page uses #/ addresses, so there is only one HTML file)
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Headstone Photo Tool: http://localhost:${PORT}`));
