#!/usr/bin/env node
'use strict';
// Renders the logo SVGs to PNG with a transparent background, using Chrome (no extra downloads).
//   CHROME=/path/to/chrome node scripts/render-assets.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// [source, output, size, background]: no background means transparent. The white ones are for blogs and social media,
// which often show images on dark or coloured backgrounds where the dark-green wordmark would disappear.
const jobs = [
  ['logo.svg', 'logo-1080.png', 1080], ['logo.svg', 'logo-500.png', 500], ['logo.svg', 'logo-500-white.png', 500, '#ffffff'],
  ['logo.svg', 'logo-500-circle.png', 500, '#ffffff', 'circle'],
  ['icon.svg', 'icon-512.png', 512], ['icon.svg', 'icon-96.png', 96], ['icon.svg', 'icon-32.png', 32],
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();
  for (const [src, out, size, background, shape] of jobs) {
    const svg = fs.readFileSync(path.join(root, 'assets', src), 'utf8');
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    if (shape === 'circle') {
      // The logo sits inside a circle (for round profile photos); the corners outside the circle stay transparent
      await page.setContent(`<style>html,body{margin:0;background:transparent}.c{width:${size}px;height:${size}px;border-radius:50%;background:${background};display:flex;align-items:center;justify-content:center}svg{display:block;width:${Math.round(size * 0.74)}px;height:${Math.round(size * 0.74)}px}</style><div class="c">${svg}</div>`);
    } else {
      await page.setContent(`<style>html,body{margin:0;background:${background || 'transparent'}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    }
    await page.screenshot({ path: path.join(root, 'assets', out), omitBackground: !background || shape === 'circle', clip: { x: 0, y: 0, width: size, height: size } });
    console.log('assets/' + out);
  }
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
