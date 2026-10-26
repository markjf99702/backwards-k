// The one-file copy works on its own:  npm run test:dist  (builds dist/ first, then opens it in Chromium)
// dist/backwards-k.html straight from the disk, on a phone: it starts, its fonts are in it, a game is scored (a pitch,
// a single, a double with the runners sheet, a ground out 6-3) and is still there after a reload, and nothing is
// asked of any other file or site. Then dist/artifact.html in a page that supplies its own <html> and <body>, dark.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(join(root, 'dist/backwards-k.html')).href;
const step = name => console.log('·', name);

const browser = await pw.chromium.launch();
const problems = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  p.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) problems.push('asked for ' + r.url()); });

  step('it opens from the disk, with its own fonts');
  await p.goto(url);
  await p.evaluate(() => document.fonts.ready);
  assert.match(await p.textContent('.hero h1'), /Keep score/);
  assert.deepEqual(await p.evaluate(() => Promise.all(['Big Shoulders', 'Source Sans 3', 'Patrick Hand'].map(f => document.fonts.load(`16px "${f}"`).then(l => l.length > 0 && l.every(x => x.status === 'loaded'))))), [true, true, true]);
  assert.equal(await p.evaluate(() => 'single' in document.documentElement.dataset), true);

  step('a game is scored in it, and is still there after a reload');
  await p.click('text=Score a new game');
  await p.fill('[data-side="0"] [data-name]', 'Owls');
  await p.fill('[data-side="1"] [data-name]', 'Hawks');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  await p.click('[data-p=b]');
  await p.click('[data-r="1B"]');
  await p.click('[data-r="2B"]');
  await p.waitForSelector('.sheet .moves');
  await p.click('.sheet [data-x=save]');
  await p.click('[data-r=GO]');
  await p.click('.sheet [data-pos="6"]');
  await p.click('.sheet [data-pos="3"]');
  await p.click('.sheet [data-x=done]');
  await p.click('.sheet .mv[data-from="3"] [data-to="4"]');
  await p.click('.sheet .mv[data-from="2"] [data-to="3"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await p.textContent('.ticker p'), 'Batter 3 grounds out, short to first (6-3). Batter 1 scores. Batter 2 to third. Owls take the lead, 1–0.');
  await p.reload();
  await p.waitForSelector('.live .field');
  assert.match(await p.textContent('.bar .title'), /Owls\s*1\s*–\s*0\s*Hawks/);
  assert.equal(await p.textContent('.ticker p'), 'Batter 3 grounds out, short to first (6-3). Batter 1 scores. Batter 2 to third. Owls take the lead, 1–0.');
  await ctx.close();

  step('the copy for a host that supplies the page around it, in its dark look');
  const fragment = await readFile(join(root, 'dist/artifact.html'), 'utf8');
  const host = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const h = await host.newPage();
  h.on('pageerror', e => problems.push('artifact: ' + e.message));
  await h.setContent(`<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${fragment}</body></html>`);
  await h.waitForSelector('.hero h1');
  const dark = await h.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) < 200);
  assert.equal(dark, true, 'dark when the host says so');
  await host.close();
} finally {
  await browser.close();
}
assert.deepEqual(problems, [], 'no errors, and nothing asked of another file or site');
console.log('all good');
