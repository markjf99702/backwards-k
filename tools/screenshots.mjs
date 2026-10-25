// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// The pictures come from the sample game (js/sample.js, seeded), so the same ones come out every time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleGame } from '../js/sample.js';
import { replay } from '../js/engine.js';

const require = createRequire(import.meta.url);
const UPNG = require('upng-js');
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// The sample game stopped partway: the 6th or later, one out, two on, and a count going.
const full = sampleGame(7);
full.date = '2026-06-13'; // a fixed day, or the date in the pictures would change every day
let cut = full.ev.length;
for (let i = 1; i < full.ev.length; i++) {
  const S = replay({ ...full, ev: full.ev.slice(0, i) });
  if (S.inn >= 6 && S.outs === 1 && [1, 2, 3].filter(b => S.bases[b]).length >= 2 && S.b + S.s >= 3) { cut = i; break; }
}
const live = { ...full, id: 'gscreens', ev: full.ev.slice(0, cut), updated: Date.now() };
const finished = { ...full, id: 'gfinal', updated: Date.now() - 1000 };

async function open(viewport, deviceScaleFactor, hash, scheme = 'light') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, isMobile: viewport.width < 700, hasTouch: true, serviceWorkers: 'block', colorScheme: scheme });
  const page = await ctx.newPage();
  await page.addInitScript(games => {
    if (!localStorage.getItem('backwards-k.v1')) localStorage.setItem('backwards-k.v1', JSON.stringify({ app: 'backwards-k', v: 1, games, gone: {} }));
  }, { [live.id]: live, [finished.id]: finished });
  await page.goto(base + hash);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return page;
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2, '#/g/gscreens');
  await page.screenshot({ path: join(root, 'docs/phone-score.png') });
  await page.click('[data-r="1B"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(root, 'docs/phone-runners.png') });
  await page.goto(base + '#/g/gfinal');
  await page.click('[data-v=card]');
  await page.click('[data-cs="1"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(root, 'docs/phone-card.png') });
  await page.context().close();
}
// A tablet on its side: the buttons and the card together.
{
  const page = await open({ width: 1180, height: 820 }, 1, '#/g/gscreens');
  await page.screenshot({ path: join(root, 'docs/tablet.png') });
  await page.context().close();
}

// Link preview, 1200 x 630: a card with the name and a line on the left, and a piece of the sample game's real
// scorecard on the right.
// (The card is drawn as wide as a computer shows it, with its big boxes, and the first 706 pixels of it are used.)
{
  const page = await open({ width: 1440, height: 900 }, 1, '#/g/gfinal');
  await page.click('[data-cs="1"]');
  await page.waitForTimeout(200);
  const at = await page.locator('.card-wrap').boundingBox();
  const pic = (await page.screenshot({ fullPage: true, clip: { x: at.x, y: at.y, width: 706, height: at.height } })).toString('base64');
  const font = async f => (await readFile(join(root, 'fonts', f))).toString('base64');
  const [bs, ss] = [await font('big-shoulders.woff2'), await font('source-sans-3.woff2')];
  const icon = await readFile(join(root, 'icon.svg'), 'utf8');
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<style>
    @font-face { font-family: BS; src: url(data:font/woff2;base64,${bs}); font-weight: 400 900; }
    @font-face { font-family: SS; src: url(data:font/woff2;base64,${ss}); font-weight: 400 800; }
    html, body { margin: 0; overflow: hidden; }
    body { width: 1200px; height: 630px; background: #1c2a44; color: #f4efe2; position: relative; font-family: SS; }
    .l { position: absolute; left: 64px; top: 70px; width: 440px; }
    .l svg { width: 96px; height: 96px; display: block; }
    h1 { font: 900 84px/.92 BS; text-transform: uppercase; margin: 30px 0 22px; letter-spacing: .01em; white-space: nowrap; }
    p { font-size: 30px; line-height: 1.28; margin: 0; color: #d9dde6; max-width: 400px; }
    .r { position: absolute; left: 560px; top: 0; right: 0; bottom: 0; }
    .r img { position: absolute; left: 0; top: 64px; width: 860px; border-radius: 14px; box-shadow: 0 30px 60px rgba(0,0,0,.45); transform: rotate(-3deg); transform-origin: 0 0; }
  </style><div class="l">${icon}<h1>Backwards K</h1><p>Keep score at the ballpark. Tap what happened; the scorecard fills itself in.</p></div>
  <div class="r"><img src="data:image/png;base64,${pic}"></div>`);
  await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; });
  await page.waitForTimeout(200);
  // A 256-colour palette keeps the picture small enough for link previews to fetch quickly.
  const img = UPNG.decode(await page.screenshot());
  await writeFile(join(root, 'og.png'), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
