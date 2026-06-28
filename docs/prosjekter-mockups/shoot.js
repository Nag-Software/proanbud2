// Regenerate the prosjekter-mockup screenshots from mockups.html.
//
//   node docs/prosjekter-mockups/shoot.js
//
// Drives the locally-installed Google Chrome via puppeteer-core (already a
// dependency). mockups.html @font-faces the repo's Satoshi-Variable.woff2 via an
// absolute path, so the render matches the real app typeface. Each `.screen`
// element is captured to its own PNG at 2x.
const path = require('path');
const puppeteer = require(path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'));

const DIR = __dirname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SHOTS = [
  ['s-baseline', 'mock-0-baseline.png'],
  ['s-rich', 'mock-A-rikere-kort.png'],
  ['s-list', 'mock-B-liste.png'],
  ['s-kanban', 'mock-C-statustavle.png'],
  ['s-focus', 'mock-D-fokus.png'],
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1520, height: 1000, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(DIR, 'mockups.html'), { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await new Promise(r => setTimeout(r, 600));
  for (const [id, file] of SHOTS) {
    const el = await page.$('#' + id + ' .screen');
    if (!el) { console.log('MISSING', id); continue; }
    await el.screenshot({ path: path.join(DIR, file) });
    console.log('shot', file);
  }
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
