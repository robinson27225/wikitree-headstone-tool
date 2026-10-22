#!/usr/bin/env node
'use strict';
// Renders the logo SVGs to PNG with a transparent background, using Chrome (no extra downloads).
//   CHROME=/path/to/chrome node scripts/render-assets.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const jobs = [['logo.svg', 'logo-1080.png', 1080], ['icon.svg', 'icon-512.png', 512], ['icon.svg', 'icon-96.png', 96], ['icon.svg', 'icon-32.png', 32]];

(async () => {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();
  for (const [src, out, size] of jobs) {
    const svg = fs.readFileSync(path.join(root, 'assets', src), 'utf8');
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: path.join(root, 'assets', out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('assets/' + out);
  }
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
