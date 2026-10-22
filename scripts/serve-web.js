#!/usr/bin/env node
'use strict';
// Serves headstone-tool/ for testing on http://localhost:8790. WikiTree's API only answers pages on wikitree.com, so lookups from
// localhost go through /wtapi here (open http://localhost:8790/?api=/wtapi&overpass=/overpass&nominatim=/nominatim). Not needed on the apps server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'headstone-tool');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.onnx': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/wtapi') {
    try {
      const r = await fetch('https://api.wikitree.com/api.php' + url.search);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(await r.text());
    } catch (e) { res.writeHead(502); return res.end(JSON.stringify({ error: e.message })); }
  }
  if (['/overpass', '/nominatim', '/nominatim-search'].includes(url.pathname)) {
    try {
      const up = url.pathname === '/overpass' ? 'https://overpass-api.de/api/interpreter' : 'https://nominatim.openstreetmap.org/' + (url.pathname === '/nominatim' ? 'reverse' : 'search') + url.search;
      const body = req.method === 'POST' ? await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); }) : undefined;
      const r = await fetch(up, { method: req.method, headers: { 'User-Agent': 'HeadstonePhotoTool/0.1 (local test)', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body });
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(await r.text());
    } catch (e) { res.writeHead(502); return res.end(JSON.stringify({ error: e.message })); }
  }
  const file = path.normalize(path.join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(+process.env.PORT || 8790, '127.0.0.1', () => console.log('Browser version: http://localhost:' + (process.env.PORT || 8790) + '/?api=/wtapi&overpass=/overpass&nominatim=/nominatim&nominatimSearch=/nominatim-search'));
