#!/usr/bin/env node
'use strict';
// Builds headstone-tool/, the browser version, ready to upload to a static host such as the WikiTree Apps server.
//   npm install && npm run build:web
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'headstone-tool');
const nm = (p) => path.join(root, 'node_modules', p);
const version = require(path.join(root, 'package.json')).version;

fs.rmSync(out, { recursive: true, force: true });
for (const d of ['lib', 'vendor/ort', 'vendor/models']) fs.mkdirSync(path.join(out, d), { recursive: true });
const copy = (from, to) => fs.copyFileSync(from, path.join(out, to));

// The page and the code it shares with the Mac version
fs.writeFileSync(path.join(out, 'index.html'), fs.readFileSync(path.join(root, 'web-src/index.html'), 'utf8').replace(/__VERSION__/g, version));
copy(path.join(root, 'public/style.css'), 'style.css');
copy(path.join(root, 'public/app.js'), 'app.js');
copy(path.join(root, 'web-src/web.js'), 'web.js');
for (const f of ['md5', 'parse', 'ocr_merge', 'wikitree', 'photoref', 'plotmap', 'categories', 'citation', 'core', 'routes']) copy(path.join(root, `lib/${f}.js`), `lib/${f}.js`);

// PaddleOCR in the browser: one bundle (ONNX Runtime Web + OpenCV.js + the OCR pipeline), the WebAssembly runtime, the models
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'web-src/ocr-entry.js'), '--bundle', '--format=iife', '--platform=browser', '--minify',
  '--external:fs', '--external:path', '--alias:onnxruntime-web=onnxruntime-web/wasm',
  '--define:process.env.NODE_ENV="production"', '--log-level=error', `--outfile=${path.join(out, 'vendor/ocr-web.js')}`,
], { stdio: 'inherit' });
copy(nm('onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'), 'vendor/ort/ort-wasm-simd-threaded.js'); // loaded as a module; named .js so any host serves it as JavaScript
copy(nm('onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'), 'vendor/ort/ort-wasm-simd-threaded.wasm');
copy(nm('@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx'), 'vendor/models/det.onnx');
copy(nm('@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx'), 'vendor/models/rec.onnx');
copy(nm('@gutenye/ocr-models/assets/ppocr_keys_v1.txt'), 'vendor/models/dict.txt');
copy(nm('exifr/dist/full.umd.js'), 'vendor/exifr.js');
copy(nm('heic2any/dist/heic2any.min.js'), 'vendor/heic2any.min.js');

// Notices for the software included
const pkgs = ['@gutenye/ocr-browser', '@gutenye/ocr-common', '@gutenye/ocr-models', 'onnxruntime-web', '@techstark/opencv-js', 'js-clipper', 'exifr', 'heic2any'];
const lines = ['Software included in this folder (see each project for its full license text):', ''];
for (const n of pkgs) {
  try { const j = JSON.parse(fs.readFileSync(nm(`${n}/package.json`), 'utf8')); lines.push(`- ${j.name} ${j.version}: ${typeof j.license === 'string' ? j.license : (j.license && j.license.type) || 'see project'}${j.homepage ? ' (' + j.homepage + ')' : ''}`); }
  catch { lines.push(`- ${n}`); }
}
lines.push('', 'The text-reading models are PaddleOCR PP-OCRv4 (Apache License 2.0), https://github.com/PaddlePaddle/PaddleOCR.',
  'heic2any bundles libheif (LGPL-3.0), used only to open HEIC photos in browsers that cannot.');
fs.writeFileSync(path.join(out, 'THIRD-PARTY.txt'), lines.join('\n') + '\n');

const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`headstone-tool/ built (version ${version}, ${(size(out) / 1e6).toFixed(1)} MB). Upload its contents.`);
