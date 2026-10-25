// Keeps score of a game in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { sampleGame } from '../js/sample.js';
import { replay } from '../js/engine.js';

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
const bases = (p = page) => p.evaluate(() => [...document.querySelectorAll('.runner')].map(r => r.dataset.runner + ':' + r.textContent.trim()).join(' '));
const fitsPhone = async what => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${what} scrolls sideways`);
const step = name => console.log('·', name);
// Where an element is, and whether it's wholly inside another one.
const box = (p, sel) => p.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }, sel);
const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
await fitsPhone('the home screen');
assert.match(await page.textContent('.hero h1'), /Keep score/);

step('starting a game, with a pasted lineup');
await tap('text=Score a new game');
await page.waitForSelector('[data-side="0"] [data-name]');
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-side="0"] [data-name]')).fontSize), '26px', 'team names in the scoreboard type');
await page.fill('[data-side="0"] [data-name]', 'Foxes');
await page.fill('[data-side="1"] [data-name]', 'Comets');
// Paste a lineup is out in the open, beside the size of the order.
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
for (const k of ['f', 'f', 'f']) await tap(`[data-p=${k}]`);
// Two strikes, but a runner on first and nobody out: a dropped third strike is still an out (OBR 5.09(a)(3)).
await tap('[data-a=more]');
assert.equal(await page.locator('.sheet [data-r2=KD]').isDisabled(), true);
assert.match(await page.textContent('.sheet [data-r2=KD]'), /No dropped third strike with a runner on first and fewer than two out/);
await tap('.sheet [data-close]');
await tap('[data-p=c]');
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

step('an error can’t move a runner onto a base that’s taken');
await tap('[data-runner="2"]');
await tap('.sheet [data-k="E"]');
assert.equal(await page.textContent('#toast'), 'Someone’s on third. Move them up too.');
assert.equal(await page.locator('.sheet .pick').count(), 0, 'no fielders to pick');
await tap('.sheet [data-close]');
assert.equal(await bases(), '3:Ruiz 2:Castillo');

step('a ground out with fielders; the third out ends the half');
await tap('[data-r="GO"]');
await tap('[data-pos="6"]');
await tap('[data-pos="3"]');
await tap('[data-x=done]');
// The batter made the third out, so nobody could move up or score: there's nothing to ask.
assert.equal(await page.locator('.sheet .moves').count(), 0);
assert.equal(await ticker(), 'Lindqvist grounds out, short to first (6-3).');
assert.equal(await page.locator('[data-a=fixlast]').count(), 1);
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
// A walk on four balls can't be switched to anything else here, and the sheet says what to do instead.
assert.match(await page.textContent('.sheet'), /This one can’t be changed here\. Undo takes plays back/);
await page.keyboard.press('Escape');
// Fix a box after the fact: the backwards K was really swinging.
await tap('[data-cell="1"]');
assert.doesNotMatch(await page.textContent('.sheet'), /can’t be changed here/);
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
assert.match(await page.textContent('.pane[data-p=box]'), /Moreno[^]*\b1 strike\b/, 'Moreno has thrown one pitch');
assert.doesNotMatch(await page.textContent('.pane[data-p=box]'), /\b1 strikes/);
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
// The message and its Undo on one line, in the middle of the phone.
const note = await box(page, '#toast');
assert.ok(note.bottom - note.top < 60 && Math.abs(note.left - (390 - note.right)) < 1, `the toast is one centred line (${JSON.stringify(note)})`);
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
const shown = p => p.evaluate(() => document.getElementById('toast').textContent);

step('pasting a lineup from a group text: names with commas, and the pitcher');
{
  const p = await phone();
  await p.goto(base + '#/new');
  await p.click('[data-side="1"] [data-paste]');
  await p.fill('.sheet textarea', 'Lineup today: Emma, Liam, Noah, Ava, Mia, Lucas, Zoe, Eli, Ruby, Finn\nPitcher: Olivia #22');
  await p.click('[data-x=use]');
  assert.equal(await p.textContent('[data-side="1"] [data-size]'), '10 batters');
  assert.equal(await p.inputValue('[data-side="1"] [data-i="9"][data-f="name"]'), 'Finn');
  assert.deepEqual([await p.inputValue('[data-side="1"] [data-pf="num"]'), await p.inputValue('[data-side="1"] [data-pf="name"]')], ['22', 'Olivia']);
  assert.equal(await p.locator('[data-side="1"] details').getAttribute('open'), '', 'the lineup opens to show them');
  await p.context().close();
}

step('naming a lineup: Enter goes to the next batter’s name, past the number');
{
  const p = await phone();
  await p.goto(base + '#/new');
  await p.click('[data-side="0"] summary');
  const focused = () => p.evaluate(() => { const a = document.activeElement; return `${a.dataset.i ?? a.dataset.slot}:${a.dataset.f}:${a.enterKeyHint}`; });
  await p.fill('[data-side="0"] [data-i="0"][data-f=name]', 'Emma');
  await p.press('[data-side="0"] [data-i="0"][data-f=name]', 'Enter');
  assert.equal(await focused(), '1:name:next');
  await p.fill('[data-side="0"] [data-i="8"][data-f=name]', 'Eli');
  await p.press('[data-side="0"] [data-i="8"][data-f=name]', 'Enter');
  assert.equal(await p.evaluate(() => document.activeElement.tagName), 'BODY', 'the last one is done');
  assert.equal(await p.getAttribute('[data-side="0"] [data-i="8"][data-f=name]', 'enterkeyhint'), 'done');
  assert.match(await p.url(), /#\/new$/, 'and the game hasn’t started');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  await p.press('.sheet [data-slot="0"][data-f=name]', 'Enter');
  assert.equal(await focused(), '1:name:next');
  await p.context().close();
}

step('the next new game starts with the last game’s innings and pitch counting');
{
  const p = await phone();
  await p.goto(base + '#/new');
  assert.equal(await p.getAttribute('[data-inn="9"]', 'aria-pressed'), 'true', 'nine on a new device');
  await p.click('[data-inn="6"]');
  await p.uncheck('input[name=pitches]');
  // Play ball, and straight back to New game: the game screen doesn't come back over it a moment later.
  await p.evaluate(() => { document.querySelector('[data-go]').click(); setTimeout(() => { location.hash = '#/new'; }, 20); });
  await p.waitForTimeout(200);
  assert.deepEqual(await p.evaluate(() => [location.hash, !!document.querySelector('.setup'), !!document.querySelector('.live')]), ['#/new', true, false]);
  assert.equal(await p.getAttribute('[data-inn="6"]', 'aria-pressed'), 'true');
  assert.equal(await p.isChecked('input[name=pitches]'), false);
  await p.context().close();
}

step('the end of the order the first time through: a warning on deck, and a batter added from the batter sheet');
{
  const p = await phone(), id = await startGame(p);
  for (const r of ['BB', 'BB', 'BB', 'K', 'BB', 'K', 'BB']) await p.click(`[data-r=${r}]`);
  assert.equal(await p.locator('.deck small').count(), 0, 'not yet');
  await p.click('[data-r=BB]');
  assert.equal(await p.textContent('.deck'), 'On deck Batter 1Top of the order');
  await p.click('[data-a=batter]');
  await p.click('.sheet [data-y=add]');
  assert.equal(await p.textContent('.deck'), 'On deck Batter 10');
  assert.equal((await stored(p, id)).teams[0].lineup.length, 10);
  await p.click('.bar .undo');
  assert.equal(await p.textContent('.deck'), 'On deck Batter 1Top of the order');
  assert.equal((await stored(p, id)).teams[0].lineup.length, 9);
  await p.context().close();
}

step('a pinch runner, and then the starter back in from Lineups: the same player, not a new one');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-a=batter]');
  await p.fill('.sheet [data-f=num]', '21');
  await p.fill('.sheet [data-f=name]', 'Morris');
  await p.click('.sheet [data-close]');
  await p.click('[data-r="1B"]');
  await p.click('[data-runner="1"]');
  await p.click('.sheet [data-k=PR]');
  assert.equal(await p.locator('.sheet [data-back]').count(), 0, 'nobody to bring back yet');
  await p.fill('.sheet [data-f=name]', 'Diaz');
  await p.click('[data-x=go]');
  assert.equal(await bases(p), '1:Diaz');
  for (let i = 0; i < 3; i++) await p.click('[data-r=K]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  await p.click('.sheet [data-ls="0"]');
  assert.match(await p.textContent('.sheet [data-slot="0"]'), /Earlier: Morris/);
  await p.click('.sheet [data-sub="0"]');
  assert.equal(await p.textContent('.sheet [data-back]'), 'Morris #21');
  await p.click('.sheet [data-back="0"]');
  assert.equal(await p.textContent('.ticker p'), 'Morris comes back in for Diaz.');
  assert.match(await p.textContent('.sheet [data-slot="0"]'), /Earlier: Diaz/, 'back on the Lineups sheet');
  await p.keyboard.press('Escape');
  const subs = async () => { const g = await stored(p, id); return [g.teams[0].lineup[0].map(x => x.name).join(), g.ev.filter(e => e.t === 'sub').map(e => e.i).join()]; };
  assert.deepEqual(await subs(), ['Morris,Diaz', '1,0']);
  await p.click('.bar .undo');
  assert.deepEqual(await subs(), ['Morris,Diaz', '1'], 'undo keeps Diaz: his own change still points at him');
  await p.click('[data-a=redo]');
  assert.deepEqual(await subs(), ['Morris,Diaz', '1,0']);
  await p.click('[data-v=box]');
  const rows = await p.$$eval('.pane[data-p=box] .stats:first-of-type tbody th', ths => ths.slice(0, 2).map(th => th.textContent));
  assert.deepEqual(rows, ['1Morris', 'PR Diaz']);
  await p.click('[data-v=card]');
  await p.click('[data-cs="0"]');
  assert.match(await p.textContent('.card tbody tr:first-child .names'), /^MorrisPR 1st Diazback 1st Morris$/);
  await p.context().close();
}

step('a reliever picked from the batting order, and the pitcher’s day in plain words');
{
  const p = await phone();
  await p.goto(base + '#/new');
  await p.click('[data-side="1"] [data-paste]');
  await p.fill('.sheet textarea', 'Emma 7, Liam 12, Noah, Olivia 22');
  await p.click('[data-x=use]');
  // The starting pitcher, picked from the order on the new game screen.
  await p.click('[data-side="1"] .from-order [data-pick="3"]');
  assert.deepEqual([await p.inputValue('[data-side="1"] [data-pf="num"]'), await p.inputValue('[data-side="1"] [data-pf="name"]')], ['22', 'Olivia']);
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  const id = await p.evaluate(() => location.hash.slice(4));
  await p.click('[data-p=b]');
  await p.click('[data-r=K]');
  await p.click('[data-a=pitcher]');
  assert.equal(await p.textContent('.sheet p.quiet'), '2 pitches (1 strike), 1 out, 1 batter faced, 0 hits, 0 runs, 0 walks, 1 strikeout.');
  await p.click('.sheet [data-y=new]');
  // Olivia is pitching already; everyone else in the order is a tap away.
  assert.deepEqual(await p.$$eval('.sheet [data-pick]', b => b.map(x => x.textContent)), ['Emma #7', 'Liam #12', 'Noah']);
  await p.click('.sheet [data-pick="1"]');
  assert.deepEqual([await p.inputValue('.sheet [data-f=num]'), await p.inputValue('.sheet [data-f=name]')], ['12', 'Liam']);
  await p.click('[data-x=go]');
  assert.match(await p.textContent('.pitcher'), /Liam\s*0\s*pitches/);
  assert.deepEqual((await stored(p, id)).teams[1].pitchers, [{ name: 'Olivia', num: '22' }, { name: 'Liam', num: '12' }]);
  for (let i = 0; i < 4; i++) await p.click('[data-p=b]');
  await p.click('[data-r=K]');
  await p.click('[data-a=pitcher]');
  assert.equal(await p.textContent('.sheet p.quiet'), '5 pitches (1 strike), 1 out, 2 batters faced, 0 hits, 0 runs, 1 walk, 1 strikeout.');
  await p.keyboard.press('Escape');

  step('two substitutions in a row from the Lineups sheet');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  for (const [slot, name] of [[1, 'Kim'], [2, 'Lee']]) {
    await p.click(`.sheet [data-sub="${slot}"]`);
    await p.fill('.sheet [data-f=name]', name);
    await p.click('[data-x=go]');
    assert.match(await p.textContent('.sheet h2'), /Lineups/, 'back on the Lineups sheet');
    assert.equal(await p.getAttribute('.sheet [data-ls="0"]', 'aria-pressed'), 'true', 'on the same team');
  }
  assert.deepEqual((await stored(p, id)).ev.filter(e => e.t === 'sub').map(e => `${e.slot}:${e.i}`), ['1:1', '2:1']);
  await p.context().close();
}

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

step('after a walk-off, the runner left on is still drawn, and can’t be moved');
{
  const p = await phone();
  await startGame(p);
  await p.click('[data-a=menu]');
  await p.click('[data-y=settings]');
  await p.selectOption('.sheet [data-g=innings]', '3');
  await p.click('.sheet [data-close]');
  for (let i = 0; i < 15; i++) await p.click('[data-r=K]');
  await p.click('[data-r=BB]');
  await p.click('[data-r="3B"]');
  await p.click('.sheet [data-x=save]');
  assert.match(await p.textContent('.final h2'), /Home win, 1–0/);
  assert.equal(await p.locator('.live [data-runner]').count(), 0);
  assert.equal(await p.textContent('.live .runner'), 'Left on third: Batter 8');
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
  await p.waitForFunction(() => document.getElementById('toast').textContent);
  assert.equal(await shown(p), 'That file isn’t a Backwards K backup or game.');
  await p.context().close();
}

// A sample game stopped partway: the first moment that passes the test, on a device of its own.
function sampleUntil(seed, test) {
  const g = sampleGame(seed), all = g.ev;
  g.id = 'gsample' + seed + 'cut';
  for (let n = 1; n < all.length; n++) if (test(replay({ ...g, ev: all.slice(0, n) }))) { g.ev = all.slice(0, n); break; }
  return g;
}
// The top of the 7th with a runner on second.
function seventh(names) {
  const g = sampleUntil(7, S => S.inn === 7 && S.half === 0 && S.bases[2]);
  if (names) names.forEach((name, s) => { g.teams[s].name = name; });
  return g;
}
async function playing(g, viewport = { width: 390, height: 844 }) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await c.addInitScript(doc => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('backwards-k.v1', doc); sessionStorage.setItem('seeded', '1'); }
  }, JSON.stringify({ app: 'backwards-k', v: 1, games: { [g.id]: g }, gone: {} }));
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await p.goto(base + '#/g/' + g.id);
  await p.waitForSelector('.live .field');
  await p.evaluate(() => document.fonts.ready);
  return p;
}

step('a phone in the 7th: the Card tab opens on the batter’s box');
{
  const p = await playing(seventh());
  const latest = await p.evaluate(() => {
    const r = document.querySelector('.recent'), h = r.querySelector('h3').getBoundingClientRect(), half = r.querySelector('.half').getBoundingClientRect();
    return { under: half.top >= h.bottom - 0.5, across: Math.abs(half.width - r.getBoundingClientRect().width) < 1 };
  });
  assert.deepEqual(latest, { under: true, across: true }, 'Latest plays: the list under its heading, all the way across');
  await p.click('[data-v=card]');
  await p.waitForTimeout(100);
  const next = await box(p, '.pane[data-p=card] td.next'), wrap = await box(p, '.pane[data-p=card] .card-wrap');
  const names = await box(p, '.pane[data-p=card] tbody th.who');
  assert.ok(inside(next, wrap), `the batter’s box is on screen (${next.left}-${next.right} in ${wrap.left}-${wrap.right})`);
  assert.ok(next.left >= names.right - 0.5, 'and not under the names');
  // Away and back again: still there.
  await p.click('[data-v=live]');
  await p.click('[data-p=b]');
  await p.click('[data-v=card]');
  await p.waitForTimeout(100);
  assert.ok(inside(await box(p, '.pane[data-p=card] td.next'), wrap), 'still on screen after a pitch');

  step('a box the keyboard reaches isn’t hidden under the names');
  // Scrolled one inning along: the 1st inning's box is still on screen, but under the sticky names.
  await p.evaluate(() => { const w = document.querySelector('.pane[data-p=card] .card-wrap'); w.scrollLeft = w.querySelector('tbody tr:first-child td').offsetWidth; });
  await p.focus('.pane[data-p=card] tbody tr:first-child [data-cell]');
  await p.waitForTimeout(100);
  const first = await box(p, '.pane[data-p=card] tbody tr:first-child [data-cell]');
  assert.ok(first.left >= (await box(p, '.pane[data-p=card] tbody th.who')).right - 0.5, `the 1st inning’s box starts at ${first.left}, beside the names`);

  step('nine innings and R H E fit across a phone');
  for (const tab of ['card', 'box']) {
    await p.click(`[data-v=${tab}]`);
    const lw = `.pane[data-p=${tab}] .line-wrap`;
    assert.ok(inside(await box(p, `${lw} tbody tr:last-child td.rhe:last-child`), await box(p, lw)), `the line score on the ${tab} tab shows E`);
  }

  step('the buttons stay put as the line under the field changes');
  await p.click('[data-v=live]');
  const ball = async () => (await box(p, '[data-p=b]')).top;
  const at = await ball();
  await p.click('[data-r="1B"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await p.locator('[data-a=fixlast]').count(), 1);
  assert.equal(await ball(), at, 'after a single with a runner on, and Fix runners');
  await p.click('.bar .undo');
  assert.equal(await p.locator('[data-a=redo]').count(), 1);
  assert.equal(await ball(), at, 'after Undo, and Redo');
  await p.context().close();
}

step('extra innings on a small phone: the line score shows the 15th and R H E, and who’s who');
{
  const p = await playing(sampleUntil(130, S => S.inn === 15), { width: 360, height: 740 });
  for (const tab of ['card', 'box']) {
    await p.click(`[data-v=${tab}]`);
    const lw = `.pane[data-p=${tab}] .line-wrap`, wrap = await box(p, lw);
    assert.ok(inside(await box(p, `${lw} thead th.cur`), wrap), `the 15th on the ${tab} tab`);
    assert.ok(inside(await box(p, `${lw} tbody tr:last-child td.rhe:last-child`), wrap), `E on the ${tab} tab`);
    assert.ok(inside(await box(p, `${lw} tbody tr:last-child th`), wrap), `the team name on the ${tab} tab`);
  }
  await p.context().close();
}

step('everyday team names fit the bar on one line');
for (const width of [360, 390]) {
  const p = await playing(seventh(['Westside Thunder', 'Eastlake Lightning']), { width, height: 800 });
  const fit = await p.evaluate(() => {
    const t = document.querySelector('.bar .title'), names = [...t.querySelectorAll('b')].map(b => b.getBoundingClientRect().top);
    return { title: t.scrollHeight, bar: document.querySelector('.bar-in').clientHeight, rows: new Set(names.map(Math.round)).size };
  });
  assert.ok(fit.title <= fit.bar, `${width}: the title is ${fit.title}px in a ${fit.bar}px bar`);
  assert.equal(fit.rows, 1, `${width}: both names on one line`);
  assert.match(await p.textContent('.bar .title'), /Westside Thunder\s*1\s*–\s*3\s*Eastlake Lightning/);
  await p.context().close();
}

step('Fix runners only after a play with runners, or the batter safe');
{
  const p = await phone();
  await startGame(p);
  assert.match(await p.textContent('.recent'), /The first pitch is all yours/);
  await p.click('[data-p=b]');
  assert.match(await p.textContent('.recent'), /No plays yet: the first at-bat is still going\./, 'Latest plays once a pitch is in');
  await p.click('[data-r=K]');
  assert.equal(await p.locator('[data-a=fixlast]').count(), 0, 'not after a strikeout with nobody on');
  await p.click('[data-r=GO]');
  await p.click('.sheet [data-x=skip]');
  assert.equal(await p.locator('[data-a=fixlast]').count(), 0, 'not after a ground out with nobody on');
  await p.click('[data-r=E]');
  await p.click('.sheet [data-x=skip]');
  assert.equal(await p.locator('[data-a=fixlast]').count(), 1, 'after the batter reaches');

  step('Game settings: the counting switch is a tick box beside its words, and turns the pitches off');
  await p.click('[data-a=menu]');
  await p.click('[data-y=settings]');
  const tick = await box(p, '.sheet [data-g=pitches]'), words = await box(p, '.sheet .switch > span');
  assert.equal(tick.right - tick.left, 24, 'a 24px tick box');
  assert.ok(words.left > tick.right && words.top < tick.bottom, 'with its words beside it');
  await p.click('.sheet [data-g=pitches]');
  await p.click('.sheet [data-close]');
  assert.equal(await p.locator('.pitches').count(), 0, 'no Ball and Strike buttons');
  await p.context().close();
}

step('a ground out 6-3 from a keyboard alone: Enter and Space pick the fielders');
{
  const p = await phone();
  await startGame(p);
  const keys = async (key, n = 1) => { for (let i = 0; i < n; i++) await p.keyboard.press(key); };
  const at = () => p.evaluate(() => { const a = document.activeElement; return a.dataset.pos || a.dataset.x || a.tagName; });
  await p.focus('[data-r=GO]');
  await keys('Enter');
  await p.waitForSelector('.sheet .pick');
  assert.equal(await p.getAttribute('.sheet [data-pos="6"]', 'aria-label'), '6, shortstop');
  await keys('Tab', 6); // from the heading past 1 to 5
  assert.equal(await at(), '6');
  await keys('Enter');
  assert.match(await p.textContent('.sheet .seq'), /^6U shortstop$/);
  assert.equal(await at(), '6', 'still on the shortstop after picking him');
  assert.equal(await p.getAttribute('.sheet [data-pos="6"]', 'aria-pressed'), 'true');
  assert.equal(await p.getAttribute('.sheet [data-pos="6"]', 'aria-label'), '6, shortstop, picked 1st');
  await keys('Shift+Tab', 3);
  assert.equal(await at(), '3');
  await keys('Space');
  assert.match(await p.textContent('.sheet .seq'), /^6-3 shortstop to first baseman$/);
  for (let i = 0; i < 12 && await at() !== 'done'; i++) await keys('Tab');
  await keys('Enter');
  assert.equal(await p.textContent('.ticker p'), 'Batter 1 grounds out, short to first (6-3).');

  step('and by number: 4, 3, then Enter');
  await p.focus('[data-r=GO]');
  await keys('Enter');
  await p.waitForSelector('.sheet .pick');
  await keys('4');
  await keys('5');
  await keys('Backspace');
  await keys('3');
  assert.match(await p.textContent('.sheet .seq'), /^4-3 /);
  await keys('Enter');
  assert.equal(await p.textContent('.ticker p'), 'Batter 2 grounds out, second to first (4-3).');
  // The help's drawing of the field says which number is which.
  await p.click('[data-v=card]');
  await p.click('.pane[data-p=card] [data-a=help]');
  assert.match(await p.getAttribute('.sheet .whole-field', 'aria-label'), /1 pitcher, 2 catcher, 3 first baseman.* 6 shortstop.* 9 right fielder$/);
  await p.context().close();
}

step('fewer taps: a double play with one runner on, and a triple play with two, save with no runners sheet');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r="1B"]');
  await p.click('[data-r=DP]');
  for (const n of [6, 4, 3]) await p.click(`.sheet [data-pos="${n}"]`);
  await p.click('.sheet [data-x=done]');
  assert.equal(await p.locator('.sheet .moves').count(), 0, 'nothing to ask: both are out');
  assert.equal(await p.textContent('.ticker p'), 'Batter 2 grounds into a double play (6-4-3). Batter 1 is out at second.');
  assert.equal(await p.locator('.outs .o.on').count(), 2);
  assert.equal(await p.locator('[data-a=fixlast]').count(), 1, 'and Fix runners is there for an odd one');
  await p.click('[data-r=K]');
  await p.click('[data-r="1B"]');
  await p.click('[data-r="1B"]');
  await p.click('.sheet [data-x=save]');
  await p.click('[data-a=more]');
  await p.click('.sheet [data-r2=TP]');
  await p.click('.sheet [data-x=skip]');
  assert.equal(await p.locator('.sheet .moves').count(), 0, 'nothing to ask: all three are out');
  assert.match(await p.textContent('.bar .title'), /Top 2nd/);

  step('fewer taps: on a single with two out, the runner on second is sent home');
  await p.click('[data-r=K]');
  await p.click('[data-r="2B"]');
  await p.click('[data-r="1B"]');
  assert.equal(await p.locator('.mv[data-from="2"] [aria-pressed=true]').textContent(), '3rd', 'with one out he stops at third');
  await p.click('.sheet [data-close]');
  await p.click('[data-r=K]');
  await p.click('[data-r="1B"]');
  assert.equal(await p.locator('.mv[data-from="2"] [aria-pressed=true]').textContent(), 'Home', 'with two out he’s running');
  await p.click('.sheet [data-x=save]');
  assert.match(await p.textContent('.bug'), /Owls\s*1/i);
  assert.equal(await plays(p, id), 'pa1B paDP paK pa1B pa1B paTP paK pa2B paK pa1B');
  await p.context().close();
}

step('Fix runners after the next pitch: the fix goes in, and the pitch stays');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r="2B"]');
  await p.click('[data-r="1B"]');
  await p.click('.sheet [data-x=save]'); // the runner from second stops at third
  await p.click('[data-p=b]');
  assert.equal(await p.locator('[data-a=fixlast]').count(), 1, 'still there after a ball');
  assert.equal(await p.getAttribute('[data-a=fixlast]', 'aria-label'), 'Fix runners: Batter 2 singles. Batter 1 to third.');
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  assert.match(await p.textContent('.sheet h2'), /Single/);
  assert.equal(await p.locator('.mv[data-from="2"] [aria-pressed=true]').textContent(), '3rd');
  await p.click('.mv[data-from="2"] [data-to="4"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await plays(p, id), 'pa2B pa1B p');
  assert.deepEqual((await stored(p, id)).ev[1].m.find(x => x[0] === 2), [2, 4]);
  assert.match(await p.textContent('.bug'), /Owls\s*1/i);
  assert.equal(await p.textContent('.ticker p'), 'Ball (1-0)');
  assert.equal(await p.locator('.count .b.on').count(), 1, 'the ball is still there');
  assert.equal(await bases(p), '1:Batter 2');

  step('a fix after a pitch that would add an out is refused, and nothing changes');
  const was = JSON.stringify((await stored(p, id)).ev);
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  await p.click('.mv[data-from="0"] [data-to="0"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await shown(p), 'That changes the outs. Undo back to that play instead.');
  assert.equal(JSON.stringify((await stored(p, id)).ev), was);
  assert.equal(await p.locator('.outs .o.on').count(), 0);
  assert.equal(await bases(p), '1:Batter 2');

  step('and once that at-bat is over, Fix runners goes');
  for (let i = 0; i < 3; i++) await p.click('[data-p=b]');
  assert.match(await p.textContent('.ticker p'), /walks/);
  assert.equal(await p.locator('[data-a=fixlast]').count(), 0);
  await p.context().close();
}

step('a box’s “Change what it was” offers only what could have happened');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r=K]');
  await p.click('[data-r="1B"]');
  await p.click('[data-v=card]');
  await p.click('[data-cell="0"]');
  const off = () => p.evaluate(() => [...document.querySelectorAll('.sheet [data-sw]')].filter(b => b.disabled).map(b => b.dataset.sw).join(' '));
  assert.equal(await off(), 'SF SAC', 'the leadoff strikeout: nobody on to sacrifice, nobody to score');
  assert.equal(await p.getAttribute('.sheet [data-sw=SAC]', 'title'), 'Nobody was on base.');
  await p.keyboard.press('Escape');
  await p.click('[data-cell="1"]');
  assert.equal(await off(), 'FC KD', 'a single with nobody on and no strikes: no fielder’s choice, no dropped third strike');

  step('switching a single to an error asks who made it');
  await p.click('.sheet [data-sw=E]');
  await p.waitForSelector('.sheet .pick');
  await p.click('.sheet [data-pos="6"]');
  assert.match(await p.textContent('.sheet .cell-big'), /E6 Error/);
  assert.equal((await stored(p, id)).ev[1].f.join(), '6');
  await p.keyboard.press('Escape');
  assert.match(await p.locator('.card').innerHTML(), />E6</);
  // Skip leaves the fielders blank.
  await p.click('[data-cell="0"]');
  await p.click('.sheet [data-sw=GO]');
  await p.click('.sheet [data-x=skip]');
  assert.match(await p.textContent('.sheet .cell-big'), /G Ground out/);
  assert.equal((await stored(p, id)).ev[0].r, 'GO');
  assert.equal((await stored(p, id)).ev[0].f, undefined);
  await p.context().close();
}

step('a wild pitch that moves two runners is one play, and one wild pitch');
{
  const p = await phone(), id = await startGame(p);
  const row = (from, to) => `.sheet [data-from="${from}"] [data-to="${to}"]`;
  await p.click('[data-r="1B"]');
  await p.click('[data-r=BB]');
  await p.click('[data-runner="2"]');
  assert.equal(await p.locator('.sheet .also [data-from="1"] [aria-pressed=true]').textContent(), 'Stayed', 'the others stay unless they’re moved');
  await p.click(row(1, 2));
  await p.click('.sheet [data-k=WP]');
  assert.equal(await plays(p, id), 'pa1B paBB r');
  assert.deepEqual((await stored(p, id)).ev[2].m, [[2, 3, 'WP'], [1, 2, 'WP']]);
  assert.equal(await bases(p), '3:Batter 1 2:Batter 2');
  assert.equal(await p.textContent('.ticker p'), 'Batter 1 moves to third on a wild pitch. Batter 2 moves to second on a wild pitch.');
  const counted = () => p.evaluate(async id => {
    const { replay } = await import('./js/engine.js'), { store } = await import('./js/store.js');
    const S = replay(store.get(id));
    return { wp: S.pitching[1][0].wp, E: S.E[1] };
  }, id);
  assert.deepEqual(await counted(), { wp: 1, E: 0 });

  step('moving runners together can’t put two on a base or pass the runner ahead');
  await p.click('[data-runner="2"]');
  await p.click('.sheet [data-k=PB]');
  assert.equal(await shown(p), 'Someone’s on third. Move them up too.');
  await p.click(row(2, 4));
  await p.click('.sheet [data-k=OA]');
  assert.equal(await shown(p), 'Someone’s on third. Move them up too.');
  await p.click(row(3, 4));
  await p.click('.sheet [data-k=E]');
  await p.click('.sheet [data-pos="2"]');
  assert.deepEqual((await stored(p, id)).ev[3].m, [[3, 4, 'E', [2]], [2, 4, 'E', [2]]]);
  assert.deepEqual(await counted(), { wp: 1, E: 1 }, 'one throw, one error');
  assert.match(await p.textContent('.bug'), /Owls\s*2/i);
  await p.click('[data-r="1B"]');
  await p.click('[data-r="1B"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await bases(p), '2:Batter 3 1:Batter 4');
  await p.click('[data-runner="1"]');
  await p.click(row(1, 3));
  await p.click('.sheet [data-k=OA]');
  assert.equal(await shown(p), 'Someone’s on second. Move them up too.');
  await p.click(row(2, 3));
  await p.click('.sheet [data-k=OA]');
  assert.equal(await shown(p), 'Two runners can’t both be on third.');
  await p.click(row(1, 4));
  await p.click('.sheet [data-k=OA]');
  assert.equal(await shown(p), 'A runner can’t pass the runner ahead of them.');
  await p.keyboard.press('Escape');
  assert.equal(await plays(p, id), 'pa1B paBB r r pa1B pa1B', 'and nothing was saved');
  await p.context().close();
}

step('a screen reader hears each play and where things stand, in a region that stays put');
{
  const p = await phone();
  await startGame(p);
  const said = async () => { await p.waitForFunction(() => document.getElementById('said').textContent); return p.textContent('#said'); };
  const region = await p.$('#said');
  await p.click('[data-p=b]');
  assert.equal(await said(), 'Ball. 1 ball, 0 strikes.');
  assert.equal(await p.getAttribute('.ticker p', 'aria-live'), null, 'the ticker isn’t a live region of its own');
  await p.click('[data-r="1B"]');
  assert.equal(await said(), 'Batter 1 singles. Runner on first, nobody out.');
  await p.click('[data-r="2B"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await said(), 'Batter 2 doubles. Batter 1 to third. Runners on second and third, nobody out.');
  await p.click('[data-p=s]');
  await p.click('[data-r=HR]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await said(), 'Batter 3 hits a home run. Batter 1 scores. Batter 2 scores. Owls 3, Home 0. Nobody on, nobody out.');
  await p.click('.bar .undo');
  assert.equal(await said(), 'Took back: Batter 3 hits a home run. Batter 1 scores. Batter 2 scores. Runners on second and third, nobody out, 0 balls, 1 strike.');
  assert.equal(await region.evaluate(el => el.isConnected), true, 'the same region all along');
  const board = await p.textContent('.bug');
  assert.match(board, /Owls\s*0, batting/);
  assert.match(board, /Top of the 1st/);
  assert.match(board, /0 outs/);
  assert.equal(await p.textContent('.count .sr'), '0 balls, 1 strike');
  await p.context().close();
}

step('the keyboard stays where it was after each tap, and comes back when a sheet closes');
{
  const p = await phone();
  await startGame(p);
  const on = sel => p.evaluate(sel => document.activeElement.matches(sel), sel);
  await p.focus('[data-p=b]');
  await p.keyboard.press('Enter');
  assert.equal(await on('[data-p=b]'), true, 'still on Ball after a ball');
  await p.keyboard.press('Space');
  assert.equal(await p.locator('.count .b.on').count(), 2);
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Tab');
  assert.equal(await on('[data-p=b]'), true, 'Tab order goes on from there');
  await p.focus('[data-r="1B"]');
  await p.keyboard.press('Enter');
  assert.equal(await on('[data-r="1B"]'), true, 'still on 1B after a single');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.sheet .moves');
  await p.focus('.mv[data-from="1"] [data-to="3"]');
  await p.keyboard.press('Enter');
  assert.equal(await on('.mv[data-from="1"] [data-to="3"]'), true, 'still on the chip in the runners sheet');
  assert.equal(await p.getAttribute('.mv[data-from="1"] [data-to="3"]', 'aria-pressed'), 'true');
  await p.focus('.sheet [data-x=save]');
  await p.keyboard.press('Enter');
  assert.equal(await on('[data-r="1B"]'), true, 'back on 1B when the sheet closes');
  await p.focus('[data-runner="3"]');
  await p.keyboard.press('Enter');
  await p.focus('.sheet [data-k=SB]');
  await p.keyboard.press('Enter');
  assert.equal(await on('[data-p=b]'), true, 'the runner went home: on to the first pitch button');
  await p.click('[data-v=card]');
  await p.focus('[data-cs="1"]');
  await p.keyboard.press('Enter');
  assert.equal(await on('[data-cs="1"]'), true, 'still on Whose card');
  await p.context().close();
}

step('each screen says what it is, and the keyboard lands on its heading');
{
  const p = await phone();
  await p.goto(base);
  assert.equal(await p.title(), 'Backwards K');
  const heading = async () => { await p.waitForFunction(() => document.activeElement.tagName === 'H1'); return p.evaluate(() => document.activeElement.textContent); };
  await p.focus('.hero a[href="#/new"]');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.setup');
  assert.equal(await heading(), 'New game');
  assert.equal(await p.title(), 'New game · Backwards K');
  assert.equal(await p.getAttribute('[data-side="0"] [data-step="1"]', 'aria-label'), 'One more batter');
  assert.equal(await p.getAttribute('[data-side="0"] [data-i="2"][data-f="name"]', 'aria-label'), 'Batter 3 name');
  await p.click('[data-side="0"] [data-step="1"]');
  assert.equal(await p.textContent('[data-side="0"] [data-size]'), '10 batters');
  await p.fill('[data-side="0"] [data-name]', 'Foxes');
  await p.fill('[data-side="1"] [data-name]', 'Comets');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  assert.equal(await heading(), 'Foxes at Comets');
  assert.equal(await p.locator('main.game h1').count(), 1);
  assert.equal(await p.title(), 'Foxes 0, Comets 0 · Top 1st · Backwards K');
  await p.click('[data-r=HR]');
  assert.equal(await p.title(), 'Foxes 1, Comets 0 · Top 1st · Backwards K');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  assert.equal(await p.getAttribute('.sheet [data-slot="2"][data-f="name"]', 'aria-label'), 'Batter 3 name');
  assert.equal(await p.getAttribute('.sheet [data-sub="1"]', 'aria-label'), 'Sub for Batter 2');
  assert.equal(await p.getAttribute('.sheet [data-pi="0"][data-f="name"]', 'aria-label'), 'Pitcher 1 name');
  await p.context().close();
}

step('after deleting a game, Undo has the keyboard and waits for it; Escape lets it go');
{
  const p = await phone(), id = await startGame(p);
  const del = async () => { await p.click('[data-a=menu]'); await p.click('.sheet [data-y=delete]'); await p.click('.sheet [data-y=delete]'); await p.waitForSelector('.hero'); };
  await del();
  assert.equal(await p.evaluate(() => document.activeElement === document.querySelector('#toast button')), true, 'Undo has the keyboard');
  await p.waitForTimeout(6500);
  assert.equal(await shown(p), 'Game deleted.Undo', 'still there while it has the keyboard');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.live .field');
  assert.ok(await stored(p, id), 'the game is back');
  await del();
  await p.keyboard.press('Escape');
  assert.equal(await shown(p), '');
  assert.equal(await p.evaluate(() => document.activeElement.matches('.hero h1')), true, 'the keyboard goes to the page');
  assert.equal(await stored(p, id), undefined);
  // The pointer over it keeps it too.
  await p.evaluate(async () => (await import('./js/ui.js')).toast('Hello.', { ms: 300 }));
  await p.hover('#toast');
  await p.waitForTimeout(600);
  assert.equal(await shown(p), 'Hello.');
  await p.context().close();
}

step('zoomed in to 150% and 200% (260 and 195 pixels across), nothing scrolls sideways');
for (const width of [260, 195]) {
  const c = await browser.newContext({ viewport: { width, height: Math.round(width * 844 / 390) }, hasTouch: true, serviceWorkers: 'block' });
  await c.addInitScript(doc => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('backwards-k.v1', doc); sessionStorage.setItem('seeded', '1'); } },
    JSON.stringify({ app: 'backwards-k', v: 1, games: { gsample7cut: seventh() }, gone: {} }));
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  const fits = async what => assert.deepEqual(await p.evaluate(() => {
    const b = document.querySelector('dialog[open] .sheet-body');
    return [document.documentElement.scrollWidth <= innerWidth, !b || b.scrollWidth <= b.clientWidth];
  }), [true, true], `${width}: ${what} scrolls sideways`);
  await p.goto(base + '#/g/gsample7cut');
  await p.waitForSelector('.live .field');
  await fits('the game');
  await p.$eval('[data-r="1B"]', b => b.click());
  await p.waitForSelector('.sheet .moves');
  await fits('the runners sheet');
  await p.keyboard.press('Escape');
  await p.$eval('[data-runner="2"]', b => b.click());
  await fits('the runner sheet');
  await p.keyboard.press('Escape');
  for (const v of ['card', 'box', 'plays']) { await p.$eval(`[data-v=${v}]`, b => b.click()); await fits(`the ${v} tab`); }
  await p.goto(base + '#/new');
  await p.waitForSelector('.setup');
  await fits('the new game screen');
  await c.close();
}

step('a game whose last play is one this version doesn’t know still opens');
{
  const g = sampleUntil(7, S => S.inn === 2);
  g.id = 'gunknownlast';
  g.ev.push({ t: 'pa', r: 'ZZ', m: [[0, 1]] }); // from a damaged file, or a newer copy of the app
  const p = await playing(g);
  assert.equal(await p.locator('[data-a=fixlast]').count(), 0, 'nothing to fix');
  assert.equal(await p.locator('[data-r="1B"]').isVisible(), true, 'and scoring goes on');
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

step('a tablet on its side: every button, down to More, without scrolling');
for (const [width, height] of [[1024, 768], [1024, 690], [1180, 740]]) {
  const p = await playing(seventh(), { width, height });
  const fit = await p.evaluate(() => ({ more: document.querySelector('[data-a=more]').getBoundingClientRect().bottom, live: document.querySelector('.live').getBoundingClientRect().bottom, ih: innerHeight }));
  assert.ok(fit.more <= fit.live + 0.5 && fit.more <= fit.ih, `${width}x${height}: More ends at ${fit.more}, the column at ${fit.live}, the screen at ${fit.ih}`);
  await p.context().close();
}

step('on paper, the line score’s R H E are in black');
{
  const p = await playing(seventh(), { width: 800, height: 1100 });
  await p.evaluate(async id => {
    window.print = () => {};
    const { printGame } = await import('./js/share.js'), { store } = await import('./js/store.js');
    printGame(store.get(id));
  }, 'gsample7cut');
  await p.emulateMedia({ media: 'print' });
  const inks = await p.evaluate(() => [...document.querySelectorAll('#print .linescore td.rhe')].map(td => getComputedStyle(td).color));
  assert.deepEqual([...new Set(inks)], ['rgb(0, 0, 0)']);
  // A page each: the title, the line score and the visitors' card on the first, then the home card, then the box
  // score; each card whole on its page, and every inning column (played or not) as wide as the next. Letter, with
  // the .4in margins, upright and on its side.
  for (const [w, h] of [[7.7, 10.2], [10.2, 7.7]]) {
    await p.setViewportSize({ width: Math.round(w * 96), height: Math.round(h * 96) });
    const got = await p.evaluate(() => {
      const r = el => el.getBoundingClientRect(), [a, b] = document.querySelectorAll('#print .pcard');
      const cols = [...a.querySelectorAll('tbody tr:first-child td:not(.tot)')].map(td => r(td).width);
      return { first: r(a).bottom - r(document.querySelector('#print h1')).top, second: r(b).height, cols, breaks: [a, b, document.querySelector('#print .pbox')].map(x => getComputedStyle(x).breakBefore) };
    });
    const page = h * 96;
    assert.ok(got.first < page && got.second < page, `${w}x${h}in: the cards take ${got.first} and ${got.second} of ${page}`);
    assert.ok(Math.max(...got.cols) - Math.min(...got.cols) < 1, `${w}x${h}in: inning columns ${got.cols.join(', ')}`);
    assert.equal(got.cols.length, 9);
    assert.deepEqual(got.breaks, ['auto', 'page', 'page']);
  }
  await p.context().close();
}

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
