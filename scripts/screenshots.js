#!/usr/bin/env node
'use strict';
// Takes the README screenshots from the real browser version, using Chrome and the photos in a folder.
//   npm run build:web
//   (node scripts/serve-web.js &)            # serves headstone-tool/ with proxies for the WikiTree and map lookups
//   PHOTOS="data/albums/Fairmont test" node scripts/screenshots.js
// Needs internet (WikiTree and OpenStreetMap lookups) and takes a few minutes: the photos are really imported and read.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const photosDir = path.resolve(root, process.env.PHOTOS || 'data/albums/Fairmont test');
const out = path.join(root, 'docs/screenshots');
const base = `http://localhost:${process.env.PORT || 8790}/?api=/wtapi&overpass=/overpass&nominatim=/nominatim&nominatimSearch=/nominatim-search`;
const photographer = { name: process.env.PHOTOGRAPHER_NAME || 'Azure Robinson', wikitreeId: process.env.PHOTOGRAPHER_ID || 'Robinson-27225' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Repo-friendly size: 1600 px wide (the shots are taken at 2x)
const shrink = (file) => {
  try {
    const { execFileSync } = require('child_process');
    const width = +execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', file]).toString().match(/pixelWidth: (\d+)/)[1];
    if (width > 1600) execFileSync('/usr/bin/sips', ['--resampleWidth', '1600', file], { stdio: 'ignore' });
  } catch { /* sips is macOS only; keep the full size elsewhere */ }
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const files = fs.readdirSync(photosDir).filter((f) => /\.(heic|jpe?g|png)$/i.test(f)).sort().map((f) => path.join(photosDir, f));
  if (!files.length) throw new Error('No photos in ' + photosDir);
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  const shot = async (name, opts = {}) => { await sleep(400); const f = path.join(out, name); await page.screenshot({ path: f, ...opts }); shrink(f); console.log('docs/screenshots/' + name); };
  const api = (p, body) => page.evaluate((p, body) => window.HWWeb.api(p, body), p, body);

  await page.goto(base, { waitUntil: 'networkidle0' });
  await api('/api/settings', { photographer });

  // 1. The import dialog, with photos chosen and the cemetery left blank
  await page.click('#n-import');
  await (await page.$('#i-files')).uploadFile(...files);
  await page.evaluate(() => document.querySelector('#dlg').scrollTo(0, 0));
  await shot('import.png');

  // Really import them
  await page.click('#go');
  await page.waitForFunction(() => document.querySelector('#x') && document.querySelector('#x').textContent === 'Close', { timeout: 15 * 60 * 1000, polling: 1000 });
  console.log('imported:', await page.evaluate(() => document.querySelector('#dlg .log').textContent.split('\n').slice(-3).join(' | ')));
  await page.click('#x');

  // WikiTree matches for everyone
  const job = await api('/api/check-all', {});
  await page.waitForFunction(async (id) => (await window.HWWeb.api('/api/jobs/' + id)).status !== 'running', { timeout: 10 * 60 * 1000, polling: 1500 }, job.id);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('tr[data-id]');
  await sleep(1500); // thumbnails

  // 2. The worklist
  await shot('worklist.png');

  const state = await api('/api/state');
  const byName = (re) => state.people.find((p) => re.test(`${p.given} ${p.surname}`));
  const open = async (p) => { await page.evaluate((id) => { location.hash = '#/person/' + id; }, p.id); await page.waitForSelector('#f-given'); await sleep(1200); };

  // 3. A person page, whole
  await open(byName(/Bears/));
  await shot('person.png', { fullPage: true });

  // 4. How a stone was read: the couple stone, where the readings voted
  await open(byName(/Pietro/));
  const card = await page.evaluateHandle(() => document.querySelector('pre.ocr').closest('.card'));
  await card.asElement().screenshot({ path: path.join(out, 'readings.png') });
  shrink(path.join(out, 'readings.png'));
  console.log('docs/screenshots/readings.png');

  // 5. The plot map dialog (a taller window so the whole dialog fits)
  await page.setViewport({ width: 1280, height: 1900, deviceScaleFactor: 2 });
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('#n-plot');
  await page.click('#n-plot');
  await page.waitForFunction(() => document.querySelector('#pm-table') && document.querySelector('#pm-cats'), { timeout: 120000, polling: 500 });
  await page.evaluate(() => document.querySelector('#dlg').scrollTo(0, 0));
  const box = await page.evaluate(() => { const r = document.querySelector('#dlg').getBoundingClientRect(); return { bottom: Math.ceil(r.bottom) }; });
  await shot('plot-map.png', { clip: { x: 0, y: 0, width: 1280, height: Math.min(1900, box.bottom + 40) } });
  await page.evaluate(() => document.querySelector('#dlg').close());

  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
