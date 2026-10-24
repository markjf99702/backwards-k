// Keeps score of a game in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) problems.push('left the site: ' + r.url()); });

const tap = sel => page.locator(sel).first().click();
const ticker = () => page.locator('.ticker p').textContent();
const bases = () => page.evaluate(() => [...document.querySelectorAll('.runner')].map(r => r.dataset.runner + ':' + r.textContent.trim()).join(' '));
const fitsPhone = async what => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${what} scrolls sideways`);
const step = name => console.log('·', name);

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
await fitsPhone('the home screen');
assert.match(await page.textContent('.hero h1'), /Keep score/);

step('starting a game, with a pasted lineup');
await tap('text=Score a new game');
await page.fill('[data-side="0"] [data-name]', 'Foxes');
await page.fill('[data-side="1"] [data-name]', 'Comets');
await tap('[data-side="0"] summary');
await tap('[data-side="0"] [data-paste]');
await page.fill('.sheet textarea', '1. 2 Ruiz SS\nOkafor #11\n24 Brennan\nCastillo, 7\nLindqvist\nMarsh\nDelgado\nHan\nPruitt');
await tap('[data-x=use]');
assert.equal(await page.inputValue('[data-side="0"] [data-i="3"][data-f="name"]'), 'Castillo');
assert.equal(await page.inputValue('[data-side="0"] [data-i="3"][data-f="num"]'), '7');
await fitsPhone('the new game screen');
await tap('[data-go]');
await page.waitForSelector('.live .field');
assert.match(await page.textContent('.batter'), /Ruiz/);

step('four balls make a walk');
for (let i = 0; i < 4; i++) await tap('[data-p=b]');
assert.equal(await bases(), '1:Ruiz');
assert.match(await ticker(), /Ruiz walks/);
assert.match(await page.textContent('.pitcher'), /4\s*pitches/);

step('a strikeout looking, then swinging');
for (const k of ['f', 'f', 'f', 'c']) await tap(`[data-p=${k}]`);
assert.match(await ticker(), /Okafor strikes out looking/);
await tap('[data-r="K"]');
assert.match(await ticker(), /Brennan strikes out swinging/);

step('a single with a runner on: the runners sheet, then Save');
await tap('[data-r="1B"]');
await page.waitForSelector('.sheet .moves');
assert.equal(await page.locator('.mv[data-from="1"] [aria-pressed=true]').textContent(), '2nd');
await tap('.mv[data-from="1"] [data-to="3"]');
await tap('[data-x=save]');
assert.equal(await bases(), '3:Ruiz 1:Castillo');

step('a stolen base, undo and redo');
await tap('[data-runner="1"]');
await tap('[data-k="SB"]');
assert.equal(await bases(), '3:Ruiz 2:Castillo');
await tap('.bar .undo');
assert.equal(await bases(), '3:Ruiz 1:Castillo');
await tap('[data-a=redo]');
assert.equal(await bases(), '3:Ruiz 2:Castillo');

step('a ground out with fielders; the third out ends the half');
await tap('[data-r="GO"]');
await tap('[data-pos="6"]');
await tap('[data-pos="3"]');
await tap('[data-x=done]');
await tap('[data-x=save]');
assert.match(await page.textContent('.bar .title'), /Bottom 1st/);
assert.equal(await bases(), '');

step('the card: the walk, the backwards K, and a box’s story');
await tap('[data-v=card]');
await tap('[data-cs="0"]');
const card = await page.locator('.card').innerHTML();
assert.match(card, /scale\(-1 1\)/, 'a backwards K on the card');
assert.match(card, />6-3</);
await fitsPhone('the card');
await tap('[data-cell="0"]');
assert.match(await page.textContent('.sheet'), /Ruiz walks\./);
assert.match(await page.textContent('.sheet'), /To third on Castillo’s single\./);
await page.keyboard.press('Escape');
// Fix a box after the fact: the backwards K was really swinging.
await tap('[data-cell="1"]');
await tap('[data-sw="K"]');
await page.keyboard.press('Escape');
assert.doesNotMatch(await page.locator('.card').innerHTML(), /scale\(-1 1\)/, 'changed to a K swinging');

step('a pinch hitter and a new pitcher');
await tap('[data-v=live]');
await tap('[data-a=batter]');
await tap('[data-y=ph]');
await page.fill('.sheet [data-f=name]', 'Kowalski');
await tap('[data-x=go]');
assert.match(await page.textContent('.batter'), /Kowalski/);
await tap('[data-p=b]');
await tap('[data-a=pitcher]');
await tap('[data-y=new]');
await page.fill('.sheet [data-f=name]', 'Moreno');
await tap('[data-x=go]');
assert.match(await page.textContent('.pitcher'), /Moreno\s*0\s*pitches/);

step('a home run, the box score, the play-by-play');
await tap('[data-r="HR"]');
assert.match(await page.textContent('.bug'), /Comets\s*1/i);
await tap('[data-v=box]');
assert.match(await page.textContent('.pane[data-p=box]'), /Moreno/);
assert.match(await page.textContent('.pane[data-p=box]'), /Home runs: Kowalski/);
await tap('[data-v=plays]');
assert.match(await page.textContent('.plays'), /Kowalski pinch-hits for Batter 1/);
await fitsPhone('the plays');

step('ending the game early, and keeping going');
await tap('[data-v=live]');
await tap('[data-a=menu]');
await tap('[data-y=end]');
assert.match(await page.textContent('.final h2'), /Comets win, 1–0/);
await tap('[data-a=on]');
assert.equal(await page.locator('.final').count(), 0);

step('it’s all still there after a reload');
const state = () => page.evaluate(() => [document.querySelector('.linescore').textContent, document.querySelector('.ticker p').textContent, document.querySelector('.bar .title').textContent].join('|'));
const before = await state();
await page.reload();
await page.waitForSelector('.live .field');
assert.equal(await state(), before);

step('sharing: a link that opens the whole game somewhere else');
const link = await page.evaluate(async () => {
  const { linkFor } = await import('./js/share.js');
  const { store } = await import('./js/store.js');
  return linkFor(store.all()[0]);
});
assert.ok(link.startsWith('https://backwards-k.junkdrawer.works/#s=z'), link.slice(0, 60));
const friend = await browser.newContext({ viewport: { width: 390, height: 844 } });
const fp = await friend.newPage();
fp.on('pageerror', e => problems.push('friend: ' + e.message));
await fp.goto(base + link.slice(link.indexOf('#')));
await fp.waitForSelector('[data-a=keep]');
assert.match(await fp.textContent('.bar .title'), /Foxes\s*0\s*–\s*1\s*Comets/);
await fp.click('[data-a=keep]');
await fp.waitForSelector('.live .field');
await fp.goto(base);
assert.equal(await fp.locator('.gi').count(), 1);
// The same link again: there's nothing new in it.
await fp.goto(base + link.slice(link.indexOf('#')));
await fp.click('[data-a=keep]');
await fp.waitForSelector('.live .field');
assert.equal(await fp.textContent('#toast'), 'You already have this game.');
await friend.close();

step('the sample game');
await page.goto(base + '#/sample');
await page.waitForSelector('.card');
assert.match(await page.textContent('.linescore'), /FOXES/i);
await fitsPhone('the sample');

step('deleting a game, and taking it back');
await page.goto(base);
assert.equal(await page.locator('.gi').count(), 1);
await tap('.gi');
await tap('[data-a=menu]');
await tap('[data-y=delete]');
await tap('[data-y=delete]');
await page.waitForSelector('.hero');
assert.equal(await page.locator('.gi').count(), 0);
await tap('.toast button');
await page.waitForSelector('.live .field');

// A phone of its own for each of these, with its own storage (init: a script to run before the page's own).
async function phone(init) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  if (init) await c.addInitScript(init);
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  return p;
}
async function startGame(p, away = 'Owls') {
  await p.goto(base + '#/new');
  await p.fill('[data-side="0"] [data-name]', away);
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  return p.evaluate(() => location.hash.slice(4));
}
const stored = (p, id) => p.evaluate(id => JSON.parse(localStorage.getItem('backwards-k.v1')).games[id], id);
const plays = async (p, id) => (await stored(p, id)).ev.map(e => e.t + (e.r || '')).join(' ');
const shown = p => p.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; });

step('Fix runners, then leaving the game: the play is still there');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r="1B"]');
  await p.click('[data-r="2B"]');
  await p.click('[data-x=save]');
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  await p.goBack();
  await p.waitForSelector('.setup');
  await p.goto(base + '#/g/' + id);
  await p.waitForSelector('.live .field');
  assert.match(await p.textContent('.ticker p'), /doubles/);
  await p.click('[data-p=b]');
  assert.equal(await plays(p, id), 'pa1B pa2B p');

  step('Fix runners while another tab saves: the fix replaces the play, once');
  await p.click('[data-r="1B"]');
  await p.click('[data-x=save]');
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  const other = await p.context().newPage();
  await startGame(other, 'Larks');
  await other.close();
  await p.waitForTimeout(200);
  await p.click('.mv[data-from="2"] [data-to="4"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await plays(p, id), 'pa1B pa2B p pa1B');
  assert.deepEqual((await stored(p, id)).ev.at(-1).m.find(x => x[0] === 2), [2, 4]);
  assert.match(await p.textContent('.ticker p'), /Batter 2 scores/);

  step('Fix runners while another tab scores in the same game: nothing changes, and it says so');
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  const same = await p.context().newPage();
  await same.goto(base + '#/g/' + id);
  await same.waitForSelector('.live .field');
  await same.click('[data-p=b]');
  await same.close();
  await p.waitForTimeout(200);
  await p.click('.sheet [data-x=save]');
  assert.match(await shown(p), /The game changed somewhere else while this was open/);
  assert.equal(await plays(p, id), 'pa1B pa2B p pa1B p');
  await p.context().close();
}

step('Fix runners, then Cancel, while a name is being saved: nothing is lost');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r="1B"]');
  await p.click('[data-a=batter]');
  await p.fill('.sheet [data-f=name]', 'Okafor');
  await p.click('.sheet [data-close]');
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  await p.waitForTimeout(600); // the name's save goes through while the sheet is open
  await p.click('.sheet [data-close]');
  await p.reload();
  await p.waitForSelector('.live .field');
  assert.equal(await plays(p, id), 'pa1B');
  assert.equal((await stored(p, id)).teams[0].lineup[1][0].name, 'Okafor');
  assert.match(await p.textContent('.ticker p'), /singles/);

  step('a name still waiting to be saved when another tab saves is kept, and so is the next pitch');
  await p.click('[data-a=batter]');
  await p.fill('.sheet [data-f=name]', 'Han');
  await p.click('.sheet [data-close]');
  await p.evaluate(async () => (await import('./js/store.js')).store.reload()); // what another tab's save does here
  await p.click('[data-p=b]');
  await p.waitForTimeout(500);
  assert.equal((await stored(p, id)).teams[0].lineup[1][0].name, 'Han');
  assert.equal(await plays(p, id), 'pa1B p');

  step('a name typed just before leaving the game is saved');
  await p.click('[data-a=batter]');
  await p.fill('.sheet [data-f=name]', 'Ruiz Jr');
  await p.click('.sheet [data-close]');
  await p.click('.bar .back');
  await p.waitForSelector('.hero');
  await p.reload();
  await p.waitForSelector('.hero');
  assert.equal((await stored(p, id)).teams[0].lineup[1][0].name, 'Ruiz Jr');
  await p.context().close();
}

step('undoing a pitcher brought back keeps both pitchers and every change');
{
  const p = await phone(), id = await startGame(p);
  const pitcher = async () => { await p.click('[data-a=pitcher]'); await p.waitForSelector('.sheet [data-y=new]'); };
  await pitcher();
  await p.click('[data-y=new]');
  await p.fill('.sheet [data-f=name]', 'Bishop');
  await p.click('[data-x=go]');
  await p.click('[data-r=K]');
  for (const j of [0, 1]) { await pitcher(); await p.click('[data-y=back]'); await p.click(`[data-j="${j}"]`); }
  await p.click('.bar .undo');
  assert.deepEqual((await stored(p, id)).teams[1].pitchers.map(x => x.name), ['', 'Bishop']);
  await p.reload();
  await p.waitForSelector('.live .field');
  const kept = await p.evaluate(async id => (await import('./js/store.js')).store.get(id).ev.filter(e => e.t === 'pch').map(e => e.i), id);
  assert.deepEqual(kept, [1, 0]);
  await p.context().close();
}

step('a device that’s out of room: one line says so, and nothing claims it was saved');
{
  const p = await phone(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'backwards-k.v1' && sessionStorage.getItem('full')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  });
  await startGame(p);
  assert.equal(await p.locator('.trouble').isVisible(), false);
  await p.evaluate(() => sessionStorage.setItem('full', '1'));
  await p.click('[data-p=b]');
  assert.match(await p.textContent('.trouble'), /out of room, so the latest plays aren’t saved yet/);
  assert.equal(await shown(p), '', 'no toast as well');
  await p.click('[data-p=b]');
  assert.equal(await shown(p), '');
  const [file] = await Promise.all([p.waitForEvent('download'), p.click('.trouble button')]);
  assert.match(file.suggestedFilename(), /owls-at-home\.backwards-k\.json$/);
  // A shared game can't be saved either, and the toast says so.
  await p.goto(base + link.slice(link.indexOf('#')));
  await p.click('[data-a=keep]');
  assert.match(await shown(p), /Couldn’t save it: this device is out of room/);
  // Room again: the next save works and the line goes.
  await p.evaluate(() => sessionStorage.removeItem('full'));
  await p.waitForSelector('.live .field');
  await p.click('[data-p=b]');
  assert.equal(await p.locator('.trouble').isVisible(), false);
  await p.context().close();
}

step('a browser that won’t store anything: the line says so from the start');
{
  const p = await phone(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } }));
  await startGame(p);
  assert.match(await p.textContent('.trouble'), /This browser isn’t letting Backwards K save/);
  await p.click('[data-p=b]');
  assert.equal(await shown(p), '');
  await p.context().close();
}

step('starting a game asks the browser to keep this site’s games');
{
  const p = await phone(() => { navigator.storage.persist = () => { window.asked = (window.asked || 0) + 1; return Promise.resolve(false); }; });
  await startGame(p);
  assert.equal(await p.evaluate(() => window.asked), 1);
  await p.context().close();
}

step('a file that isn’t a game says so');
{
  const p = await phone();
  await p.goto(base);
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-a=import]')]);
  await chooser.setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
  await p.waitForFunction(() => !document.getElementById('toast').hidden);
  assert.equal(await shown(p), 'That file isn’t a Backwards K backup or game.');
  await p.context().close();
}

step('tablet sizes: side by side, nothing sideways');
for (const [w, h] of [[820, 1180], [1180, 820]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${w} wide scrolls sideways`);
  assert.ok(await page.locator('.live .field').isVisible() && await page.locator('.card').isVisible(), `${w} wide shows the controls and the card together`);
}
await page.setViewportSize({ width: 390, height: 844 });

step('it works offline once opened');
await page.goto(base);
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.gi');
assert.equal(await page.title(), 'Backwards K');
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
