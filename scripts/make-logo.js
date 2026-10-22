#!/usr/bin/env node
'use strict';
// Draws the logo as SVG into assets/. The wordmark is turned into outlines (Source Sans 3 Bold, SIL Open Font License)
// so it looks the same everywhere. Then `node scripts/render-assets.js` makes the PNGs.
const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

const root = path.join(__dirname, '..');
const C = { dark: '#234a2b', amber: '#fbb616', green: '#8dc641', pale: '#e8f4d6' }; // the Cemetery Map palette
const buf = fs.readFileSync(path.join(root, 'node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// Text centred on cx with its baseline at y, as one path. Letters are placed one by one (with kerning); this is plain
// Latin text, so none of the font's advanced shaping is needed.
function word(text, cx, y, size, fill) {
  const scale = size / font.unitsPerEm;
  const glyphs = [...text].map((ch) => font.charToGlyph(ch));
  let x = 0;
  const paths = glyphs.map((g, i) => {
    const p = g.getPath(x, y, size);
    x += g.advanceWidth * scale + (glyphs[i + 1] ? font.getKerningValue(g, glyphs[i + 1]) * scale : 0);
    return p;
  });
  const width = x - 0; // advance of the whole word
  const dx = cx - width / 2;
  return paths.map((p) => { p.commands.forEach((c) => { for (const k of ['x', 'x1', 'x2']) if (k in c) c[k] += dx; }); return `<path fill="${fill}" d="${p.toPathData(2)}"/>`; }).join('');
}

// The picture: a headstone seen through a camera viewfinder, with a GPS pin
const mark = `<g transform="translate(43 4) scale(.92)">
  <g fill="none" stroke="${C.amber}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
    <path d="M214 196V116a34 34 0 0 1 34-34h96"/>
    <path d="M866 196V116a34 34 0 0 0-34-34h-96"/>
    <path d="M214 604v80a34 34 0 0 0 34 34h96"/>
    <path d="M866 604v80a34 34 0 0 1-34 34h-96"/>
  </g>
  <path fill="${C.dark}" d="M340 640V330a200 200 0 0 1 400 0v310z"/>
  <path fill="none" stroke="${C.pale}" stroke-width="10" stroke-linecap="round" d="M372 640V330a168 168 0 0 1 336 0v310" opacity=".35"/>
  <circle cx="540" cy="250" r="30" fill="none" stroke="${C.pale}" stroke-width="12"/>
  <rect x="425" y="338" width="230" height="30" rx="15" fill="${C.pale}"/>
  <rect x="460" y="392" width="160" height="22" rx="11" fill="${C.pale}" opacity=".8"/>
  <rect x="478" y="432" width="124" height="22" rx="11" fill="${C.pale}" opacity=".6"/>
  <rect x="250" y="620" width="580" height="64" rx="32" fill="${C.green}"/>
  <path fill="${C.amber}" stroke="#fff" stroke-width="10" stroke-linejoin="round" d="M728 128c-50 0-88 38-88 86 0 66 88 150 88 150s88-84 88-150c0-48-38-86-88-86z"/>
  <circle cx="728" cy="214" r="30" fill="${C.dark}"/></g>`;

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080" role="img" aria-label="Headstone Photo Tool">
  <title>Headstone Photo Tool</title>
  ${mark}
  ${word('Headstone', 540, 880, 190, C.dark)}
  ${word('Photo Tool', 540, 1040, 190, C.amber)}
</svg>
`;

// App icon: the picture alone on a rounded square, for the page tab and the apps list (96 px)
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="Headstone Photo Tool">
  <rect width="96" height="96" rx="12" fill="${C.dark}"/>
  <g transform="translate(.5 12.8) scale(.088)">
    <g fill="none" stroke="${C.amber}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round">
      <path d="M214 196V116a34 34 0 0 1 34-34h96"/><path d="M866 196V116a34 34 0 0 0-34-34h-96"/>
      <path d="M214 604v80a34 34 0 0 0 34 34h96"/><path d="M866 604v80a34 34 0 0 1-34 34h-96"/>
    </g>
    <path fill="${C.pale}" d="M340 640V330a200 200 0 0 1 400 0v310z"/>
    <rect x="425" y="338" width="230" height="34" rx="17" fill="${C.dark}"/>
    <rect x="460" y="396" width="160" height="26" rx="13" fill="${C.dark}" opacity=".7"/>
    <rect x="250" y="620" width="580" height="64" rx="32" fill="${C.green}"/>
    <path fill="${C.amber}" stroke="${C.dark}" stroke-width="14" stroke-linejoin="round" d="M728 128c-50 0-88 38-88 86 0 66 88 150 88 150s88-84 88-150c0-48-38-86-88-86z"/>
    <circle cx="728" cy="214" r="30" fill="${C.dark}"/>
  </g>
</svg>
`;

fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets/logo.svg'), logo);
fs.writeFileSync(path.join(root, 'assets/icon.svg'), icon);
console.log('assets/logo.svg and assets/icon.svg written');
