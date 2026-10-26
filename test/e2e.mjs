// Keeps score of a game in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { sampleGame } from '../js/sample.js';
import { replay, now as upNow, suggest } from '../js/engine.js';
import { newGame } from '../js/model.js';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// For the offline tests: hold leaves requests unanswered (one bar of signal at the ballpark): true for every one, or
// a Set of the paths it holds. release() answers them after all, or drops them. delay answers every request that many
// ms late. extra adds to the end of a file (a new version on the server), and oldWorker serves the sw.js phones had
// before (test/sw-before.js).
let hold = false, oldWorker = false, delay = 0;
const held = [], extra = {};
const release = (answer = true) => { for (const h of held.splice(0)) if (answer) h.answer(); else h.res.destroy(); };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const answer = async () => {
    let body;
    try { body = await readFile(join(root, path === '/' ? 'index.html' : path === '/sw.js' && oldWorker ? 'test/sw-before.js' : path)); } catch { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
    res.end(extra[path] ? Buffer.concat([body, Buffer.from(extra[path])]) : body);
  };
  if (hold === true || (hold && hold.has(path))) held.push({ path, res, answer });
  else if (delay) setTimeout(answer, delay);
  else answer();
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
// The message on screen (on the page, or in an open sheet's own line), and that it's really seen: what's at its middle
// is part of it, not a sheet drawn over it.
const seen = p => p.evaluate(() => {
  const t = [...document.querySelectorAll('.toast')].find(x => x.textContent);
  if (!t) return '';
  const r = t.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return t.contains(at) ? t.textContent : `hidden under ${at ? at.tagName + '.' + at.className : 'nothing'}: ${t.textContent}`;
});

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
// Both strikeout buttons say so, under the K and the backwards K.
assert.deepEqual(await page.$$eval('[data-r=K] span, [data-r=KL] span', s => s.map(x => x.textContent)), ['Strikeout', 'Strikeout looking']);
for (const k of ['f', 'f', 'f']) await tap(`[data-p=${k}]`);
// Two strikes, but a runner on first and nobody out: a dropped third strike is still an out (OBR 5.09(a)(3)).
await tap('[data-a=more]');
assert.equal(await page.locator('.sheet [data-r2=KD]').isDisabled(), true);
assert.match(await page.textContent('.sheet [data-r2=KD]'), /No dropped third strike with a runner on first and fewer than two out/);
// The pitch clock: an automatic ball moves the count, and isn't a pitch (taken back again here).
await tap('.sheet [data-ap=b]');
assert.equal(await ticker(), 'Automatic ball (1-2)');
assert.match(await page.textContent('.pitcher'), /Pitcher7pitches/);
assert.equal(await page.locator('.count .lamps').first().locator('.on').count(), 1, 'one ball on the board');
await tap('.bar .undo');
await tap('[data-p=c]');
assert.match(await ticker(), /Okafor strikes out looking/);
await tap('[data-r="K"]');
assert.match(await ticker(), /Brennan strikes out swinging/);

step('a single with a runner on: the runners sheet, then Save');
await tap('[data-r="1B"]');
await page.waitForSelector('.sheet .moves');
assert.deepEqual(await page.$$eval('.sheet .mv p', ps => ps.map(x => x.textContent)), ['Ruizwas on first', 'Castilloat bat']);
assert.equal(await page.locator('.mv[data-from="1"] [data-to][aria-pressed=true]').textContent(), '2nd');
await tap('.mv[data-from="1"] [data-to="3"]');
await tap('[data-x=save]');
assert.equal(await bases(), '3:Ruiz 1:Castillo');

step('a stolen base, undo and redo');
await tap('[data-runner="1"]');
await tap('[data-k="SB"]');
assert.equal(await bases(), '3:Ruiz 2:Castillo');
await tap('.bar .undo');
assert.equal(await bases(), '3:Ruiz 1:Castillo');
// The line under the field says which play went, beside Redo; Redo puts it back, and the line says the play again.
assert.equal(await ticker(), 'Took back: Castillo steals second.');
await tap('[data-a=redo]');
assert.equal(await bases(), '3:Ruiz 2:Castillo');
assert.equal(await ticker(), 'Castillo steals second.');

step('an error can’t move a runner onto a base that’s taken');
await tap('[data-runner="2"]');
await tap('.sheet [data-k="E"]');
assert.equal(await seen(page), 'Someone’s on third. Move them up too.');
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
// Under it, quieter, the half is over and who's up, each on a line of its own.
assert.equal(await page.textContent('.ticker .then'), 'Three outs. Bottom of the 1st: Comets batting.');
const lines = await page.evaluate(() => [...document.querySelectorAll('.ticker .said > *')].map(x => Math.round(10 * x.getBoundingClientRect().height / parseFloat(getComputedStyle(x).lineHeight)) / 10));
assert.deepEqual(lines, [1, 1], 'one whole line each');
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
// When the at-bat began: its first pitch, on the clock.
assert.match(await page.textContent('.sheet h2 small'), /^Top of the 1st, \d{1,2}:\d\d [ap]m$/);
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
assert.equal(await page.locator('.ticker .then').count(), 0, 'the line under the play is for the end of a half-inning');
assert.match(await page.textContent('.bug'), /Comets\s*1/i);
await tap('[data-v=box]');
assert.match(await page.textContent('.pane[data-p=box]'), /Moreno/);
assert.match(await page.textContent('.pane[data-p=box]'), /Home runs: Kowalski/);
// The clock: the first pitch started it, every play since has its time, and the box score says when it began.
const clock = await page.evaluate(async () => { const g = (await import('./js/store.js')).store.all()[0]; return { start: g.start, tz: g.tz, first: g.ev[0].at, timed: g.ev.every(e => Number.isFinite(e.at)) }; });
assert.ok(Math.abs(clock.start - Date.now()) < 15 * 60e3 && clock.first === 0 && clock.timed, JSON.stringify(clock));
assert.equal(clock.tz, await page.evaluate(() => -new Date().getTimezoneOffset()));
assert.match(await page.textContent('.pane[data-p=box] .clock'), /^First pitch \d{1,2}:\d\d [ap]m$/, 'no time of the game while it goes on');
// Moreno's line: one batter, a home run (an earned run), on one pitch, a strike (P-S 1-1).
assert.deepEqual(await page.$$eval('.pane[data-p=box] tr', trs => trs.filter(tr => /Moreno/.test(tr.querySelector('th')?.textContent)).map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent).join(' '))), ['0 1 1 1 0 0 1 1 1-1']);
await tap('[data-v=plays]');
assert.match(await page.textContent('.plays'), /Kowalski pinch-hits for Batter 1/);
await fitsPhone('the plays');

step('ending the game early, and keeping going');
await tap('[data-v=live]');
await tap('[data-a=menu]');
await tap('[data-y=end]');
await tap('[data-end=rule]');
assert.match(await page.textContent('.final h2'), /Comets win, 1–0 \(run rule\)/);
// Over: the box score has the time of the game.
await tap('[data-v=box]');
assert.match(await page.textContent('.pane[data-p=box] .clock'), /^First pitch \d{1,2}:\d\d [ap]m · Time 0:\d\d$/);
await tap('[data-v=live]');
await tap('[data-a=on]');
assert.equal(await page.locator('.final').count(), 0);

step('it’s all still there after a reload');
const state = () => page.evaluate(() => [document.querySelector('.bug').textContent, document.querySelector('.ticker p').textContent, document.querySelector('.bar .title').textContent].join('|'));
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
assert.ok(link.startsWith('https://backwards-k.junkdrawer.works/#s=c'), link.slice(0, 60));
const friend = await browser.newContext({ viewport: { width: 390, height: 844 } });
const fp = await friend.newPage();
fp.on('pageerror', e => problems.push('friend: ' + e.message));
await fp.goto(base + link.slice(link.indexOf('#')));
await fp.waitForSelector('[data-a=keep]');
assert.match(await fp.textContent('.bar .title'), /Foxes\s*0\s*–\s*1\s*Comets/);
// Sent mid-game, so it says the link is the game as it stood then.
assert.equal(await fp.textContent('.shared-bar p'), 'The scorecard as it stood in the bottom of the 1st. The link doesn’t update: ask for a new one to see the rest. Tap any box to see what happened.');
await fp.click('[data-a=keep]');
await fp.waitForSelector('.live .field');
await fp.goto(base);
assert.equal(await fp.locator('.gi').count(), 1);
// The same link again: there's nothing new in it.
await fp.goto(base + link.slice(link.indexOf('#')));
await fp.click('[data-a=keep]');
await fp.waitForSelector('.live .field');
assert.equal(await fp.textContent('#toast'), 'You already have this game.');
// A finished game's link says nothing about waiting for more.
const final = await fp.evaluate(async () => {
  const { linkFor } = await import('./js/share.js'), { sampleGame } = await import('./js/sample.js');
  const l = await linkFor(sampleGame(7));
  return l.slice(l.indexOf('#'));
});
await fp.goto(base + final);
await fp.waitForSelector('.shared-bar');
assert.equal(await fp.textContent('.shared-bar p'), 'A scorecard someone shared with you. Tap any box to see what happened.');
// A link from before links had a checksum (z: the game compressed, and nothing else) still opens.
const old = await fp.evaluate(async () => {
  const { sampleGame } = await import('./js/sample.js'), g = sampleGame(3);
  const z = new Uint8Array(await new Response(new Blob([JSON.stringify(g)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  return '#s=z' + btoa(String.fromCharCode(...z)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
});
await fp.goto('about:blank');
await fp.goto(base + old);
await fp.waitForSelector('.shared-bar');
assert.match(await fp.textContent('.bar .title'), /Foxes/);
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
// A save is written just after the screen is drawn: wait for that, then read what's stored.
const written = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
const stored = async (p, id) => { await written(p); return p.evaluate(id => JSON.parse(localStorage.getItem('backwards-k.v1')).games[id], id); };
// An event without the time it was scored (at), to compare with one written out here.
const untimed = ({ at, ...e }) => e;
const plays = async (p, id) => (await stored(p, id)).ev.map(e => e.t + (e.r || '')).join(' ');
const shown = p => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(''));
const tickerOf = p => p.textContent('.ticker p');

step('saving the sample twice keeps one copy, and the second Save says so');
{
  const p = await phone();
  for (let i = 0; i < 2; i++) {
    await p.goto(base + '#/sample');
    await p.click('[data-a=keep]');
    await p.waitForSelector('.live .field');
  }
  assert.equal(await seen(p), 'You already have the sample in your games.');
  await written(p);
  const ids = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('backwards-k.v1')).games));
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^gsample7-/);
  assert.equal(await p.evaluate(() => location.hash), '#/g/' + ids[0]);
  await p.goto(base);
  assert.equal(await p.locator('.gi').count(), 1);
  await p.context().close();
}

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

step('Lineup and pitcher, folded away: one line, with the app’s own chevron');
{
  const p = await phone();
  await p.goto(base + '#/new');
  const sum = await p.$eval('[data-side="0"] summary', el => ({ text: el.textContent, marker: getComputedStyle(el).listStyleType, lines: Math.round(el.querySelector('small').getBoundingClientRect().height / parseFloat(getComputedStyle(el.querySelector('small')).lineHeight)), turn: getComputedStyle(el, '::before').transform }));
  assert.deepEqual({ text: sum.text, marker: sum.marker, lines: sum.lines }, { text: 'Lineup and pitcher optional', marker: 'none', lines: 1 });
  await p.click('[data-side="0"] summary');
  await p.waitForTimeout(250);
  assert.notEqual(await p.$eval('[data-side="0"] summary', el => getComputedStyle(el, '::before').transform), sum.turn, 'the chevron turns when it opens');
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

step('a new game from the keyboard: Next after the visitors, Go after the home team');
{
  const p = await phone();
  await p.goto(base + '#/new');
  assert.deepEqual(await p.$$eval('[data-name]', l => l.map(i => i.enterKeyHint)), ['next', 'go']);
  await p.fill('[data-side="0"] [data-name]', 'Tigers');
  await p.press('[data-side="0"] [data-name]', 'Enter');
  assert.equal(await p.evaluate(() => document.activeElement.closest('[data-side]').dataset.side), '1', 'Enter goes on to the home team');
  await p.keyboard.type('Sharks');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.live .field');
  assert.match(await p.evaluate(() => location.hash), /^#\/g\//);
  assert.match(await p.textContent('.bar .title'), /Tigers\s*0\s*–\s*0\s*Sharks/);
  await p.context().close();
}

step('names are typed as they are: no autocorrect or spell check on a name, a team or a place');
{
  const p = await phone();
  // Every one of these fields on screen (or in the sheet), and each one's autocorrect, spell check and capitals.
  const fields = sel => p.$$eval(sel, l => l.map(i => `${i.spellcheck}/${i.getAttribute('autocorrect')}/${i.getAttribute('autocapitalize')}`));
  const plain = async (what, sel, caps = 'words') => {
    const got = await fields(sel);
    assert.ok(got.length, `${what}: there are some`);
    assert.deepEqual([...new Set(got)], [`false/off/${caps}`], what);
  };
  await p.goto(base + '#/new');
  await plain('new game', '[data-name], .lineup-edit [data-f=name], [data-pf=name], [name=place]');
  await p.click('[data-side="0"] [data-paste]');
  await plain('a pasted lineup', '.sheet textarea', null);
  await p.click('.sheet [data-close]');
  await p.fill('[data-side="0"] [data-name]', 'Owls');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  await p.click('[data-a=batter]');
  await plain('the batter', '.sheet [data-f=name]');
  await p.click('.sheet [data-close]');
  await p.click('[data-a=pitcher]');
  await plain('the pitcher', '.sheet [data-f=name]');
  await p.click('.sheet [data-close]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  await plain('Lineups', '.sheet [data-f=name], .sheet [data-team]');
  await p.click('.sheet [data-close]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=settings]');
  await plain('Game settings', '.sheet [data-t], .sheet [data-g=place]');
  await p.context().close();
}

step('a game nobody has started is listed as who’s playing whom, waiting');
{
  const p = await phone();
  await startGame(p, 'Owls');
  await p.goto(base);
  await p.waitForSelector('.gi');
  const read = () => p.$eval('.gi', a => ({ teams: a.querySelector('.gi-teams').textContent.replace(/\s+/g, ' ').trim(), st: a.querySelector('.gi-st').textContent, red: a.classList.contains('live') }));
  assert.deepEqual(await read(), { teams: 'Owls at Home', st: 'Not started', red: false });
  await p.click('.gi');
  await p.click('[data-p=b]');
  await p.goto(base);
  await p.waitForSelector('.gi');
  assert.deepEqual(await read(), { teams: 'Owls 0 Home 0', st: 'Top 1st', red: true });
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

step('league rules: the Minors end a half at five runs, and the next new game starts with them; Custom changes as it’s typed');
{
  const p = await phone();
  await p.goto(base + '#/new');
  assert.equal(await p.getAttribute('[data-rules=none]', 'aria-pressed'), 'true', 'none on a new device');
  await p.click('[data-inn="6"]');
  await p.click('[data-rules=minors]');
  assert.match(await p.textContent('.rules-words'), /^A half-inning ends at 5 runs, except in the last inning/);
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  const id = await p.evaluate(() => location.hash.slice(4));
  for (let i = 0; i < 4; i++) await p.click('[data-r=HR]');
  for (let i = 0; i < 3; i++) await p.click('[data-r=BB]');
  await p.click('[data-r="2B"]');
  await p.click('.sheet [data-x=save]');
  assert.match(await p.textContent('.ticker p'), /crosses the plate too, but the 5-run limit was reached, so the run doesn’t count\. Batter 7 to third\. That’s 5 runs: the half-inning is over\.$/);
  assert.equal(await p.textContent('.ticker .then'), 'Bottom of the 1st: Home batting.', 'not three outs');
  assert.match(await p.textContent('.bar .title'), /5\s*–\s*0.*Bottom 1st/s);
  // Game settings: the Minors are picked, and Custom's numbers change the game as they're typed.
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=settings]');
  assert.equal(await p.getAttribute('.sheet [data-rules=minors]', 'aria-pressed'), 'true');
  await p.click('.sheet [data-rules=custom]');
  await p.fill('.sheet [data-rk=runs]', '7');
  assert.match(await p.textContent('.sheet .rules-words'), /^A half-inning ends at 7 runs/);
  await p.keyboard.press('Escape');
  assert.deepEqual((await stored(p, id)).rules, { set: 'custom', runs: 7, last: false, all: false, mercy: [[4, 10]] });
  assert.match(await p.textContent('.bar .title'), /6\s*–\s*0.*Top 1st/s, 'six runs count now, one short of seven, and the half goes on');
  await p.goto(base + '#/new');
  assert.equal(await p.getAttribute('[data-rules=custom]', 'aria-pressed'), 'true', 'the next game starts with them');
  assert.equal(await p.inputValue('[data-rk=runs]'), '7');
  await p.context().close();
}

step('Game settings won’t take league rules that would change plays already scored, and says why');
{
  const p = await phone();
  await p.goto(base + '#/new');
  await p.click('[data-inn="6"]');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  const id = await p.evaluate(() => location.hash.slice(4));
  for (let i = 0; i < 6; i++) await p.click('[data-r=HR]');
  for (let i = 0; i < 3; i++) await p.click('[data-r=K]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=settings]');
  // The Minors would have ended the top of the 1st at five, and put the three strikeouts on the home team.
  await p.click('.sheet [data-rules=minors]');
  assert.equal(await p.getAttribute('.sheet [data-rules=none]', 'aria-pressed'), 'true');
  assert.match(await p.textContent('.sheet .rules-words'), /^Not in this game: those rules would change plays already scored\./);
  assert.equal((await stored(p, id)).rules, null);
  // Custom starts without its 5-run limit, and a limit of 6 isn't taken either; 7 is.
  await p.click('.sheet [data-rules=custom]');
  assert.equal(await p.inputValue('.sheet [data-rk=runs]'), '');
  assert.match(await p.textContent('.sheet .rules-words'), /^Custom starts with no run limit here: a limit of 5 would change plays already scored\.$/);
  await p.fill('.sheet [data-rk=runs]', '6');
  assert.match(await p.textContent('.sheet .rules-words'), /^Not in this game/);
  assert.equal((await stored(p, id)).rules.runs, 0);
  await p.fill('.sheet [data-rk=runs]', '7');
  assert.match(await p.textContent('.sheet .rules-words'), /^A half-inning ends at 7 runs/);
  assert.equal((await stored(p, id)).rules.runs, 7);
  await p.keyboard.press('Escape');
  assert.match(await p.textContent('.bar .title'), /6\s*–\s*0.*Bottom 1st/s, 'the game as it was scored');
  await p.context().close();
}

step('extra innings that start with a runner on second: he is on the field, on the card and in the plays');
{
  const p = await phone();
  await p.goto(base + '#/new');
  await p.click('[data-inn="3"]');
  await p.check('input[name=tie]');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  for (let i = 0; i < 18; i++) await p.click('[data-r=K]');
  assert.match(await p.textContent('.bar .title small'), /^Top 4th/);
  assert.equal(await p.textContent('.live [data-runner="2"]'), 'Batter 9');
  assert.equal(await p.textContent('.live .batter span'), 'Batter 1');
  assert.equal(await p.textContent('.ticker .then'), 'Three outs. Top of the 4th: Visitors batting, Batter 9 on second.');
  assert.match(await p.textContent('.recent'), /AR\s*Extra innings: Batter 9 starts on second\./);
  await p.click('[data-v=card]');
  await p.click('.card td.cur [data-cell]');
  assert.match(await p.textContent('.sheet .cell-big'), /AR On second to start the inning\s*Batter 9 starts the 4th on second\./);
  assert.match(await p.textContent('.sheet'), /his run is unearned/);
  await p.keyboard.press('Escape');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=settings]');
  assert.equal(await p.$eval('.sheet [data-g=tie]', s => s.selectedOptions[0].textContent), 'From the 4th (extra innings)');
  // Taken off: the 4th starts as usual.
  await p.selectOption('.sheet [data-g=tie]', '0');
  await p.keyboard.press('Escape');
  await p.click('[data-v=live]');
  assert.equal(await p.locator('.live [data-runner]').count(), 0);
  await p.goto(base + '#/new');
  assert.equal(await p.isChecked('input[name=tie]'), false, 'the next game starts as the last one was left');
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

step('adding a batter from Lineups: the new spot’s name gets the keyboard, in sight, and the list stays put');
{
  const p = await phone();
  await startGame(p);
  for (let i = 0; i < 3; i++) { await p.click('[data-a=batter]'); await p.click('.sheet [data-y=add]'); }
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  await p.click('.sheet .row [data-y=add]');
  const got = await p.evaluate(() => ({ slot: document.activeElement.dataset.slot, f: document.activeElement.dataset.f, top: document.querySelector('.sheet-body').scrollTop }));
  assert.deepEqual({ slot: got.slot, f: got.f }, { slot: '12', f: 'name' }, 'the 13th batter’s name has the keyboard');
  assert.ok(got.top > 0, 'and the list didn’t jump back to the top');
  const li = await box(p, '.sheet [data-slot="12"][data-f=name]'), last = await box(p, '.sheet-body > .row:last-child');
  assert.ok(inside(li, await box(p, '#sheet')) && li.bottom <= last.top + 0.5, `the new name is in sight (${li.top}-${li.bottom}, the buttons from ${last.top})`);
  await p.keyboard.type('Nevaeh');
  // A substitution from Lineups comes back to the list where it was.
  const before = await p.evaluate(() => document.querySelector('.sheet-body').scrollTop);
  await p.click('.sheet [data-sub="11"]');
  await p.fill('.sheet [data-f=name]', 'Jaxon');
  await p.click('.sheet [data-x=go]');
  await p.waitForSelector('.sheet [data-ls]');
  assert.equal(await p.evaluate(() => document.querySelector('.sheet-body').scrollTop), before, 'back from the substitution, scrolled where it was');
  assert.equal(await p.inputValue('.sheet [data-slot="12"][data-f=name]'), 'Nevaeh');
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
  assert.match(await p.textContent('.card tbody tr:first-child .names'), /^Morris #21PR 1st Diazback 1st Morris #21$/);
  await p.context().close();
}

step('a substitute from Lineups for the runner on second runs for him there, and scores');
{
  const p = await phone();
  await startGame(p);
  await p.click('[data-r="2B"]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  await p.click('.sheet [data-sub="0"]');
  assert.match(await p.textContent('.sheet h2'), /^Pinch runner for Batter 1/);
  assert.equal(await p.getAttribute('.sheet [data-ty=pr]', 'aria-pressed'), 'true');
  assert.equal(await p.textContent('.sheet .hint'), 'They run for Batter 1 on second, and take that spot in the batting order from now on.');
  await p.fill('.sheet [data-f=name]', 'Speedy');
  await p.click('[data-x=go]');
  await p.keyboard.press('Escape');
  assert.equal(await bases(p), '2:Speedy');
  await p.click('[data-r="1B"]');
  await p.click('.mv[data-from="2"] [data-to="4"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await p.textContent('.ticker p'), 'Batter 2 singles. Speedy scores. Owls take the lead, 1–0.');
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
  // Bringing back an earlier pitcher: how much each has thrown, and a way out.
  await p.click('.sheet [data-y=back]');
  assert.equal(await p.textContent('.sheet [data-j="0"] span'), '2 pitches so far');
  await p.click('.sheet [data-close]');
  assert.equal(await p.evaluate(() => document.getElementById('sheet').open), false, 'Cancel closes it');
  // Without pitches counted, a pitch count would be one a batter: the outs and batters instead.
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=settings]');
  await p.click('.sheet [data-g=pitches]');
  await p.keyboard.press('Escape');
  await p.click('[data-a=pitcher]');
  await p.click('.sheet [data-y=back]');
  assert.equal(await p.textContent('.sheet [data-j="0"] span'), '1 out, 1 batter faced');
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
  assert.match(await p.textContent('.ticker p'), /Batter 1 and Batter 2 score\./);

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

step('names typed in the batter, pitcher and lineup sheets after storage was read again (another tab saved) are kept');
{
  const p = await phone(), id = await startGame(p);
  const again = () => p.evaluate(async () => (await import('./js/store.js')).store.reload());
  const type = async (sel, text) => { await again(); await p.fill(sel, text); };
  await p.click('[data-a=batter]');
  await type('.sheet [data-f=name]', 'Ruiz');
  await p.click('.sheet [data-close]');
  await p.click('[data-a=pitcher]');
  await type('.sheet [data-f=name]', 'Halvorsen');
  await p.click('.sheet [data-close]');
  await p.click('[data-a=menu]');
  await p.click('[data-y=lineup]');
  await type('.sheet [data-slot="2"][data-f=name]', 'Okafor');
  await type('.sheet [data-pi="0"][data-f=num]', '21');
  await type('.sheet [data-team]', 'Night Owls');
  await p.click('.sheet [data-close]');
  await p.waitForTimeout(600); // names are saved after a pause in the typing
  const g = await stored(p, id);
  assert.deepEqual([g.teams[0].lineup[0][0].name, g.teams[1].pitchers[0].name, g.teams[0].lineup[2][0].name, g.teams[0].pitchers[0].num, g.teams[0].name],
    ['Ruiz', 'Halvorsen', 'Okafor', '21', 'Night Owls']);
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
  // The runners sheet says the run ends it, rather than counting runs that won't score.
  assert.equal(await p.textContent('.sheet .tally'), 'The winning run scores, and that’s the game.');
  await p.click('.sheet [data-x=save]');
  assert.match(await p.textContent('.final h2'), /Home win, 1–0/);
  assert.deepEqual(await p.$$eval('.bug .bt', b => b.map(x => x.className)), ['bt', 'bt won'], 'the winner is lit on the board');
  assert.equal(await p.textContent('.bug .inn'), 'Final');
  assert.equal(await p.locator('.live [data-runner]').count(), 0);
  assert.equal(await p.textContent('.live .runner'), 'Left on third: Batter 8');
  await p.context().close();
}

step('a double that wins it with the bases loaded is a single on the card, and its box can’t be switched to a walk');
{
  const p = await phone();
  await startGame(p);
  await p.click('[data-a=menu]');
  await p.click('[data-y=settings]');
  await p.selectOption('.sheet [data-g=innings]', '3');
  await p.click('.sheet [data-close]');
  for (let i = 0; i < 15; i++) await p.click('[data-r=K]');
  for (let i = 0; i < 3; i++) await p.click('[data-r=BB]');
  await p.click('[data-r="2B"]');
  assert.equal(await p.textContent('.sheet .tally'), 'The winning run scores, and that’s the game. It went for a double, but counts as a single: the winning run needed only one base.');
  await p.click('.sheet [data-x=save]');
  assert.match(await p.textContent('.final h2'), /Home win, 1–0/);
  assert.equal(await p.textContent('.ticker p'), 'Batter 1 singles. Batter 7 scores the winning run. Batter 8 to third. Batter 9 to second. It went for a double, but counts as a single: the winning run needed only one base.');
  await p.click('[data-v=card]');
  await p.click('[data-cs="1"]');
  await p.click('[data-cell="18"]');
  assert.match(await p.textContent('.sheet .cell-big'), /1B Single/);
  assert.equal(await p.locator('.sheet [data-sw]').count(), 0);
  assert.match(await p.textContent('.sheet'), /This one can’t be changed here/);
  // A league that plays the inning out: Keep playing, and the double is a double again, with both its runs.
  await p.click('.sheet [data-close]');
  await p.click('[data-v=live]');
  await p.click('[data-a=on]');
  assert.match(await p.textContent('.bar .title'), /0\s*–\s*2/);
  assert.match(await p.textContent('.recent'), /Batter 1 doubles\. Batter 7 and Batter 8 score\. Batter 9 to third\./);
  await p.context().close();
}

step('a delay: the game waits as it was, the screen can sleep, and Resume picks it up');
{
  // A stand-in for the screen's wake lock, to see when the app holds it.
  const p = await phone(() => {
    window.held = 0;
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.held++; const l = new EventTarget(); l.release = async () => { window.held--; l.dispatchEvent(new Event('release')); }; return l; } } });
  });
  const id = await startGame(p);
  await p.click('[data-r="1B"]');
  await p.click('[data-p=b]');
  assert.equal(await p.evaluate(() => window.held), 1, 'the screen stays on while scoring');
  await p.click('[data-a=more]');
  await p.click('.sheet [data-y=end]');
  assert.deepEqual(await p.$$eval('.sheet [data-end]', b => b.map(x => x.querySelector('b').textContent)), ['Stop for a delay', 'Game over: run rule', 'Game over: time limit', 'Called: rain or darkness']);
  await p.click('[data-end=delay]');
  assert.match(await p.textContent('.bar .title small'), /^Delayed, top 1st/);
  assert.match(await p.textContent('.final.delayed'), /Delayed\s+Play stopped in the top of the 1st/);
  assert.equal(await p.locator('.live [data-p], .live [data-r], .live [data-runner]').count(), 0, 'nothing to tap for a play');
  assert.equal(await p.textContent('.live .runner'), 'On first: Batter 1');
  assert.equal(await p.evaluate(() => window.held), 0, 'the screen can sleep');
  assert.match(await p.title(), /Delayed, top 1st/);
  // A new pitcher can come in meanwhile, and the home screen says it's delayed.
  await p.click('[data-a=pitcher]');
  await p.click('.sheet [data-y=new]');
  await p.click('.sheet [data-x=go]');
  assert.ok(await p.locator('.final.delayed').count());
  await p.click('.bar .back');
  assert.match(await p.textContent('.back-to'), /Delayed · Batter 2 up/);
  assert.match(await p.textContent('.game-list'), /Delayed, top 1st/i);
  await p.click('.back-to .btn');
  await p.waitForSelector('.final.delayed');
  assert.equal(await p.evaluate(() => window.held), 0, 'opened again during the delay, the screen can still sleep');
  await p.click('.final.delayed [data-a=on]');
  assert.equal(await p.locator('.final').count(), 0);
  assert.equal(await p.textContent('.ticker p'), 'Play resumes.');
  assert.match(await p.textContent('.bar .title small'), /^Top 1st/);
  assert.equal(await p.locator('.live [data-runner="1"]').count(), 1);
  assert.equal(await p.evaluate(() => window.held), 1);
  assert.deepEqual((await stored(p, id)).ev.map(e => e.t).slice(-4), ['p', 'delay', 'pch', 'on']);
  // Called before it's official: ahead, not a win; and after the run rule, Final with the reason.
  await p.click('[data-r=HR]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=end]');
  await p.click('[data-end=called]');
  assert.equal(await p.textContent('.final h2'), 'Owls ahead, 2–0');
  assert.match(await p.textContent('.final p'), /^The game was called before it was official: that takes 5 innings, or 4½ with the home team ahead\./);
  assert.match(await p.textContent('.bar .title small'), /^Called/);
  assert.deepEqual(await p.$$eval('.bug .bt', b => b.map(x => x.className)), ['bt', 'bt'], 'nobody is lit as the winner');
  await p.click('[data-a=on]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=end]');
  await p.click('[data-end=time]');
  assert.equal(await p.textContent('.final h2'), 'Owls win, 2–0 (time limit)');
  assert.match(await p.textContent('.bar .title small'), /^Final/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the final, with its reason, scrolls sideways');
  await p.context().close();
}

step('Game settings won’t make the inning being played the last when the home team already led after the top of it');
{
  const p = await phone();
  await startGame(p);
  for (let i = 0; i < 3; i++) await p.click('[data-r=K]');
  await p.click('[data-r=HR]');
  for (let i = 0; i < 12; i++) await p.click('[data-r=K]');
  assert.match(await p.textContent('.bar .title'), /Bottom 3rd/);
  const innings = async () => { await p.click('[data-a=menu]'); await p.click('[data-y=settings]'); const r = await p.$$eval('.sheet [data-g=innings] option', o => o.filter(x => x.disabled).map(x => x.textContent).join()); const note = await p.textContent('.sheet [data-g=innings] + small'); return [r, note]; };
  assert.deepEqual(await innings(), ['3', 'The home team was already ahead after the top of the 3rd: use End the game here.']);
  await p.keyboard.press('Escape');
  // In the top of the 4th it can be the last: the game ends when the half does.
  for (let i = 0; i < 3; i++) await p.click('[data-r=K]');
  assert.deepEqual(await innings(), ['3', 'Already in the 4th, so it can’t be shorter than that.']);
  await p.selectOption('.sheet [data-g=innings]', '4');
  await p.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await p.click('[data-r=K]');
  assert.match(await p.textContent('.final h2'), /Home win, 1–0/);
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
  await written(p);
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
  await written(p);
  assert.equal(await p.locator('.trouble').isVisible(), false);
  await p.context().close();
}

step('out of room, storage read again (another tab saved, or Google Drive) leaves the plays here, and says nothing was deleted');
{
  const p = await phone(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'backwards-k.v1' && sessionStorage.getItem('full')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  });
  const again = () => p.evaluate(async () => (await import('./js/store.js')).store.reload());
  const id = await startGame(p);
  await p.evaluate(() => sessionStorage.setItem('full', '1'));
  for (const k of ['b', 'b', 's']) await p.click(`[data-p=${k}]`);
  await again();
  assert.equal(await tickerOf(p), 'Swinging strike (2-1)');
  assert.equal(await p.evaluate(async id => (await import('./js/store.js')).store.get(id).ev.length, id), 3);
  await p.click('[data-p=b]');
  assert.equal(await tickerOf(p), 'Ball (3-1)');
  // A game started while out of room was never stored at all: it isn't "deleted on another device".
  const other = await startGame(p, 'Larks');
  assert.notEqual(other, id);
  await again();
  await p.waitForTimeout(200);
  assert.equal(await shown(p), '');
  await p.click('[data-p=b]');
  assert.equal(await tickerOf(p), 'Ball (1-0)');
  await p.context().close();
}

step('a tap is stored just after the screen is drawn, and the page going away stores whatever is waiting');
{
  const p = await phone(), id = await startGame(p);
  const now = () => p.evaluate(id => JSON.parse(localStorage.getItem('backwards-k.v1')).games[id], id);
  // In the same moment as the tap, nothing is written yet; once the screen has been drawn, it is.
  const before = await p.evaluate(id => { document.querySelector('.live [data-p=b]').click(); return JSON.parse(localStorage.getItem('backwards-k.v1')).games[id].ev.length; }, id);
  assert.equal(before, 0);
  assert.equal((await stored(p, id)).ev.length, 1);
  // A tap, and a name typed, with the page going away straight after: both are written as it goes.
  await p.click('[data-a=batter]');
  await p.fill('.sheet [data-f=name]', 'Ruiz');
  await p.click('.sheet [data-close]');
  await p.evaluate(() => { document.querySelector('.live [data-p=b]').click(); window.dispatchEvent(new PageTransitionEvent('pagehide')); });
  const g = await now();
  assert.deepEqual([g.ev.length, g.teams[0].lineup[0][0].name], [2, 'Ruiz']);
  await p.context().close();
}

step('games stored but unreadable (damaged) are put aside, not written over by the next save');
{
  const p = await phone(() => { if (!sessionStorage.getItem('damaged')) { localStorage.setItem('backwards-k.v1', '{"app":"backwards-k","v":1,"games":{"gx'); sessionStorage.setItem('damaged', '1'); } });
  // Opened, and opened again, before anything is saved: put aside once, not once each time.
  for (let i = 0; i < 3; i++) { await p.goto(base); await p.waitForSelector('.home'); await p.reload(); }
  const id = await startGame(p);
  await written(p);
  assert.equal(await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('backwards-k.v1.unreadable-')).length), 1, 'one copy put aside');
  const all = await p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('backwards-k.v1')).map(k => [k.replace(/-\d+$/, '-'), localStorage.getItem(k)])));
  assert.deepEqual(Object.keys(all).sort(), ['backwards-k.v1', 'backwards-k.v1.unreadable-']);
  assert.equal(all['backwards-k.v1.unreadable-'], '{"app":"backwards-k","v":1,"games":{"gx');
  assert.deepEqual(Object.keys(JSON.parse(all['backwards-k.v1']).games), [id]);
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

step('with many games, the home lists the 20 changed last, and Show all lists the rest');
{
  const games = Array.from({ length: 25 }, (_, i) => ({ ...sampleGame(1 + (i % 5)), id: 'gmany' + String(i).padStart(2, '0'), updated: 1000 + i }));
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await c.addInitScript(doc => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('backwards-k.v1', doc); sessionStorage.setItem('seeded', '1'); } },
    JSON.stringify({ app: 'backwards-k', v: 1, games: Object.fromEntries(games.map(g => [g.id, g])), gone: {} }));
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  await p.goto(base);
  await p.waitForSelector('.gi');
  const ids = () => p.$$eval('.gi', l => l.map(a => a.getAttribute('href').slice(4)));
  assert.deepEqual(await ids(), games.slice(5).reverse().map(g => g.id), 'the latest 20, latest first');
  assert.equal(await p.textContent('[data-a=all]'), 'Show all 25 games');
  await p.click('[data-a=all]');
  assert.deepEqual(await ids(), games.slice().reverse().map(g => g.id));
  assert.equal(await p.evaluate(() => document.activeElement.getAttribute('href')), '#/g/gmany04', 'the keyboard on the first one that was out of sight');
  assert.equal(await p.locator('[data-a=all]').count(), 0);
  await c.close();
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

step('a backup file saved on one device brings every game, as it was, to another');
{
  const a = sampleGame(3), b = sampleUntil(7, S => S.inn === 7);
  a.id = 'gbackupa'; b.id = 'gbackupb'; b.teams[0].name = 'Owls';
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  await c.addInitScript(doc => { if (!localStorage.getItem('backwards-k.v1')) localStorage.setItem('backwards-k.v1', doc); }, JSON.stringify({ app: 'backwards-k', v: 1, games: { [a.id]: a, [b.id]: b }, gone: {} }));
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  await p.goto(base);
  const [file] = await Promise.all([p.waitForEvent('download'), p.click('[data-a=export]')]);
  assert.match(file.suggestedFilename(), /^backwards-k-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = await readFile(await file.path());
  await c.close();
  // A phone with nothing on it opens the file.
  const q = await phone();
  await q.goto(base);
  const [chooser] = await Promise.all([q.waitForEvent('filechooser'), q.click('[data-a=import]')]);
  await chooser.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await q.waitForFunction(() => document.getElementById('toast').textContent);
  assert.equal(await shown(q), '2 games added.');
  const sorted = v => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v);
  const there = await q.evaluate(() => JSON.parse(localStorage.getItem('backwards-k.v1')).games);
  for (const g of [a, b]) assert.equal(JSON.stringify(sorted(there[g.id])), JSON.stringify(sorted(g)), `${g.id} comes back the same`);
  assert.equal(await q.locator('.gi').count(), 2);
  await q.goto(base + '#/g/' + b.id);
  await q.waitForSelector('.live .field');
  const S = replay(b);
  assert.match(await q.textContent('.bar .title'), new RegExp(`Owls\\s*${S.R[0]}\\s*–\\s*${S.R[1]}\\s*Comets`));
  // The same file again has nothing new.
  await q.goto(base);
  const [again] = await Promise.all([q.waitForEvent('filechooser'), q.click('[data-a=import]')]);
  await again.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await q.waitForFunction(() => /Nothing new/.test(document.getElementById('toast').textContent));
  await q.context().close();
}

step('a link that didn’t come through whole says so, and the games are there');
{
  const p = await phone();
  const hash = link.slice(link.indexOf('#'));
  const j = s => '#s=j' + Buffer.from(s).toString('base64url');
  // Cut short (a text that hit its limit), a letter changed in the middle, nothing after #s=, an unknown kind, plain
  // JSON that isn't a game, and a game whose teams aren't there.
  for (const h of [hash.slice(0, Math.floor(hash.length / 2)), hash.slice(0, 60) + (hash[60] === 'A' ? 'B' : 'A') + hash.slice(61), '#s=', '#s=x123', j('{"hello":"world"}'), j('{"teams":7,"ev":[]}')]) {
    await p.goto('about:blank');
    await p.goto(base + h);
    await p.waitForFunction(() => document.getElementById('toast').textContent);
    assert.equal(await shown(p), 'That link didn’t come through whole. Ask for it again.', h.slice(0, 40));
    assert.equal(await p.evaluate(() => location.hash), '#/');
    assert.match(await p.textContent('.hero h1'), /Keep score/);
  }
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
async function playing(g, viewport = { width: 390, height: 844 }, ready = '.live .field') {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await c.addInitScript(doc => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('backwards-k.v1', doc); sessionStorage.setItem('seeded', '1'); }
  }, JSON.stringify({ app: 'backwards-k', v: 1, games: { [g.id]: g }, gone: {} }));
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await p.goto(base + '#/g/' + g.id);
  await p.waitForSelector(ready);
  await p.evaluate(() => document.fonts.ready);
  return p;
}

step('a pitch limit: the pitcher’s button turns amber five before it and red at it, and the rest he needs is on his sheet and in the box score');
{
  const g = sampleUntil(7, S => S.inn === 5 && S.half === 1 && S.pitching[0][0]?.np >= 78 && !S.seq);
  g.id = 'gsample7limit';
  g.limit = { by: 'll', age: '11-12', max: 85 };
  const p = await playing(g);
  const chip = () => p.evaluate(() => { const b = document.querySelector('.live .pitcher'); return [b.className, b.querySelector('b').textContent, b.querySelector('small').textContent]; });
  assert.deepEqual(await chip(), ['pitcher', '78', 'pitches']);
  await p.click('[data-p=f]');
  await p.click('[data-p=f]');
  assert.deepEqual(await chip(), ['pitcher near', '80', 'of 85']);
  for (let i = 0; i < 5; i++) await p.click('[data-p=f]');
  assert.deepEqual(await chip(), ['pitcher finish', '85', 'finish this batter']);
  assert.match(await p.getAttribute('.live .pitcher', 'aria-label'), /85 pitches, at the limit of 85: finish this batter\./);
  await p.click('[data-r=BB]');
  assert.deepEqual(await chip(), ['pitcher over', '86', 'limit reached']);
  assert.ok(await p.evaluate(() => { const b = document.querySelector('.live .pitcher').getBoundingClientRect(), f = document.querySelector('.live .field').getBoundingClientRect(); return b.left >= f.left && b.right <= f.right; }), 'the red button stays on the field');
  await p.click('[data-a=pitcher]');
  assert.match(await p.textContent('.sheet'), /At the limit of 85 \(Little League, 11–12\): finish the batter it was reached on, then a new pitcher\.\s*Rest after today: 4 days \(66 or more pitches\)\.\s*41 or more pitches today: can’t catch for the rest of the day\./);
  await p.keyboard.press('Escape');
  await p.click('[data-v=box]');
  assert.match(await p.textContent('.pane[data-p=box]'), /Days of rest \(Little League, 11–12\): Whitlock 4 days\.\s*Can’t catch today \(41 or more pitches\): Whitlock\./);
  // Game settings: Little League and the age are picked; a number of one's own shows no table of rest.
  await p.click('[data-v=live]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=settings]');
  assert.deepEqual(await p.$$eval('.sheet .limit-row [aria-pressed=true]', b => b.map(x => x.textContent)), ['Little League', '11–12']);
  await p.click('.sheet [data-limit=n]');
  await p.fill('.sheet [data-lk=max]', '100');
  await p.keyboard.press('Escape');
  assert.deepEqual(await chip(), ['pitcher', '86', 'pitches']);
  await p.context().close();
}

step('a tap on the line score, the box score or the plays scores nothing');
{
  const g = sampleGame(1);
  g.id = 'gsample1panes';
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const p = await playing({ ...g }, { width: w, height: h }, '.vtabs');
    for (const v of ['card', 'box', 'plays']) {
      await p.click(`[data-v=${v}]`);
      await p.click(`.pane[data-p=${v}] ${v === 'plays' ? '.plays h3' : '.line-wrap'}`);
      await p.click(`.pane[data-p=${v}]`, { position: { x: 5, y: 5 } });
    }
    assert.equal((await stored(p, g.id)).ev.length, g.ev.length, `${w}: nothing was scored`);
    assert.match(await p.title(), /· Final ·/);
    await p.context().close();
  }
}

step('only the pane on screen is drawn, and the one shown next is drawn as it’s shown');
{
  const drawn = p => p.evaluate(() => [...document.querySelectorAll('.side .pane')].map(x => `${x.dataset.p}:${x.childElementCount ? 'drawn' : 'empty'}`).join(' '));
  // A phone on the Score tab: none of them.
  const p = await playing(seventh());
  await p.click('[data-r=K]');
  assert.equal(await drawn(p), 'card:empty box:empty plays:empty');
  await p.click('[data-v=plays]');
  assert.equal(await drawn(p), 'card:empty box:empty plays:drawn');
  assert.match(await p.textContent('.pane[data-p=plays]'), /strikes out swinging/);
  await p.click('[data-v=box]');
  assert.equal(await drawn(p), 'card:empty box:drawn plays:empty');
  // Turned on its side, as wide as a tablet: the Box score is beside the buttons, so it's drawn there.
  await p.click('[data-v=live]');
  assert.equal(await drawn(p), 'card:empty box:empty plays:empty');
  await p.setViewportSize({ width: 1180, height: 820 });
  await p.waitForFunction(() => document.querySelector('.pane[data-p=box]').childElementCount);
  await p.click('[data-r=K]');
  assert.equal(await drawn(p), 'card:empty box:drawn plays:empty');
  assert.match(await p.textContent('.pane[data-p=box]'), /Velez/);
  await p.context().close();
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
  // Undo is under the field too, first, where the thumb is, and every link there is a thumb's height.
  const links = () => p.$$eval('.ticker .acts button', b => b.map(x => `${x.textContent} ${x.getBoundingClientRect().height >= 44 && x.getBoundingClientRect().width >= 44}`));
  assert.deepEqual(await links(), ['Undo true', 'Fix runners true']);
  const was = await p.textContent('.ticker p');
  await p.click('.ticker [data-a=undo]');
  assert.equal(await p.textContent('.ticker p'), `Took back: ${was}`, 'the single is taken back');
  assert.deepEqual(await links(), ['Undo true', 'Fix runners true', 'Redo true']);
  assert.equal(await ball(), at, 'after Undo, and Redo');
  await p.context().close();
}

step('a long order: the Card tab opens with the 12th batter’s box on screen, and beside the buttons the 9th’s is too');
{
  const p = await phone();
  await startGame(p);
  // A youth team that bats everyone: three more spots, and eleven up before the 12th.
  for (let i = 0; i < 3; i++) { await p.click('[data-a=batter]'); await p.click('.sheet [data-y=add]'); }
  for (const r of ['K', 'K', 'BB', 'BB', 'BB', 'BB', 'BB', 'BB', 'BB', 'BB', 'BB']) await p.click(`[data-r=${r}]`);
  assert.match(await p.textContent('.batter'), /^12/);
  await p.click('[data-v=card]');
  await p.waitForTimeout(150);
  const next = await box(p, '.pane[data-p=card] td.next'), tabs = await box(p, '.vtabs'), ih = await p.evaluate(() => innerHeight);
  assert.ok(next.bottom <= ih && next.top >= tabs.bottom, `the 12th batter’s box is at ${next.top}-${next.bottom}, under tabs ending at ${tabs.bottom}, on a screen ${ih} high`);
  assert.ok(inside(next, await box(p, '.pane[data-p=card] .card-wrap')), 'and in his inning, across');
  await p.context().close();
}
{
  // The 8th batter up: on a tablet on its side, his box is below the screen until the page moves.
  const p = await playing(sampleUntil(7, S => S.half === 0 && S.up[0] === 7 && S.b + S.s === 0), { width: 1024, height: 768 });
  const onScreen = async what => {
    await p.waitForTimeout(150);
    const next = await box(p, '.pane[data-p=card] td.next'), bar = await box(p, '.bar'), ih = await p.evaluate(() => innerHeight);
    assert.ok(next.top >= bar.bottom && next.bottom <= ih, `${what}: the box is at ${next.top}-${next.bottom}, under a bar ending at ${bar.bottom}, on a screen ${ih} high`);
  };
  await onScreen('the 8th, when the game opens');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('[data-r=BB]');
  assert.match(await p.textContent('.batter'), /^9/);
  await onScreen('the 9th, after the play that brings him up');
  assert.ok((await box(p, '[data-a=more]')).bottom <= await p.evaluate(() => innerHeight), 'and the buttons stay where they were');
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

step('long team names on a phone: one line each in the games list, with the score after, and box score headings at the left');
{
  const p = await playing(seventh(['Riverside Township Junior Varsity Comets', 'Northfield Consolidated Fighting Muskrats']), { width: 360, height: 740 });
  await p.click('[data-v=box]');
  assert.deepEqual(await p.$$eval('.pane[data-p=box] .stats thead th:first-child', l => [...new Set(l.map(th => getComputedStyle(th).textAlign))]), ['left']);
  await p.goto(base + '#/');
  await p.waitForSelector('.gi');
  const teams = await p.$$eval('.gi-teams > span', l => l.map(t => { const r = t.getBoundingClientRect(), b = t.querySelector('b').getBoundingClientRect(), gi = t.closest('.gi').getBoundingClientRect(); return { lines: Math.round(r.height / parseFloat(getComputedStyle(t).lineHeight)), score: b.right <= gi.right && b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5 }; }));
  assert.deepEqual(teams, [{ lines: 1, score: true }, { lines: 1, score: true }]);
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

  step('clearing the date in Game settings keeps the game’s date, after a reload too');
  const id = await p.evaluate(() => location.hash.slice(4));
  await p.click('[data-a=menu]');
  await p.click('[data-y=settings]');
  await p.fill('.sheet [data-g=date]', '2026-05-02');
  await p.waitForTimeout(600); // (names and dates are saved after a pause)
  assert.equal((await stored(p, id)).date, '2026-05-02');
  await p.fill('.sheet [data-g=date]', '');
  await p.keyboard.press('Tab');
  assert.equal(await p.inputValue('.sheet [data-g=date]'), '2026-05-02', 'the date comes back');
  assert.match(await p.textContent('.sheet .form'), /A game always has a date\./);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  assert.equal((await stored(p, id)).date, '2026-05-02');
  await p.reload();
  await p.waitForSelector('.live .field');
  assert.equal((await stored(p, id)).date, '2026-05-02');
  assert.match(await p.textContent('.bar .title small'), /May 2/);
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

step('scoring from a keyboard: a key for each pitch and the everyday results, and G 6 3 Enter for a 6-3');
{
  const p = await phone();
  const id = await startGame(p);
  const keys = async (...k) => { for (const x of k) await p.keyboard.press(x); };
  // A key held down (its repeats) is one ball, not a walk.
  for (let i = 0; i < 4; i++) await p.keyboard.down('b');
  await p.keyboard.up('b');
  assert.equal(await tickerOf(p), 'Ball (1-0)');
  await keys('c', 's', 'f');
  assert.equal(await tickerOf(p), 'Foul (1-2)');
  await keys('1');
  assert.equal(await tickerOf(p), 'Batter 1 singles.');
  await keys('k', 'Shift+K');
  assert.equal(await tickerOf(p), 'Batter 3 strikes out looking.');
  // With two out the batter's out is all there is: the fielders by number, then Enter.
  await keys('g');
  await p.waitForSelector('.sheet .pick');
  await keys('6', '3', 'Enter');
  assert.equal(await tickerOf(p), 'Batter 4 grounds out, short to first (6-3).');
  assert.equal(await plays(p, id), 'p p p p pa1B paK paKL paGO');
  await keys('u');
  await keys('Control+z');
  assert.equal(await plays(p, id), 'p p p p pa1B paK');
  // A fielder's number that finishes a pop out isn't a hit as well (3 is a triple on the game screen).
  await keys('k', 'p', '3');
  assert.equal(await tickerOf(p), 'Batter 4 pops out to first (P3).');
  assert.equal(await plays(p, id), 'p p p p pa1B paK paK paPU');
  // Nothing happens while a sheet is open or a name is being typed; M opens More.
  await p.click('.batter');
  await p.focus('.sheet [data-f=name]');
  await p.keyboard.type('Bk');
  await p.click('.sheet [data-close]');
  assert.equal(await p.textContent('.batter span'), 'Bk');
  await keys('m');
  assert.equal(await p.textContent('.sheet h2'), 'Something else');
  await keys('b', 'Escape');
  assert.equal(await plays(p, id), 'p p p p pa1B paK paK paPU');
  // The buttons say their keys, for a screen reader.
  assert.deepEqual(await p.$$eval('[data-p=b], [data-r=KL], [data-r=FO], .bar .undo', b => b.map(x => x.getAttribute('aria-keyshortcuts'))), ['U Control+Z Meta+Z', 'B', 'Shift+K', 'Y']);
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
  assert.equal(await p.locator('.mv[data-from="2"] [data-to][aria-pressed=true]').textContent(), '3rd', 'with one out he stops at third');
  await p.click('.sheet [data-close]');
  await p.click('[data-r=K]');
  await p.click('[data-r="1B"]');
  assert.equal(await p.locator('.mv[data-from="2"] [data-to][aria-pressed=true]').textContent(), 'Home', 'with two out he’s running');
  await p.click('.sheet [data-x=save]');
  assert.match(await p.textContent('.bug'), /Owls\s*1/i);
  assert.equal(await plays(p, id), 'pa1B paDP paK pa1B pa1B paTP paK pa2B paK pa1B');

  step('fewer taps: a home run with a runner on goes straight in, and Fix runners is there for a base he missed');
  await p.click('[data-r=HR]');
  assert.equal(await p.locator('.sheet .moves').count(), 0, 'everyone scores');
  assert.match(await p.textContent('.bug'), /Owls\s*3/i);
  await p.click('[data-a=fixlast]');
  assert.deepEqual(await p.$$eval('.sheet .mv [data-to][aria-pressed=true]', b => b.map(x => x.textContent)), ['Home', 'Home']);
  await p.click('.mv[data-from="0"] [data-to="0"]');
  await p.click('.sheet [data-x=save]');
  assert.match(await tickerOf(p), /^Batter \d hits a home run, but is called out on the bases\. Batter \d scores\.$/);
  assert.match(await p.textContent('.bug'), /Owls\s*2/i);
  await p.context().close();
}

step('the runners sheet scores what happened: a double play that got one out is a ground out');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r="1B"]');
  await p.click('[data-r=DP]');
  for (const n of [6, 4, 3]) await p.click(`.sheet [data-pos="${n}"]`);
  await p.click('.sheet [data-x=done]');
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  await p.click('.mv[data-from="1"] [data-to="2"]');
  assert.equal(await p.textContent('.sheet .tally'), '1 out');
  await p.click('.sheet [data-x=save]');
  assert.equal(await p.textContent('.ticker p'), 'Batter 2 grounds out, short to first (6-4-3). Batter 1 to second.');
  assert.equal(await p.locator('.outs .o.on').count(), 1);
  assert.equal((await stored(p, id)).ev[1].r, 'GO');

  step('a caught fly can’t leave the batter safe, and a strikeout he reached first on is a dropped third strike');
  await p.click('[data-r=FO]');
  await p.click('.sheet [data-pos="8"]');
  await p.waitForSelector('.sheet .moves');
  await p.click('.mv[data-from="0"] [data-to="1"]');
  assert.equal(await p.textContent('.sheet .tally'), 'A caught fly ball is an out. If it was dropped, that’s an error: Cancel and tap E.');
  assert.equal(await p.locator('.sheet [data-x=save]').isDisabled(), true);
  await p.click('.mv[data-from="0"] [data-to="0"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await p.textContent('.ticker p'), 'Batter 3 flies out to center (F8).');
  // In Fix runners the fly is in the game already: Undo takes it back.
  await p.click('[data-a=fixlast]');
  await p.click('.mv[data-from="0"] [data-to="1"]');
  assert.equal(await p.textContent('.sheet .tally'), 'A caught fly ball is an out. If it was dropped, that’s an error: Undo back to that play and tap E.');
  await p.click('.sheet [data-close]');
  // With two out, a strikeout the batter reached first on is a dropped third strike.
  await p.click('[data-r=K]');
  assert.match(await p.textContent('.bar .title'), /Bottom 1st/);
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  await p.click('.mv[data-from="0"] [data-to="1"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await p.textContent('.ticker p'), 'Batter 4 strikes out but reaches on a dropped third strike.');
  assert.match(await p.textContent('.bar .title'), /Top 1st/);
  assert.equal(await plays(p, id), 'pa1B paGO paFO paKD');
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
  assert.equal(await p.locator('.mv[data-from="2"] [data-to][aria-pressed=true]').textContent(), '3rd');
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

step('a play forgotten a few plays back: Undo to it, score it, and Put back the rest');
{
  const p = await phone();
  const id = await startGame(p);
  await p.click('[data-r="1B"]');
  await p.click('[data-p=b]');
  await p.click('[data-p=b]');
  await p.click('[data-r="1B"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await bases(p), '2:Batter 1 1:Batter 2');
  // Batter 1 had stolen second before those two balls: back to there, and score the steal.
  for (let i = 0; i < 3; i++) await p.click('.ticker [data-a=undo]');
  assert.equal(await bases(p), '1:Batter 1');
  await p.click('[data-runner="1"]');
  await p.click('.sheet [data-k=SB]');
  const links = () => p.$$eval('.ticker .acts button', b => b.map(x => x.textContent));
  assert.deepEqual(await links(), ['Undo', 'Put back 3 plays']);
  // The balls go back as they were; the single moved a runner from first, who's on second now, so it asks.
  await p.click('.ticker [data-a=putback]');
  await p.waitForSelector('.sheet .moves');
  assert.equal(await p.textContent('.sheet h2'), 'Single');
  assert.deepEqual(await p.$$eval('.sheet .mv p', ps => ps.map(x => x.textContent)), ['Batter 1was on second', 'Batter 2at bat']);
  // Cancel: the balls are back, and the single waits to be put back.
  await p.click('.sheet [data-close]');
  assert.equal(await plays(p, id), 'pa1B r p p');
  assert.deepEqual(await links(), ['Undo', 'Put back 1 play']);
  await p.click('.ticker [data-a=putback]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await plays(p, id), 'pa1B r p p pa1B');
  assert.equal(await bases(p), '3:Batter 1 1:Batter 2');
  assert.equal(await tickerOf(p), 'Batter 2 singles. Batter 1 to third.');
  await p.waitForFunction(() => /^Put back 1 play\./.test(document.querySelector('#said').textContent));
  assert.deepEqual(await links(), ['Undo', 'Fix runners']);
  // Each one is its own play again: Undo takes back one at a time.
  await p.click('.ticker [data-a=undo]');
  assert.equal(await plays(p, id), 'pa1B r p p');
  await p.click('.ticker [data-a=redo]');
  // A steal that no longer fits is left out, and the message says so: Batter 2 was picked off instead.
  await p.click('[data-runner="1"]');
  await p.click('.sheet [data-k=SB]');
  await p.click('.ticker [data-a=undo]');
  await p.click('[data-runner="1"]');
  await p.click('.sheet [data-k=PO]');
  await p.click('.ticker [data-a=putback]');
  assert.equal(await seen(p), 'That play doesn’t fit where the game is now, so it’s left out: Batter 2 steals second.');
  assert.equal(await plays(p, id), 'pa1B r p p pa1B r');
  await p.context().close();
}

step('Fix runners starts from the play that was tapped: a line out that scored the run, then held, is a line out');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r=K]');
  await p.click('[data-r="3B"]');
  await p.click('[data-r=LO]');
  await p.click('.sheet [data-pos="7"]');
  await p.waitForSelector('.sheet .moves');
  await p.click('.mv[data-from="3"] [data-to="4"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await p.textContent('.ticker p'), 'Batter 3 hits a sacrifice fly to left (SF7). Batter 2 scores. Owls take the lead, 1–0.');
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  assert.equal(await p.textContent('.sheet h2'), 'Line out L7');
  await p.click('.mv[data-from="3"] [data-to="3"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await p.textContent('.ticker p'), 'Batter 3 lines out to left (L7).');
  assert.equal((await stored(p, id)).ev[2].r, 'LO');
  // And back again: the run scores, and it's a sacrifice fly once more.
  await p.click('[data-a=fixlast]');
  await p.click('.mv[data-from="3"] [data-to="4"]');
  await p.click('.sheet [data-x=save]');
  assert.equal((await stored(p, id)).ev[2].r, 'SF');
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
  assert.equal(await seen(p), 'Changed to error (E6).Undo');
  // The message is about that box: the next sheet (here, who fielded it) opens without it over the fielders.
  await p.click('.sheet [data-y=f]');
  await p.waitForSelector('.sheet .pick');
  assert.equal(await seen(p), '', 'the box’s message is gone from the fielder picker');
  // Another fielder: it was the third baseman's error after all.
  await p.click('.sheet [data-pos="5"]');
  assert.match(await p.textContent('.sheet .cell-big'), /E5 Error/);
  assert.equal((await stored(p, id)).ev[1].f.join(), '5');
  await p.keyboard.press('Escape');
  assert.match(await p.locator('.card').innerHTML(), />E5</);
  // Skip leaves the fielders blank.
  await p.click('[data-cell="0"]');
  await p.click('.sheet [data-sw=GO]');
  await p.click('.sheet [data-x=skip]');
  assert.match(await p.textContent('.sheet .cell-big'), /G Ground out/);
  assert.equal((await stored(p, id)).ev[0].r, 'GO');
  assert.equal((await stored(p, id)).ev[0].f, undefined);

  step('a change made in a box has its own Undo, and Undo on the Card tab says which play it took');
  assert.equal(await seen(p), 'Changed to ground out.Undo');
  await p.click('.sheet-toast button');
  assert.match(await p.textContent('.sheet .cell-big'), /K Strikeout swinging/);
  assert.equal(await p.getAttribute('.sheet [data-sw=K]', 'aria-pressed'), 'true');
  assert.deepEqual(await p.$$eval('.sheet [data-sw=K], .sheet [data-sw=KL]', b => b.map(x => x.textContent)), ['Strikeout swinging', 'Strikeout looking']);
  assert.equal((await stored(p, id)).ev[0].r, 'K');
  assert.equal(await plays(p, id), 'paK paE', 'no play was taken back');
  await p.keyboard.press('Escape');
  assert.match(await p.locator('.card').innerHTML(), />E5</);
  await p.click('.bar .undo');
  assert.equal(await seen(p), 'Took back: Batter 2 reaches on an error by the third baseman (E5).Redo');
  assert.equal(await plays(p, id), 'paK');
  await p.click('#toast button');
  assert.equal(await plays(p, id), 'paK paE');
  assert.match(await p.locator('.card').innerHTML(), />E5</);

  step('a sacrifice bunt with everyone safe can’t be switched to an out');
  await p.click('[data-v=live]');
  await p.click('[data-r=SAC]');
  await p.click('.sheet [data-x=skip]');
  await p.click('.mv[data-from="0"] [data-to="1"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await p.textContent('.ticker p'), 'Batter 3 lays down a sacrifice bunt but reaches first. Batter 2 to second.');
  await p.click('[data-v=card]');
  await p.click('[data-cell="2"]');
  assert.equal(await off(), 'K KL GO FO LO PU SF');
  assert.equal(await p.getAttribute('.sheet [data-sw=GO]', 'title'), 'The batter was safe on it.');
  await p.context().close();
}

step('the runner sheet: a gap between the ways to move up and the balk');
{
  const p = await playing(seventh());
  await p.click('[data-runner="2"]');
  const gap = await p.evaluate(() => { const l = document.querySelector('.sheet .row2 + .list'); return l.getBoundingClientRect().top - l.previousElementSibling.getBoundingClientRect().bottom; });
  assert.ok(gap >= 10, `the balk is ${gap}px below Wild pitch and the rest`);
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
  assert.equal(await seen(p), 'Someone’s on third. Move them up too.');
  await p.click(row(2, 4));
  await p.click('.sheet [data-k=OA]');
  assert.equal(await seen(p), 'Someone’s on third. Move them up too.');
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
  assert.equal(await seen(p), 'Someone’s on second. Move them up too.');
  await p.click(row(2, 3));
  await p.click('.sheet [data-k=OA]');
  assert.equal(await seen(p), 'Two runners can’t both be on third.');
  await p.click(row(1, 4));
  await p.click('.sheet [data-k=OA]');
  assert.equal(await seen(p), 'A runner can’t pass the runner ahead of them.');
  await p.keyboard.press('Escape');
  assert.equal(await plays(p, id), 'pa1B paBB r r pa1B pa1B', 'and nothing was saved');
  await p.context().close();
}

step('a message while a sheet is open shows on top of it, and leaves its buttons free');
{
  const p = await phone();
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
  await startGame(p);
  await p.click('[data-r="1B"]');
  await p.click('[data-r=BB]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=share]');
  await p.click('.sheet [data-y=text]');
  await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent));
  assert.equal(await seen(p), 'Score copied.');
  // The score, where the game is with its outs, and the line score so far.
  assert.match(await p.evaluate(() => navigator.clipboard.readText()), /^Owls 0, Home 0 \(Top 1st, no outs\)\n.+\n\nOwls 0 — 0 1 0\nHome — 0 0 0\n\nOwls: 0 runs, 1 hit, 0 errors\n/);
  const free = sel => p.evaluate(sel => { const b = document.querySelector(sel), r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }, sel);
  assert.equal(await free('.sheet [data-close]'), true, 'Close isn’t under it');
  await p.click('.sheet [data-close]');
  await p.waitForFunction(() => !document.querySelector('.sheet-toast').textContent, null, { timeout: 1000 }); // it goes with the sheet
  // The phone's share sheet sends the score with the link, not only who's playing.
  await p.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: d => { window.shared = d; return Promise.resolve(); } }));
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=share]');
  await p.click('.sheet [data-y=link]');
  await p.waitForFunction(() => window.shared);
  assert.deepEqual(await p.evaluate(() => [window.shared.title, window.shared.text.replace(/ · .*/, ''), window.shared.url.slice(0, 41)]), ['Owls at Home', 'Owls 0, Home 0 (Top 1st, no outs)', 'https://backwards-k.junkdrawer.works/#s=c']);
  await p.click('.sheet [data-close]');
  // Runners on first and second: a steal of second has to wait for the runner there to move.
  await p.click('[data-runner="1"]');
  await p.click('.sheet [data-k=SB]');
  assert.equal(await seen(p), 'Someone’s already on second. Move them first.');
  assert.equal(await free('.sheet [data-close]'), true);
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(() => document.getElementById('sheet').open), false);
  await p.waitForFunction(() => !document.querySelector('.sheet-toast').textContent, null, { timeout: 1000 });
  await p.context().close();
}

step('on a small phone, each sheet’s last row of buttons is in reach without scrolling it');
{
  const p = await playing(sampleUntil(7, S => S.bases[1] && S.bases[2] && S.bases[3] && S.b + S.s === 0), { width: 360, height: 640 });
  const reach = async (what, sel) => {
    await p.waitForTimeout(250);
    const got = await p.evaluate(sel => ({ scrolls: document.querySelector('.sheet-body').scrollHeight > document.querySelector('.sheet-body').clientHeight, top: document.querySelector('.sheet-body').scrollTop, b: document.querySelector(sel).textContent }), sel);
    assert.ok(inside(await box(p, sel), await box(p, '#sheet')), `${what}: ${got.b} is inside the sheet`);
    return got;
  };
  await p.click('[data-r="1B"]');
  assert.deepEqual(await reach('the bases-loaded runners sheet', '.sheet [data-x=save]'), { scrolls: true, top: 0, b: 'Save play' });
  // Two out already, so the runner from first out at second is the third, and the question about the runs shows above
  // Save play.
  await p.click('.mv[data-from="1"] [data-to="0"]');
  assert.match(await p.textContent('.tally'), /third out/);
  assert.ok((await box(p, '.tally')).bottom <= (await box(p, '.sheet-body > .row:last-child')).top + 0.5, 'the question isn’t under the buttons');
  await p.click('.sheet [data-close]');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=help]');
  assert.equal((await reach('the help sheet, 3 screens long', '.sheet-body > .row:last-child button')).b, 'Got it');
  await p.click('.sheet [data-close]');
  assert.equal(await p.evaluate(() => document.getElementById('sheet').open), false);
  await p.context().close();
}

step('scrolling a sheet, or past its end, leaves the game behind it where it was');
{
  const p = await playing(seventh());
  const wheel = async (open, times) => {
    await p.evaluate(() => window.scrollTo(0, 100));
    await open();
    await p.waitForTimeout(250);
    const r = await box(p, '#sheet');
    await p.mouse.move((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    for (let i = 0; i < times; i++) { await p.mouse.wheel(0, 800); await p.waitForTimeout(50); }
    await p.waitForTimeout(300);
    const body = await p.evaluate(() => { const b = document.querySelector('.sheet-body'); return b.scrollHeight - b.clientHeight - b.scrollTop; });
    await p.keyboard.press('Escape');
    return { body, y: await p.evaluate(() => scrollY) };
  };
  assert.deepEqual(await wheel(() => p.click('[data-a=more]'), 1), { body: 0, y: 100 }, 'More, which doesn’t scroll');
  assert.deepEqual(await wheel(async () => { await p.click('[data-a=menu]'); await p.click('.sheet [data-y=help]'); }, 6), { body: 0, y: 100 }, 'help, scrolled to its end and past it');
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
  // A home run with runners on goes straight in: everyone scores.
  await p.click('[data-r=HR]');
  assert.equal(await p.locator('.sheet .moves').count(), 0);
  assert.equal(await said(), 'Batter 3 hits a three-run home run. Batter 1 and Batter 2 score. Owls take the lead, 3–0. Owls 3, Home 0. Nobody on, nobody out.');
  await p.click('.bar .undo');
  assert.equal(await said(), 'Took back: Batter 3 hits a three-run home run. Batter 1 and Batter 2 score. Owls take the lead, 3–0. Runners on second and third, nobody out, 0 balls, 1 strike.');
  assert.equal(await region.evaluate(el => el.isConnected), true, 'the same region all along');
  const board = await p.textContent('.bug');
  assert.match(board, /Owls\s*0, batting/);
  assert.match(board, /Top of the 1st/);
  assert.equal(await p.textContent('.count .sr'), '0 balls, 1 strike');
  assert.equal(await p.textContent('.count .outs .sr'), '0 outs');
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
  // Undo under the field keeps the keyboard there, not in the bar.
  await p.focus('.ticker [data-a=undo]');
  await p.keyboard.press('Enter');
  assert.equal(await p.locator('[data-runner="3"]').count(), 1, 'the steal of home is taken back');
  assert.equal(await on('.ticker [data-a=undo]'), true, 'still on Undo under the field');
  await p.click('[data-v=card]');
  await p.focus('[data-cs="1"]');
  await p.keyboard.press('Enter');
  assert.equal(await on('[data-cs="1"]'), true, 'still on Whose card');
  await p.context().close();
  // Without pitch buttons (pitches not counted), a runner who's gone hands the keyboard to the first result.
  const q = await phone();
  await q.goto(base + '#/new');
  await q.fill('[data-side="0"] [data-name]', 'Owls');
  await q.uncheck('input[name=pitches]');
  await q.click('[data-go]');
  await q.waitForSelector('.live .field');
  await q.click('[data-r="1B"]');
  await q.focus('[data-runner="1"]');
  await q.keyboard.press('Enter');
  await q.focus('.sheet [data-k=SB]');
  await q.keyboard.press('Enter');
  assert.equal(await q.evaluate(() => document.activeElement.matches('.live [data-r="1B"]')), true, 'no pitch buttons: on to the first result');
  await q.context().close();
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

step('saving a link to a game this device has: the link’s new plays come in, and plays only this copy has are kept');
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push('links: ' + e.message));
  await p.goto(base);
  // Saved here from the first link, then renamed here; meanwhile the sender scored three more plays and sent a link.
  const g = sampleUntil(7, S => S.inn === 2), n = g.ev.length;
  const mine = { ...structuredClone(g), updated: g.updated + 5000 };
  mine.teams[1].name = 'Comets II';
  const sent = { ...structuredClone(g), ev: sampleGame(7).ev.slice(0, n + 3), updated: g.updated + 1000 };
  const mineNow = () => stored(p, g.id);
  const save = async x => {
    await p.evaluate(async x => (await import('./js/store.js')).store.add([x]), x);
    const link = await p.evaluate(async x => (await import('./js/share.js')).linkFor(x), x === mine ? sent : x);
    await p.goto(base + link.slice(link.indexOf('#')));
    await p.click('[data-a=keep]');
    await p.waitForSelector('.live .field');
  };
  await save(mine);
  assert.equal(await p.textContent('#toast'), 'Saved to your games.');
  let now = await mineNow();
  assert.deepEqual([now.ev.length, now.teams[1].name], [n + 3, 'Comets II']);
  // A pitch here, and a different one in the sender's next link: both are kept.
  now.ev.push({ t: 'p', k: 'b' });
  now.updated += 1;
  await p.evaluate(async x => (await import('./js/store.js')).store.add([x]), now);
  const other = { ...structuredClone(now), updated: now.updated + 1 };
  other.ev[other.ev.length - 1] = { t: 'p', k: 's' };
  const link = await p.evaluate(async x => (await import('./js/share.js')).linkFor(x), other);
  await p.goto(base + link.slice(link.indexOf('#')));
  await p.click('[data-a=keep]');
  await p.waitForSelector('.live .field');
  assert.equal(await seen(p), 'You already have this game, with plays this link doesn’t have, so both are kept. The link’s is marked (second copy).');
  await written(p);
  const all = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('backwards-k.v1')).games));
  assert.deepEqual(all.map(x => [x.id === g.id, x.place, x.ev.at(-1).k]).sort(), [[false, 'Riverside Park (second copy)', 's'], [true, 'Riverside Park', 'b']]);
  assert.match(p.url(), /#\/g\//);
  assert.notEqual(p.url().split('#/g/')[1], g.id, 'the second copy is the one shown');
  await c.close();
}

step('a game holding a play or an event this version doesn’t know opens look-only, and keeps it');
for (const [n, e] of [[1, { t: 'pa', r: 'ZZ', m: [[0, 1]] }], [2, { t: 'xr', b: 2, why: 'extra innings' }]]) {
  // From a newer copy of the app (or a damaged file).
  const g = sampleUntil(7, S => S.inn === 2);
  g.id = 'gnewer' + n;
  g.ev.push(e);
  const p = await playing(g, undefined, '.shared-bar');
  assert.equal(await p.textContent('.shared-bar p'), 'Part of this game was saved by a newer Backwards K. Reload to get it before changing this game.');
  assert.deepEqual(await p.evaluate(() => ['[data-r]', '.live [data-p]', '[data-a=undo]', '[data-a=menu]', '[data-a=fixlast]', '[data-a=keep]'].map(s => document.querySelectorAll(s).length)), [0, 0, 0, 0, 0, 0], 'nothing to change it with');
  assert.equal(await p.locator('.card').isVisible(), true, 'the card is there to read');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'a look-only game scrolls sideways');
  // Saving another game writes this one back as it came.
  await p.evaluate(async () => { const { store } = await import('./js/store.js'), { newGame } = await import('./js/model.js'); store.save(newGame({ away: 'A', home: 'B' })); });
  assert.deepEqual((await stored(p, g.id)).ev.at(-1), e);
  // Reload brings the newest version there is (here, still this one).
  await Promise.all([p.waitForEvent('load'), p.click('[data-a=reload]')]);
  await p.waitForSelector('.shared-bar');
  await p.context().close();
}

step('a team from a game a newer Backwards K saved starts a game this one can score');
{
  // Its players have something this version doesn't know (how they bat, say): the new game gets their names and
  // numbers, and nothing that would make it look-only.
  const g = sampleUntil(7, S => S.inn === 2);
  g.id = 'gnewerteam';
  for (const t of g.teams) for (const x of [...t.lineup.flat(), ...t.pitchers]) x.bats = 'L';
  const p = await playing(g, undefined, '.shared-bar');
  await p.goto(base + '#/new');
  await p.click('[data-side="0"] [data-past="0"]');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  assert.equal(await p.locator('.shared-bar').count(), 0, 'not look-only');
  assert.equal(await p.locator('[data-r="1B"]').isVisible(), true, 'and scoring goes on');
  const id = await p.evaluate(() => location.hash.slice(4)), mine = await stored(p, id);
  assert.equal(mine.teams[0].lineup[0][0].name, g.teams[0].lineup[0][0].name);
  assert.deepEqual([...new Set([...mine.teams[0].lineup.flat(), ...mine.teams[0].pitchers].map(x => Object.keys(x).join()))], ['name,num']);
  await p.context().close();
}

step('a new pitcher can take the batting spot of the one going out, in one go, with no DH');
{
  // Halvorsen pitches for the Comets and bats 9th.
  const g = sampleUntil(7, S => S.inn === 2 && S.half === 0);
  g.id = 'gdouble';
  g.teams[1].lineup[8] = [{ name: 'Halvorsen', num: '21' }];
  const p = await playing(g);
  const n = g.ev.length, arms = g.teams[1].pitchers.length;
  await p.click('.pitcher');
  await p.click('.sheet [data-y=new]');
  assert.equal(await p.textContent('.sheet .double span'), 'Also bats 9th in place of HalvorsenFor a game without a DH: the batting order changes with the pitcher.');
  assert.equal(await p.isChecked('.sheet [data-also]'), false, 'off unless asked for');
  // Someone already in the order can't take the spot as well.
  await p.click('.sheet [data-pick="0"]');
  assert.equal(await p.isVisible('.sheet .double'), false);
  await p.fill('.sheet [data-f=name]', 'Moss');
  await p.fill('.sheet [data-f=num]', '50');
  await p.check('.sheet [data-also]');
  await p.click('.sheet [data-x=go]');
  assert.equal(await seen(p), 'Two changes: Moss pitches, and bats 9th in place of Halvorsen.');
  let G = await stored(p, g.id);
  assert.deepEqual(G.ev.slice(n).map(untimed), [{ t: 'pch', s: 1, i: arms }, { t: 'sub', s: 1, slot: 8, i: 1, ty: 'def' }]);
  assert.deepEqual(G.teams[1].lineup[8].map(x => x.name), ['Halvorsen', 'Moss']);
  assert.match(await p.textContent('.pitcher'), /Moss/);
  assert.equal(await tickerOf(p), 'Moss comes in for Halvorsen.');
  // Undo takes them back one at a time.
  await p.click('.ticker [data-a=undo]');
  G = await stored(p, g.id);
  assert.deepEqual([G.ev.length, G.teams[1].lineup[8].length, G.teams[1].pitchers.length], [n + 1, 1, arms + 1]);
  await p.context().close();
}

step('a team from before brings its starters back in their spots, and leaves the starting pitcher to pick');
{
  // The Foxes' leadoff hitter had a pinch hitter, and Whitlock started on the mound.
  const g = sampleUntil(7, S => S.inn === 2);
  g.id = 'gpastteam';
  g.teams[0].lineup[0].push({ name: 'Pinchley', num: '40' });
  g.ev.push({ t: 'sub', s: 0, slot: 0, i: 1, ty: 'ph' });
  const p = await playing(g);
  await p.goto(base + '#/new');
  await p.click('[data-side="0"] [data-past="0"]');
  assert.equal(await p.inputValue('[data-side="0"] [data-name]'), 'Foxes');
  assert.deepEqual(await p.$$eval('[data-side="0"] [data-f=name]', i => i.slice(0, 2).map(x => x.value)), ['Ruiz', 'Okafor']);
  assert.deepEqual(await p.$$eval('[data-side="0"] [data-pf]', i => i.map(x => x.value)), ['', '']);
  assert.match(await p.textContent('[data-side="0"] .from-order'), /From the order:Ruiz #2Okafor #11/);
  await p.click('[data-side="0"] .from-order [data-pick="1"]');
  assert.equal(await p.inputValue('[data-side="0"] [data-pf=name]'), 'Okafor');
  await p.context().close();
}

step('the field: the pitcher on the mound, the count and the outs on a board in the corner, and nothing over the runner on second');
for (const [width, height] of [[360, 640], [390, 844], [768, 1024], [1024, 768]]) {
  // Long names: the runner on second and the pitcher, who once shared the top edge.
  const g = seventh(), S = replay(g), r = S.bases[2];
  g.teams[r.side].lineup[r.slot][r.p].name = 'Abernathy-Longfellow';
  g.teams[1 - S.half].pitchers[S.pit[1 - S.half]].name = 'Halvorsen-Whitaker';
  g.ev.push({ t: 'p', k: 'b' }, { t: 'p', k: 's' });
  const p = await playing(g, { width, height });
  const f = await p.evaluate(() => {
    const at = el => { const b = el.getBoundingClientRect(); return { c: el.className.split(' ')[0] + (el.dataset.runner || ''), l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const all = [...document.querySelectorAll('.field .runner, .field .batter, .field .pitcher, .field .count, .field .deck')].map(at);
    const over = [];
    for (const a of all) for (const b of all) if (a.c < b.c && Math.min(a.r, b.r) > Math.max(a.l, b.l) && Math.min(a.b, b.b) > Math.max(a.t, b.t)) over.push(`${a.c} and ${b.c}`);
    const field = document.querySelector('.field').getBoundingClientRect(), mound = document.querySelector('.infield ellipse').getBoundingClientRect();
    const pitcher = document.querySelector('.field .pitcher').getBoundingClientRect(), board = document.querySelector('.field .count').getBoundingClientRect();
    const mid = b => [(b.left + b.right) / 2, (b.top + b.bottom) / 2];
    return {
      over, mound: Math.hypot(mid(pitcher)[0] - mid(mound)[0], mid(pitcher)[1] - mid(mound)[1]) < 2,
      corner: field.right - board.right < 12 && field.bottom - board.bottom < 12,
      board: [...document.querySelectorAll('.field .count .lamps')].map(x => x.querySelector('[aria-hidden]').textContent + ':' + x.querySelectorAll('i.on').length).join(' '),
      strip: !!document.querySelector('.bug .outs'),
    };
  });
  assert.deepEqual(f.over, [], `${width}x${height}: nothing on the field covers anything else`);
  assert.ok(f.mound, `${width}x${height}: the pitcher is on the mound`);
  assert.ok(f.corner, `${width}x${height}: the board is in the bottom right corner`);
  assert.equal(f.board, `B:1 S:1 O:${S.outs}`, `${width}x${height}: B, S and O, each with its lamps`);
  assert.equal(f.strip, false, 'the outs are on the board, not twice');
  await p.context().close();
}

step('not counting pitches, the board is the outs alone, as OUT (an O on its own in the board’s letters is a 0), and the pitcher’s name is in the middle of his chip');
{
  const g = seventh();
  g.pitches = false;
  const p = await playing(g);
  assert.deepEqual(await p.$$eval('.field .count .lamps', l => l.map(x => x.querySelector('[aria-hidden]').textContent + ':' + x.querySelectorAll('i.on').length)), [`OUT:${replay(g).outs}`]);
  const off = await p.evaluate(() => { const c = document.querySelector('.field .pitcher').getBoundingClientRect(), n = document.querySelector('.field .pitcher span').getBoundingClientRect(); return Math.abs(c.top + c.bottom - n.top - n.bottom) / 2; });
  assert.ok(off < 1.5, `the pitcher’s name is ${off} pixels off the middle of his chip`);
  await p.context().close();
}

step('zoomed in to 200%: a tap on a runner, the batter or the pitcher is on that one, not on the one beside it');
for (const width of [195, 210, 260]) {
  // The bases loaded, and long names, so the chips are as wide as they get.
  const g = sampleUntil(7, S => S.bases[1] && S.bases[2] && S.bases[3]), S = replay(g);
  for (const b of [1, 2, 3]) { const r = S.bases[b]; g.teams[r.side].lineup[r.slot][r.p].name = ['', 'Fitzgerald-Montgomery', 'Abernathy-Longfellow', 'Vanderhoeven-Castellanos'][b]; }
  const p = await playing(g, { width, height: Math.round(width * 844 / 390) });
  const wrong = await p.evaluate(() => {
    const sel = '.field .runner, .field .batter, .field .pitcher', name = el => el.className.split(' ')[0] + (el.dataset.runner || ''), out = new Set();
    for (const el of document.querySelectorAll(sel)) {
      // Points all over each chip as it's drawn, rounded corners and all.
      const b = el.getBoundingClientRect(), r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius), b.width / 2, b.height / 2);
      for (let i = 0; i <= 12; i++) for (let j = 0; j <= 6; j++) {
        const x = b.left + b.width * i / 12, y = b.top + b.height * j / 6;
        const cx = Math.min(Math.max(x, b.left + r), b.right - r), cy = Math.min(Math.max(y, b.top + r), b.bottom - r);
        if (Math.hypot(x - cx, y - cy) > r - 1.5 || x < b.left + 1 || x > b.right - 1 || y < b.top + 1 || y > b.bottom - 1) continue;
        const hit = document.elementFromPoint(x, y)?.closest(sel);
        if (hit && hit !== el) out.add(`${name(el)} -> ${name(hit)}`);
      }
    }
    return [...out];
  });
  assert.deepEqual(wrong, [], `${width}: a tap on one lands on another`);
  await p.context().close();
}

step('a phone in Safari (390 by 664): no green strip, a shorter field and buttons, and the outs down to Fly out in sight');
{
  const p = await playing(seventh(), { width: 390, height: 664 });
  const s = await p.evaluate(() => {
    const h = sel => document.querySelector(sel).getBoundingClientRect();
    const field = h('.field'), tabs = [...document.querySelectorAll('.vtabs button')].map(b => b.getBoundingClientRect().height);
    const pill = parseFloat(getComputedStyle(document.querySelector('.vtabs [aria-pressed=true]'), '::before').height);
    // Just above and just below a runner's chip, and the batter's: a tap there is still on them.
    const near = sel => { const r = h(sel), x = (r.left + r.right) / 2; return [r.top - 3, r.bottom + 3].every(y => document.elementFromPoint(x, y)?.closest(sel)); };
    return {
      strip: getComputedStyle(document.querySelector('.bug')).display, ratio: Math.round(field.height / field.width * 300),
      pitch: h('[data-p=b]').height, result: h('[data-r="1B"]').height, tabs: Math.min(...tabs), pill,
      chips: near('[data-runner="2"]') && near('.field .batter'), fly: h('[data-r=FO]').bottom, ih: innerHeight,
    };
  });
  assert.equal(s.strip, 'none', 'the bar has the score and the inning, and the board the outs: no strip');
  assert.equal(s.ratio, 155, 'the field is 300 by 155');
  assert.deepEqual([s.pitch, s.result], [48, 52], 'Ball and the results are 48 and 52 high');
  assert.ok(s.tabs >= 44 && s.pill === 38, `each tab is ${s.tabs} high to tap, with the one showing drawn ${s.pill} high`);
  assert.ok(s.chips, 'a tap just above or below a runner or the batter is on them');
  assert.ok(s.fly <= s.ih, `Fly out ends at ${s.fly}, the screen at ${s.ih}`);
  await p.setViewportSize({ width: 768, height: 1024 });
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.bug')).display), 'flex', 'a tablet keeps the strip');
  await p.context().close();
}

step('the sheets’ chips, the card’s team switch and the steppers are each 44 pixels high to tap');
{
  const p = await playing(seventh());
  const low = async sel => p.$$eval(sel, l => l.length ? l.map(b => Math.round(b.getBoundingClientRect().height)).filter(h => h < 44) : ['none']);
  await p.click('[data-v=card]');
  assert.deepEqual(await low('.seg [data-cs]'), [], 'Whose card');
  await p.click('[data-v=live]');
  await p.click('[data-r="1B"]');
  assert.deepEqual(await low('.sheet .mv [data-to]'), [], 'the runners sheet');
  await p.keyboard.press('Escape');
  await p.click('[data-runner="2"]');
  assert.deepEqual(await low('.sheet [data-to]'), [], 'the runner sheet');
  await p.keyboard.press('Escape');
  await p.click('.field .pitcher');
  await p.click('.sheet [data-y=new]');
  assert.deepEqual(await low('.sheet [data-pick]'), [], 'From the order');
  await p.keyboard.press('Escape');
  await p.click('.field .batter');
  await p.click('.sheet [data-y=ph]');
  assert.deepEqual(await low('.sheet [data-ty]'), [], 'what kind of substitution');
  await p.keyboard.press('Escape');
  await p.goto(base + '#/new');
  await p.waitForSelector('.setup');
  assert.deepEqual(await low('.stepper [data-step]'), [], 'the steppers');
  assert.deepEqual(await low('[data-inn]'), [], 'the innings');
  await p.context().close();
}

step('a first visit: four boxes from a card under Score a new game, each with what it says');
{
  const p = await phone();
  await p.goto(base);
  await p.waitForSelector('.hero');
  const look = await p.$$eval('.first-look > div > div', l => l.map(x => `${x.querySelectorAll('.cell-pic svg.cs').length}:${x.querySelector('span').textContent}`));
  assert.deepEqual(look, ['1:Singled and scored', '1:Walked', '1:Struck out looking', '1:Short to first']);
  assert.match(await p.textContent('.first-look svg text.big.k'), /K/, 'the backwards K is drawn');
  await startGame(p);
  await p.goto(base);
  await p.waitForSelector('.gi');
  assert.equal(await p.locator('.first-look').count(), 0, 'gone once there’s a game');
  await p.context().close();
}

step('the home: a game going on today comes first, with Keep scoring (Start scoring, before the first pitch); one from yesterday, or over, doesn’t');
for (const [what, age, over] of [['today', 3600e3, false], ['not started', 600e3, false], ['yesterday', 13 * 3600e3, false], ['over', 0, true]]) {
  const g = over ? Object.assign(sampleGame(7), { id: 'gsample7final' }) : seventh();
  g.updated = Date.now() - age;
  if (what === 'not started') g.ev = []; // (set up before leaving for the field)
  // (Stored from a page of the site's own that isn't the app, before the app opens.)
  const p = await phone();
  await p.goto(base + 'icon.svg');
  await p.evaluate(doc => localStorage.setItem('backwards-k.v1', doc), JSON.stringify({ app: 'backwards-k', v: 1, games: { [g.id]: g }, gone: {} }));
  await p.goto(base);
  await p.waitForSelector('.gi');
  const home = await p.evaluate(() => ({
    first: document.querySelector('main.home').firstElementChild.className, said: document.querySelector('.back-to .sr')?.textContent,
    up: document.querySelector('.back-row p')?.textContent, words: !!document.querySelector('.hero p'), red: document.querySelector('.hero .btn').classList.contains('primary'),
    go: document.querySelector('.back-to .btn')?.textContent,
  }));
  if (what === 'today') {
    const S = replay(g), n = upNow(S);
    assert.deepEqual(home, { first: 'back-to card-box', said: `Foxes ${S.R[0]}, Comets ${S.R[1]} · Top 7th`, up: `${n.name} up · Riverside Park`, words: false, red: false, go: 'Keep scoring' });
    await p.click('.back-to .btn');
    await p.waitForSelector('.live .field');
    assert.equal(await p.evaluate(() => location.hash), '#/g/' + g.id);
  } else if (what === 'not started') {
    assert.deepEqual(home, { first: 'back-to card-box', said: 'Foxes 0, Comets 0 · Top 1st', up: `${upNow(replay(g)).name} up · Riverside Park`, words: false, red: false, go: 'Start scoring' }, what);
  } else assert.deepEqual(home, { first: 'hero', said: undefined, up: undefined, words: true, red: true, go: undefined }, what);
  await p.context().close();
}

step('the runners sheet: a runner marked out says where, from the next base on (thrown out at the plate on a single)');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r="2B"]');
  await p.click('[data-r="1B"]');
  await p.waitForSelector('.sheet .moves');
  assert.equal(await p.locator('.sheet .how').count(), 0, 'nobody is out: nothing more to ask');
  await p.click('.mv[data-from="2"] [data-to="0"]');
  assert.deepEqual(await p.$$eval('.mv[data-from="2"] [data-at]', b => b.map(x => x.textContent + ':' + x.getAttribute('aria-pressed'))), ['3rd:true', 'Home:false']);
  await p.click('.mv[data-from="2"] [data-at="4"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await tickerOf(p), 'Batter 2 singles. Batter 1 is out at home.');
  assert.deepEqual((await stored(p, id)).ev[1].m, [[0, 1], [2, 0, '@4']]);
  // Fix runners shows it as it was saved; a runner who isn't out has nothing more to say.
  await p.click('[data-a=fixlast]');
  await p.waitForSelector('.sheet .moves');
  assert.equal(await p.getAttribute('.mv[data-from="2"] [data-at="4"]', 'aria-pressed'), 'true');
  await p.click('.mv[data-from="2"] [data-to="3"]');
  assert.equal(await p.locator('.sheet .how').count(), 0);
  await p.click('.sheet [data-close]');

  step('the runners sheet: one who got further than the play takes him did it on the play, on the throw, or on an error');
  await p.click('[data-r="1B"]');
  await p.waitForSelector('.sheet .moves');
  assert.equal(await p.locator('.sheet .how').count(), 0, 'where a single takes him: nothing to ask');
  await p.click('.mv[data-from="1"] [data-to="3"]');
  assert.deepEqual(await p.$$eval('.mv[data-from="1"] [data-how]', b => b.map(x => x.textContent + ':' + x.getAttribute('aria-pressed'))), ['On the play:true', 'On the throw:false', 'Error:false']);
  await p.click('.mv[data-from="1"] [data-how="T"]');
  await p.click('.mv[data-from="0"] [data-to="2"]');
  await p.click('.mv[data-from="0"] [data-how="E"]');
  assert.equal(await p.locator('.mv[data-from="0"] [data-ef]').count(), 9);
  await p.click('.mv[data-from="0"] [data-ef="9"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await tickerOf(p), 'Batter 3 singles and takes second on an error by the right fielder (E9). Batter 2 to third on the throw.');
  assert.deepEqual((await stored(p, id)).ev[2].m, [[0, 2, 'E', [9]], [1, 3, 'T']]);
  assert.match(await p.textContent('.bar .title'), /0–0/);
  await p.click('[data-v=box]');
  assert.match(await p.textContent('.pane[data-p=box]'), /Errors: right fielder\./);
  await p.context().close();
}

step('the runner sheet: defensive indifference moves him up, and isn’t a stolen base');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r="1B"]');
  await p.click('[data-runner="1"]');
  await p.click('.sheet [data-k="DI"]');
  assert.equal(await tickerOf(p), 'Batter 1 takes second on defensive indifference.');
  assert.deepEqual(untimed((await stored(p, id)).ev.at(-1)), { t: 'r', m: [[1, 2, 'DI']] });
  await p.click('[data-v=box]');
  assert.doesNotMatch(await p.textContent('.pane[data-p=box]'), /Stolen bases/);
  await p.context().close();
}

step('a continuous order: a player who left the game is skipped with no out, and Back in puts her spot back');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  await p.click('.sheet [data-sub="3"]');
  await p.click('.sheet [data-y=gone]');
  // (Back to Lineups, as after a substitution made there.)
  assert.match(await p.textContent('.sheet li[data-slot="3"] .earlier'), /Left the game/);
  await p.keyboard.press('Escape');
  assert.equal(await tickerOf(p), 'Batter 4 leaves the game, and the order skips the 4th spot.');
  for (let i = 0; i < 3; i++) await p.click('[data-r="BB"]');
  assert.match(await p.textContent('.batter'), /Batter 5/);
  assert.match(await p.textContent('.deck'), /Batter 6/);
  assert.equal(await p.locator('.outs .o.on').count(), 0, 'no out');
  // From the batter: Batter 5 has gone home too.
  await p.click('[data-a=batter]');
  await p.click('.sheet [data-y=gone]');
  assert.match(await p.textContent('.batter'), /Batter 6/);
  // A courtesy runner isn't one who went home.
  await p.click('[data-runner="1"]');
  await p.click('.sheet [data-k="CR"]');
  assert.deepEqual(await p.$$eval('.sheet [data-cr]', a => a.map(x => x.dataset.cr)), ['6', '7', '8']);
  await p.keyboard.press('Escape');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  assert.match(await p.textContent('.sheet li[data-slot="3"] .earlier'), /Left the game: the order skips this spot\./);
  await p.click('.sheet [data-in="3"]');
  assert.equal(await p.locator('.sheet [data-sub="3"]').count(), 1, 'she can be subbed for again');
  await p.keyboard.press('Escape');
  assert.equal(await tickerOf(p), 'Batter 4 is back in the game, 4th in the order.');
  assert.deepEqual((await stored(p, id)).ev.filter(e => e.t !== 'pa').map(untimed), [{ t: 'gone', s: 0, slot: 3 }, { t: 'gone', s: 0, slot: 4 }, { t: 'back', s: 0, slot: 3 }]);
  await p.click('[data-v=box]');
  assert.match(await p.textContent('.pane[data-p=box]'), /Left the game: Batter 4 \(1st\), Batter 5 \(1st\)\.\s*Back in the game: Batter 4 \(1st\)\./);
  await p.context().close();
}

step('the box score as a spreadsheet, from the share sheet');
{
  const g = { ...sampleGame(7), id: 'gsample7csv' };
  const p = await playing(g, undefined, '.live');
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=share]');
  const [file] = await Promise.all([p.waitForEvent('download'), p.click('.sheet [data-y=csv]')]);
  assert.equal(file.suggestedFilename(), `${g.date} foxes-at-comets box score.csv`);
  const text = await readFile(await file.path(), 'utf8');
  assert.ok(text.startsWith(`\ufeffFoxes at Comets,${g.date},Riverside Park\r\n"Comets 7, Foxes 1 (Final)"\r\n`), text.slice(0, 80));
  assert.match(text, /\r\nFoxes batting\r\nPlayer,No\.,Pos,PA,AB,R,H,2B,3B,HR,RBI,BB,K,HBP,SF,SH,SB,CS\r\nRuiz,2,/);
  await p.context().close();
}

step('a perfect game: not a word while it goes on, then on the final card and first in that team’s box score notes');
{
  const g = newGame({ away: 'Foxes', home: 'Comets', innings: 1 });
  g.teams[1].pitchers[0].name = 'Halvorsen';
  for (const r of ['K', 'K']) g.ev.push({ t: 'pa', r, m: suggest(replay(g), r) });
  const p = await playing(g);
  assert.equal(await p.locator('.feat').count(), 0);
  await p.click('[data-r=K]');
  await p.click('[data-r=HR]');
  assert.equal(await p.textContent('.final .feat'), 'Halvorsen throws a perfect game.');
  await p.click('[data-v=box]');
  assert.deepEqual(await p.$$eval('.pane[data-p=box] .extras', x => x.map(e => e.firstElementChild.className)), ['', 'feat']);
  assert.equal(await p.textContent('.pane[data-p=box] .feat'), 'Halvorsen throws a perfect game.');
  await p.context().close();
}

step('the sample game: earned runs in the box score, the win, the loss and the save beside the names, and in the plays');
{
  const p = await phone();
  await p.goto(base + '#/sample');
  await p.click('[data-v=box]');
  assert.deepEqual(await p.$$eval('.pane[data-p=box] .stats .dec', a => a.map(x => `${x.parentElement.firstChild.textContent.trim()} ${x.textContent} ${x.title}`)), ['Whitlock L Losing pitcher', 'Halvorsen W Winning pitcher', 'Bishop S Save']);
  assert.equal(await p.locator('.pane[data-p=box] .stats thead th abbr[title="Earned runs"]').count(), 2);
  await p.click('[data-v=plays]');
  assert.equal(await p.textContent('.pane[data-p=plays] .decided'), 'Halvorsen gets the win, Whitlock the loss, and Bishop the save.');
  await p.context().close();
}

step('starting partway through: from the bottom of the 3rd, with the runs so far and who’s up');
{
  const p = await phone();
  await p.goto(base + '#/new');
  await p.fill('[data-side="0"] [data-name]', 'Foxes');
  await p.fill('[data-side="1"] [data-name]', 'Comets');
  await p.click('[data-inn="6"]');
  await p.click('details.partway summary');
  assert.equal(await p.inputValue('[name=from]'), '1.0', 'the start, unless it says otherwise');
  assert.equal(await p.locator('[name=from] option').count(), 12);
  await p.selectOption('[name=from]', '3.1');
  assert.equal(await p.textContent('[name=lead] option'), '1. Batter 1');
  assert.match(await p.textContent('details.partway'), /Who’s up for the Comets/);
  // The bottom of the last inning with the home team ahead: that game was over.
  await p.selectOption('[name=from]', '6.1');
  await p.fill('[name=r0]', '2');
  await p.fill('[name=r1]', '4');
  await p.click('[data-go]');
  assert.match(await shown(p), /that game was over/);
  assert.equal(await p.evaluate(() => location.hash), '#/new');
  await p.selectOption('[name=from]', '3.1');
  await p.fill('[name=r0]', '4');
  await p.fill('[name=r1]', '2');
  await p.selectOption('[name=lead]', '5');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  const id = await p.evaluate(() => location.hash.slice(4));
  assert.deepEqual((await stored(p, id)).ev, [{ t: 'join', inn: 3, half: 1, r: [4, 2], up: 5 }]);
  assert.match(await p.textContent('.bar .title'), /Foxes 4–2 Comets\s*Bottom 3rd/);
  assert.match(await p.textContent('.batter'), /Batter 6/);
  await p.click('[data-v=box]');
  assert.match(await p.textContent('.pane[data-p=box]'), /Scored from the bottom of the 3rd\./);
  assert.deepEqual(await p.$$eval('.linescore tbody tr:first-child td', t => t.slice(0, 4).map(x => x.textContent)), ['–', '–', '–', '']);
  await p.context().close();
  // Nothing said: a game from the start, as always.
  const q = await phone(), id2 = await startGame(q);
  assert.deepEqual((await stored(q, id2)).ev, []);
  await q.context().close();
}

step('someone else is batting: the order picks up with him, and the box passed over stays empty');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r=K]');
  await p.click('[data-a=batter]');
  await p.click('.sheet [data-y=up]');
  assert.equal(await p.locator('.sheet [data-up="1"]').count(), 0, 'not the one up already');
  await p.click('.sheet [data-up="2"]');
  assert.equal(await tickerOf(p), 'Batter 3 is batting, 3rd in the order.');
  assert.match(await p.textContent('.batter'), /Batter 3/);
  assert.match(await p.textContent('.deck'), /Batter 4/);
  await p.click('[data-r="1B"]');
  assert.deepEqual((await stored(p, id)).ev.map(e => e.t), ['pa', 'up', 'pa']);
  await p.click('[data-v=card]');
  assert.equal(await p.locator('.card tbody tr:nth-child(2) [data-cell]').count(), 0, 'Batter 2’s box is empty');
  assert.equal(await p.locator('.card tbody tr:nth-child(3) [data-cell]').count(), 1);
  await p.context().close();
}

step('a courtesy runner: only the name on the base changes, and the player she ran for keeps her spot and the run');
{
  const p = await phone(), id = await startGame(p);
  await p.click('[data-r="1B"]');
  await p.click('[data-runner="1"]');
  await p.click('.sheet [data-k="CR"]');
  assert.equal(await p.locator('.sheet [data-cr="0"]').count(), 0, 'not the runner herself');
  assert.equal(await p.locator('.sheet [data-cr="1"]').count(), 0, 'nor the batter');
  await p.fill('.sheet [data-f=name]', 'Emma');
  await p.click('.sheet [data-x=go]');
  assert.equal(await tickerOf(p), 'Emma runs for Batter 1 on first, a courtesy runner.');
  assert.equal(await bases(p), '1:Emma');
  assert.match(await p.textContent('.batter'), /Batter 2/, 'the order goes on as it was');
  await p.click('[data-r="2B"]');
  await p.click('.mv[data-from="1"] [data-to="4"]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await tickerOf(p), 'Batter 2 doubles. Emma scores. Owls take the lead, 1–0.');
  assert.deepEqual(untimed((await stored(p, id)).ev[1]), { t: 'cr', s: 0, b: 1, name: 'Emma', num: '' });
  await p.click('[data-v=box]');
  const box = await p.textContent('.pane[data-p=box]');
  assert.match(box, /Courtesy runners: Emma ran for Batter 1 in the 1st\./);
  assert.match(await p.innerHTML('.pane[data-p=box] .stats tbody tr'), /Batter 1<\/th><td>1<\/td><td>1<\/td><td>1<\/td>/, 'Batter 1: 1 AB, 1 run, 1 hit');
  await p.context().close();
}

step('positions: kept from a pasted lineup, changed in Lineups, on the card and the box score, and names on the fielder picker');
{
  const p = await phone();
  await p.goto(base + '#/new');
  await p.fill('[data-side="1"] [data-name]', 'Comets');
  await p.click('[data-side="1"] [data-paste]');
  await p.fill('.sheet textarea', '1. Abernathy CF\n2. 22 Nakamura SS\n3. Velez 1B\n4. Quinn C\n5. Sutton 3B\n6. Ibarra RF\n7. Kowalski LF\n8. Ferris 2B\n9. Tran DH\nSP: Halvorsen');
  await p.click('[data-x=use]');
  assert.equal(await p.inputValue('[data-side="1"] [data-i="1"][data-f="pos"]'), 'SS');
  await p.selectOption('[data-side="1"] [data-i="8"][data-f="pos"]', '');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  const id = await p.evaluate(() => location.hash.slice(4));
  assert.deepEqual((await stored(p, id)).teams[1].lineup.map(s => s[0].pos || '-'), ['CF', 'SS', '1B', 'C', '3B', 'RF', 'LF', '2B', '-']);
  // The fielder picker: each one's name with his number.
  await p.click('[data-r=GO]');
  assert.equal(await p.getAttribute('.sheet [data-pos="6"]', 'aria-label'), '6, shortstop, Nakamura');
  assert.equal(await p.getAttribute('.sheet [data-pos="1"]', 'aria-label'), '1, pitcher, Halvorsen');
  assert.deepEqual(await p.$$eval('.sheet .pos .who', t => t.map(x => x.textContent)), ['Halvorsen', 'Quinn', 'Velez', 'Ferris', 'Sutton', 'Nakamura', 'Kowalski', 'Abernathy', 'Ibarra']);
  await p.click('.sheet [data-pos="6"]');
  await p.click('.sheet [data-pos="3"]');
  await p.click('.sheet [data-x=done]');
  // Lineups: Nakamura moves to second.
  await p.click('[data-a=menu]');
  await p.click('.sheet [data-y=lineup]');
  await p.click('.sheet [data-ls="1"]');
  await p.selectOption('.sheet [data-slot="1"][data-f="pos"]', '2B');
  await p.keyboard.press('Escape');
  // (Saved after a pause, as names are.)
  await p.waitForFunction(id => JSON.parse(localStorage.getItem('backwards-k.v1')).games[id].teams[1].lineup[1][0].pos === '2B', id);
  await p.click('[data-v=card]');
  await p.click('[data-cs="1"]');
  assert.match(await p.innerHTML('.card'), /title="Nakamura 2B #22">Nakamura <small>2B #22<\/small>/);
  await p.click('[data-v=box]');
  // (The name a link to his season: a game on this device.)
  assert.match(await p.innerHTML('.pane[data-p=box]'), />Nakamura<\/a> <small class="ps">2B<\/small>/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the box score with positions scrolls sideways');
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

step('a laptop: nine innings of the card and AB R H RBI fit beside the buttons, in boxes as big as the room allows');
for (const [width, height, size] of [[1280, 800, 62], [1366, 768, 68], [1440, 900, 72], [1920, 1080, 72]]) {
  const p = await playing(seventh(), { width, height });
  const fit = await p.evaluate(() => { const w = document.querySelector('.card-wrap'); return { scroll: w.scrollWidth, client: w.clientWidth, box: w.querySelector('tbody td').offsetWidth }; });
  assert.ok(fit.scroll <= fit.client, `${width}x${height}: the card is ${fit.scroll} wide in ${fit.client}`);
  assert.equal(fit.box, size, `${width}x${height}: boxes`);
  await p.context().close();
}

step('after the final, the words say where the card is: under Card, below, or beside');
for (const [width, height, where] of [[390, 844, 'under Card'], [768, 1024, 'below'], [1024, 768, 'beside this']]) {
  const g = sampleGame(7);
  g.id = 'gsample7final';
  const p = await playing(g, { width, height });
  assert.match(await p.textContent('.final p:not(.decider)'), new RegExp(`The whole card is ${where}, and the box score under Box score`), `${width} wide`);
  // And the play that won it, under who won.
  assert.equal(await p.textContent('.final h2 + .decider'), 'Quinn’s two-run home run in the bottom of the 5th put the Comets ahead for good.');
  await p.context().close();
}

step('at night: a picked fielder reads clearly on the red, and the phone’s bar matches the app’s');
for (const scheme of ['light', 'dark']) {
  const p = await playing(seventh());
  await p.emulateMedia({ colorScheme: scheme });
  await p.click('[data-r=GO]');
  await p.click('.sheet [data-pos="6"]');
  // WCAG contrast between two rgb() colours.
  const contrast = await p.evaluate(() => {
    const lum = c => { const v = c.match(/\d+/g).slice(0, 3).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const spot = document.querySelector('[data-pos="6"] .spot'), ink = document.querySelector('[data-pos="6"] .num');
    const [a, b] = [lum(getComputedStyle(spot).fill), lum(getComputedStyle(ink).fill)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
  assert.ok(contrast >= 4.5, `${scheme}: the picked 6 is ${contrast.toFixed(1)}:1 on its circle`);
  const bar = await p.evaluate(() => [getComputedStyle(document.querySelector('.bar')).backgroundColor, document.querySelector(`meta[name=theme-color][media*="${matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'}"]`).content]);
  const hex = bar[1].match(/\w\w/g).map(x => parseInt(x, 16)).join(', ');
  assert.equal(bar[0], `rgb(${hex})`, `${scheme}: the browser’s bar is the app bar’s colour`);
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
  // The box score keeps to its page too, spray charts and all: the whole sample game, whose hits say where they went.
  await p.evaluate(async () => {
    const { printGame } = await import('./js/share.js'), { sampleGame } = await import('./js/sample.js');
    printGame(sampleGame(7));
  });
  for (const [w, h] of [[7.7, 10.2], [10.2, 7.7]]) {
    await p.setViewportSize({ width: Math.round(w * 96), height: Math.round(h * 96) });
    const box = await p.evaluate(() => {
      const b = document.querySelector('#print .pbox');
      return { h: b.getBoundingClientRect().height + parseFloat(getComputedStyle(b.querySelector('h2')).marginTop), charts: b.querySelectorAll('.spray').length };
    });
    assert.equal(box.charts, 2);
    assert.ok(box.h < h * 96, `${w}x${h}in: the box score takes ${box.h} of ${h * 96}`);
  }
  await p.context().close();
}

// Three of the sample's games this season and one last season, each on its own day: the season pages' games.
const seasonOf = () => {
  const games = [1, 2, 3].map(i => ({ ...sampleGame(i), id: 'gseason' + i, date: `2026-0${4 + i}-0${i}`, updated: 1000 + i }));
  games.push({ ...sampleGame(4), id: 'gseason4', date: '2025-06-01', updated: 999 });
  return games;
};
async function seasonPhone(games, viewport = { width: 390, height: 844 }) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 700, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
  await c.addInitScript(doc => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('backwards-k.v1', doc); sessionStorage.setItem('seeded', '1'); } },
    JSON.stringify({ app: 'backwards-k', v: 1, games: Object.fromEntries(games.map(g => [g.id, g])), gone: {} }));
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  return p;
}

step('season stats: the home lists the teams, and a team’s page adds up its games, sorts by a column and picks a year');
{
  globalThis.document ??= { readyState: 'complete', getElementById: () => null };
  const ST = await import('../js/stats.js');
  const games = seasonOf(), T = ST.season(games, 'Foxes');
  const p = await seasonPhone(games);
  await p.goto(base);
  assert.deepEqual(await p.$$eval('.ti', l => l.map(a => a.textContent.replace(/\s+/g, ' ').trim())), ['Foxes 3 games in 2026', 'Comets 3 games in 2026']);
  await p.click('.ti >> text=Foxes');
  await p.waitForSelector('.team .season');
  await p.waitForFunction(() => document.activeElement.tagName === 'H1');
  assert.equal(await p.evaluate(() => location.hash), '#/team/Foxes');
  assert.equal(await p.textContent('.team h1'), 'Foxes');
  assert.match(await p.textContent('.team-head p'), new RegExp(`2026 season · 3 games · ${T.record.w}–${T.record.l}`));
  assert.equal(await p.evaluate(() => document.activeElement.tagName), 'H1', 'the keyboard on the page’s heading');
  const rows = () => p.$$eval('[data-t=bat] tbody tr', l => l.map(r => [r.querySelector('th a').textContent, ...[...r.querySelectorAll('td')].map(d => d.textContent)]));
  // In batting order, each line as the season adds up, and the totals.
  const want = T.bat.map(x => [x.name, ...[x.bat.g, x.bat.pa, x.bat.ab, x.bat.r, x.bat.h, x.bat.d, x.bat.t, x.bat.hr, x.bat.rbi, x.bat.bb, x.bat.k, x.bat.hbp, x.bat.sb, x.bat.cs].map(String),
    ST.three(ST.avg(x.bat)), ST.three(ST.obp(x.bat)), ST.three(ST.slg(x.bat)), ST.three(ST.ops(x.bat))]);
  assert.deepEqual(await rows(), want);
  assert.equal(want[0][0], 'Ruiz');
  assert.equal(await p.textContent('[data-t=bat] tfoot td:nth-child(6)'), String(T.tot.bat.h));
  // A tap on H sorts by hits, most first; again, fewest first.
  await p.click('[data-sort="bat:h"]');
  const hits = async () => (await rows()).map(r => +r[5]);
  assert.deepEqual(await hits(), (await hits()).slice().sort((a, b) => b - a));
  assert.equal(await p.getAttribute('th:has([data-sort="bat:h"])', 'aria-sort'), 'descending');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.sort), 'bat:h', 'the keyboard stays on the heading');
  await p.click('[data-sort="bat:h"]');
  assert.deepEqual(await hits(), (await hits()).slice().sort((a, b) => a - b));
  assert.equal(await p.getAttribute('th:has([data-sort="bat:h"])', 'aria-sort'), 'ascending');
  // The pitchers, the games newest first, and nothing wider than the phone but the tables, which scroll.
  assert.deepEqual(await p.$$eval('[data-t=pit] tbody th a', l => l.map(a => a.textContent)), T.pit.map(x => x.name));
  assert.deepEqual(await p.$$eval('.game-log .gl', l => l.map(a => a.getAttribute('href'))), ['#/g/gseason3', '#/g/gseason2', '#/g/gseason1']);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the team’s page scrolls sideways');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.season tbody th')).position), 'sticky', 'the names stay put');
  // Last season, and every year.
  const says = text => p.waitForFunction(t => (document.querySelector('.team-head p')?.textContent || '').startsWith(t), text);
  await p.click('.years >> text=2025');
  await says('2025 season · 1 game ·');
  assert.equal(await p.evaluate(() => location.hash), '#/team/Foxes/2025');
  await p.click('.years >> text=Every year');
  await says('2025–2026 · 4 games ·');
  assert.equal(await p.evaluate(() => location.hash), '#/team/Foxes/all');
  // The season as a spreadsheet.
  const [file] = await Promise.all([p.waitForEvent('download'), p.click('[data-a=csv]')]);
  assert.equal(file.suggestedFilename(), 'foxes-every-year-season.csv');
  assert.ok((await readFile(await file.path(), 'utf8')).startsWith('﻿"Foxes, every season"\r\n'));
  await p.context().close();
}

step('season stats: a player’s page has her line, each game with her boxes from the card, and her season as text');
{
  const ST = await import('../js/stats.js');
  const games = seasonOf(), T = ST.season(games, 'Foxes'), ruiz = T.bat.find(x => x.key === 'ruiz');
  const p = await seasonPhone(games);
  await p.goto(base + '#/team/Foxes');
  await p.click('[data-t=bat] >> text=Ruiz');
  await p.waitForFunction(() => document.querySelector('.team h1')?.textContent === 'Ruiz');
  assert.equal(await p.evaluate(() => location.hash), '#/team/Foxes/2026/Ruiz');
  assert.match(await p.textContent('.team-head p'), /#2 · Foxes · 2026 season/);
  assert.equal(await p.textContent('.sum'), `${ST.three(ST.avg(ruiz.bat))} (${ruiz.bat.h} for ${ruiz.bat.ab}) in 3 games, with ${ST.batWords(ruiz.bat, true)}. On base ${ST.three(ST.obp(ruiz.bat))}, slugging ${ST.three(ST.slg(ruiz.bat))}.`);
  // A game each, newest first, each with his day in words and his boxes, one for each trip to the plate.
  const days = await p.$$eval('.days .gl', l => l.map(a => [a.getAttribute('href'), a.querySelector('.gl-line').textContent, a.querySelectorAll('.cell-pic').length]));
  assert.deepEqual(days, ruiz.days.slice().reverse().map(d => [`#/g/${d.game.id}`, ST.batWords(d.line), d.line.pa]));
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'a player’s page scrolls sideways');
  // The text, for the grandparents.
  await p.click('[data-a=text]');
  assert.equal(await p.evaluate(() => navigator.clipboard.readText()), ST.seasonText(T, ruiz));
  assert.match(await shown(p), /Copied/);
  // A pitcher's page: his pitching by date. Back goes to the team.
  await p.goto(base + '#/team/Foxes/2026/Whitlock');
  await p.waitForSelector('#pitH');
  assert.equal(await p.locator('[aria-label="Pitching by date"] tbody tr').count(), 3);
  assert.equal(await p.locator('#batH').count(), 0, 'he didn’t bat');
  await p.click('.bar .back');
  await p.waitForFunction(() => document.querySelector('.team h1')?.textContent === 'Foxes');
  assert.equal(await p.evaluate(() => location.hash), '#/team/Foxes/2026');
  // Someone who didn't play for them says so.
  await p.goto(base + '#/team/Foxes/2026/Nobody');
  assert.match(await p.textContent('.team'), /Nobody called Nobody played for the Foxes in a 2026 game on this device/);
  await p.context().close();
}

step('season stats: a name in the box score, a box’s sheet, the batter’s and the pitcher’s go to the player’s season');
{
  const games = seasonOf();
  // (And a game going on: the batter's and the pitcher's sheets.)
  games.push({ ...sampleUntil(5, S => S.inn === 3 && S.half === 0 && !S.seq), id: 'gseason5', date: '2026-08-01', updated: 1010 });
  const p = await seasonPhone(games);
  await p.goto(base + '#/g/gseason1');
  await p.click('[data-v=box]');
  assert.equal(await p.getAttribute('.pane[data-p=box] .stats th a >> text=Ruiz', 'href'), '#/team/Foxes/2026/Ruiz');
  assert.equal(await p.getAttribute('.pane[data-p=box] .stats th a >> text=Whitlock', 'href'), '#/team/Foxes/2026/Whitlock');
  await p.click('.pane[data-p=box] .stats th a >> text=Ruiz');
  await p.waitForFunction(() => document.querySelector('.team h1')?.textContent === 'Ruiz');
  // A box on the card: its sheet ends with the season.
  await p.goBack();
  await p.waitForSelector('.vtabs');
  await p.click('[data-v=card]');
  await p.click('[data-cell="0"]');
  assert.equal(await p.textContent('.sheet .season-link b'), 'Ruiz’s season');
  await p.click('.sheet .season-link a');
  await p.waitForFunction(() => document.querySelector('.team h1')?.textContent === 'Ruiz');
  assert.equal(await p.evaluate(() => document.getElementById('sheet').open), false, 'the sheet closed');
  // The batter's sheet, and the pitcher's, in a game going on.
  await p.goto(base + '#/g/gseason5');
  await p.waitForSelector('.live .field');
  const up = upNow(replay(games[4]));
  await p.click('[data-a=batter]');
  assert.equal(await p.getAttribute('.sheet a.li', 'href'), `#/team/Foxes/2026/${up.name}`);
  await p.click('.sheet [data-close]');
  await p.click('[data-a=pitcher]');
  assert.equal(await p.getAttribute('.sheet a.li', 'href'), `#/team/Comets/2026/${up.pitcherName}`);
  await p.click('.sheet [data-close]');
  // A shared link's game, and the sample, aren't games here: no links.
  await p.goto(base + '#/sample');
  await p.waitForSelector('.vtabs');
  await p.click('[data-v=box]');
  assert.equal(await p.locator('.pane[data-p=box] .stats a').count(), 0);
  await p.click('[data-v=card]');
  await p.click('[data-cell="0"]');
  assert.equal(await p.locator('.sheet .season-link').count(), 0);
  await p.context().close();
}

step('season stats: Pinch hitter and New pitcher offer the team’s players from its other games this season');
{
  const ST = await import('../js/stats.js');
  const games = seasonOf();
  // A new game: the Comets with three in the order, at the Foxes, who have Whitlock pitching.
  const g = { ...sampleGame(1), id: 'gseason6', date: '2026-08-02', updated: 2000, ev: [], start: 0 };
  g.teams = [{ name: 'Comets', lineup: ['Abernathy', 'Nakamura', 'Velez'].map(name => [{ name, num: '' }]), pitchers: [{ name: 'Halvorsen', num: '21' }] },
    { name: 'Foxes', lineup: [[{ name: 'Ruiz', num: '2' }]], pitchers: [{ name: 'Whitlock', num: '33' }] }];
  games.push(g);
  const p = await seasonPhone(games);
  await p.goto(base + '#/g/gseason6');
  await p.waitForSelector('.live .field');
  const chips = () => p.$$eval('.sheet [data-before]', l => l.map(c => c.textContent));
  const label = x => x.name + (x.num ? ' #' + x.num : '');
  // Pinch hitter: the Comets who played this season and aren't in this game, the most games first.
  await p.click('[data-a=batter]');
  await p.click('.sheet [data-y=ph]');
  const bench = ST.earlier(games, g, 0);
  assert.deepEqual(await chips(), bench.map(label));
  assert.ok(bench.length >= 5 && !bench.some(x => ['Abernathy', 'Nakamura', 'Velez'].includes(x.name)));
  await p.click('.sheet [data-before] >> text=Quinn');
  assert.deepEqual([await p.inputValue('.sheet [data-f=name]'), await p.inputValue('.sheet [data-f=num]')], ['Quinn', '44']);
  assert.equal(await p.getAttribute('.sheet [data-before] >> text=Quinn', 'aria-pressed'), 'true');
  await p.click('.sheet [data-x=go]');
  await p.waitForFunction(() => /Quinn/.test(document.querySelector('.batter')?.textContent || ''));
  assert.deepEqual((await stored(p, g.id)).teams[0].lineup[0].map(x => x.name), ['Abernathy', 'Quinn']);
  // New pitcher: the Foxes' pitchers from their other games, not Whitlock, who's pitching.
  await p.click('[data-a=pitcher]');
  await p.click('.sheet [data-y=new]');
  const arms = ST.earlier(games, g, 1, { pitchers: true });
  assert.ok(arms.length && !arms.some(x => x.name === 'Whitlock'));
  assert.deepEqual(await chips(), arms.map(label));
  await p.click(`.sheet [data-before="0"]`);
  assert.equal(await p.inputValue('.sheet [data-f=name]'), arms[0].name);
  await p.click('.sheet [data-x=go]');
  await p.waitForFunction(name => (document.querySelector('.pitcher')?.textContent || '').includes(name), arms[0].name);
  await p.context().close();
}

step('the offline copy lists every file the app needs, and each one is there');
{
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const shell = [.../const SHELL = \[([^\]]*)\]/.exec(sw)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const files = async dir => (await readdir(join(root, dir))).map(f => `${dir}/${f}`);
  const want = [
    './', 'index.html', 'manifest.webmanifest', ...(await readdir(root)).filter(f => /^icon.*\.(svg|png)$/.test(f)),
    ...await files('js'), ...await files('css'), ...await files('fonts'),
  ];
  assert.deepEqual([...shell].sort(), want.sort());
  for (const f of shell) await readFile(join(root, f === './' ? 'index.html' : f));
}

step('the install sheet’s pictures: each one there, at the size the manifest gives, phones narrow and the tablet wide');
{
  const m = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual(m.screenshots.map(x => `${x.src} ${x.form_factor}`), ['docs/phone-score.png narrow', 'docs/phone-runners.png narrow', 'docs/phone-card.png narrow', 'docs/tablet.png wide']);
  for (const x of m.screenshots) {
    const png = await readFile(join(root, x.src));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, x.sizes, x.src);
    assert.ok(x.label, `${x.src} has words for a screen reader`);
  }
}

step('it works offline once opened');
await page.goto(base);
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
const kept = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('backwards-k.v1')).games)[0]);
assert.ok(kept, 'a game to open');
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.gi');
assert.equal(await page.title(), 'Backwards K');
// A new tab, straight to a game, and to the sample.
for (const [h, sel] of [['#/g/' + kept, '.live .field'], ['#/sample', '.card']]) {
  const q = await ctx.newPage();
  await q.goto(base + h);
  await q.waitForSelector(sel, { timeout: 5000 });
  await q.close();
}
await ctx.setOffline(false);

step('online, a reload still gets a changed file from the server');
extra['/css/app.css'] = '\n:root { --probe: fresh; }\n';
await page.reload();
await page.waitForSelector('.gi');
assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--probe').trim()), 'fresh');
delete extra['/css/app.css'];

step('with one bar of signal (a server that never answers), a game opens from the copy kept here in a few seconds');
hold = true;
{
  const q = await ctx.newPage(), t0 = Date.now();
  try {
    await q.goto(base + '#/g/' + kept, { timeout: 6000 });
    await q.waitForSelector('.live .field', { timeout: Math.max(1, 6000 - (Date.now() - t0)) });
  } finally {
    await q.close();
    hold = false;
    release(false);
  }
}

// A new version on the server, whose game.js asks ui.js for something only the new ui.js has: a page with the new
// game.js and the ui.js from before stays blank.
const NEW = { '/js/game.js': "\nimport { probe } from './ui.js';\ndocument.documentElement.dataset.probe = probe;\n", '/js/ui.js': "\nexport const probe = 'new';\n" };
const version = p => p.evaluate(() => document.documentElement.dataset.probe || 'before');
const until = async (f, ms, what) => { const t = Date.now(); while (!(await f())) { assert.ok(Date.now() - t < ms, `waited ${ms} ms for ${what}`); await new Promise(r => setTimeout(r, 100)); } };
// A phone that has opened the app once, with its own service worker and the copy that keeps.
async function visited() {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await c.newPage();
  await p.goto(base);
  await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
  await p.close();
  return c;
}
// Whether the copy kept here is whole and of the new version.
const keptNew = p => p.evaluate(async () => {
  for (const k of await caches.keys()) {
    const ui = await caches.match('js/ui.js', { cacheName: k });
    if (await caches.match('kept-set-done', { cacheName: k }) && ui && (await ui.text()).includes('probe')) return true;
  }
  return false;
});

step('right after a new version, on one bar of signal, a page gets one version, never some files of each');
{
  const c = await visited(), errors = [];
  Object.assign(extra, NEW);
  hold = new Set(['/js/ui.js']);
  try {
    const q = await c.newPage(), t0 = Date.now();
    q.on('pageerror', e => errors.push(e.message));
    await q.goto(base, { waitUntil: 'commit' });
    // The new game.js came straight away and ui.js not at all, so the page reloaded itself and got the version kept
    // here, all of it.
    await q.waitForSelector('.hero h1', { timeout: 8000 });
    assert.equal(await version(q), 'before');
    assert.ok(Date.now() - t0 < 6000, `the home screen took ${Date.now() - t0} ms`);
    // The copy is still that version, whole, though the new game.js has come down: it opens in another tab, and
    // the new game.js isn't in it.
    const r = await c.newPage();
    r.on('pageerror', e => errors.push(e.message));
    await r.goto(base);
    await r.waitForSelector('.hero h1', { timeout: 5000 });
    assert.equal(await version(r), 'before');
    assert.equal(await r.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) if (await caches.match('kept-set-done', { cacheName: k })) out.push((await (await caches.match('js/game.js', { cacheName: k })).text()).includes('probe'));
      return out.join();
    }), 'false');
    // Once ui.js comes too, the copy is the new version, whole, and that's what opens offline.
    hold = false;
    release();
    await until(() => keptNew(r), 10000, 'the new version to be kept');
    await c.setOffline(true);
    await r.reload();
    await r.waitForSelector('.hero h1', { timeout: 5000 });
    assert.equal(await version(r), 'new');
    assert.deepEqual(errors, []);
  } finally {
    hold = false;
    release(false);
    for (const k of Object.keys(NEW)) delete extra[k];
    await c.close();
  }
}

step('a network that answers every file, but only after 2.5 seconds, is as weak as one that never answers');
{
  const c = await visited();
  delay = 2500;
  try {
    const q = await c.newPage(), t0 = Date.now();
    await q.goto(base, { waitUntil: 'commit', timeout: 20000 });
    await q.waitForSelector('.hero h1', { timeout: 20000 });
    // The page took 2.5 seconds, and the rest came from the copy (one level of files after another, each 2.5 seconds
    // late, took 11).
    assert.ok(Date.now() - t0 < 5000, `the home screen took ${Date.now() - t0} ms`);
  } finally {
    delay = 0;
    await c.close();
  }
}

step('a page the older sw.js put together from two versions reloads itself, once, and comes back whole');
{
  oldWorker = true;
  const c = await visited(), errors = [];
  let navs = 0;
  try {
    const p0 = await c.newPage();
    await p0.goto(base);
    assert.deepEqual(await p0.evaluate(() => caches.keys()), ['backwards-k-v2'], 'the older sw.js and its copy');
    await p0.close();
    // The new version comes with today's sw.js.
    oldWorker = false;
    Object.assign(extra, NEW);
    hold = new Set(['/js/ui.js']);
    const q = await c.newPage();
    q.on('pageerror', e => errors.push(e.message));
    q.on('framenavigated', f => { if (f === q.mainFrame()) navs++; });
    await q.goto(base, { waitUntil: 'commit' });
    // The older sw.js gave it the new game.js and, after 3 seconds, the ui.js it kept: blank, until it reloads.
    await until(() => navs === 2, 8000, 'the page to reload itself');
    assert.match(errors.join(' '), /does not provide an export named 'probe'/);
    // The copy it kept went first, so that reload asks the network for everything, and once ui.js comes, it's the
    // new version, all of it.
    hold = false;
    release();
    await q.waitForSelector('.hero h1', { timeout: 8000 });
    assert.equal(await version(q), 'new');
    assert.equal(navs, 2, 'it reloaded once');
    assert.equal(errors.length, 1, errors.join(' '));
  } finally {
    oldWorker = false;
    hold = false;
    release(false);
    for (const k of Object.keys(NEW)) delete extra[k];
    await c.close();
  }
}

step('Ask where hits went: a hit asks, one tap or Skip, and the plays say where');
{
  const p = await phone();
  await p.goto(base + '#/new');
  // Off to start with, so a hit is still one tap.
  assert.equal(await p.isChecked('[name=spray]'), false);
  await p.check('[name=spray]');
  await p.fill('[data-side="0"] [data-name]', 'Owls');
  await p.click('[data-go]');
  await p.waitForSelector('.live .field');
  const id = await p.evaluate(() => location.hash.slice(4));
  await p.click('[data-r="1B"]');
  assert.equal(await p.textContent('.sheet h2'), 'Single: where did it go?');
  assert.equal(await p.locator('.sheet [data-x=done]').count(), 0, 'one tap, no Done');
  await p.click('.sheet [data-pos="7"]');
  // Nobody on: it goes straight in.
  assert.match(await tickerOf(p), /^Batter 1 singles to left\./);
  assert.deepEqual((await stored(p, id)).ev.at(-1).f, [7]);
  // From a keyboard: 2 for a double, then 8 for center. A runner on: the runners sheet says where it went.
  await p.keyboard.press('2');
  await p.waitForSelector('.sheet .pick');
  await p.keyboard.press('8');
  await p.waitForSelector('.sheet .moves');
  assert.equal(await p.textContent('.sheet h2'), 'Double to center');
  await p.click('[data-x=save]');
  assert.match(await tickerOf(p), /^Batter 2 doubles to center\./);
  // Skip: nothing more said than before.
  await p.click('[data-r="HR"]');
  await p.click('.sheet [data-x=skip]');
  // (A home run, with runners on or not, has nothing to ask about them.)
  assert.match(await tickerOf(p), /^Batter 3 hits a three-run home run\./);
  // A box: where it went can be changed, and the change has its own Undo.
  await p.click('[data-v=card]');
  await p.click('[data-cell="0"]');
  assert.equal(await p.textContent('.sheet [data-y=w]'), 'Change where it went (left)');
  await p.click('.sheet [data-y=w]');
  await p.click('.sheet [data-pos="9"]');
  assert.match(await seen(p), /^Changed to single to right\./);
  assert.match(await p.textContent('.sheet'), /Batter 1 singles to right\./);
  // Where Batter 1 hit it today, with this box picked out; and the team's, in the box score.
  assert.equal(await p.textContent('.sheet .spray figcaption'), 'Where Batter 1 hit it today');
  assert.equal(await p.locator('.sheet .spray .ball.hit.now').count(), 1);
  await p.click('.sheet [data-close]');
  await p.click('[data-v=box]');
  assert.equal(await p.textContent('.pane[data-p=box] .spray figcaption'), 'Where the Owls hit it');
  assert.equal(await p.locator('.pane[data-p=box] .spray .ball.hit').count(), 2);
  assert.equal(await p.textContent('.pane[data-p=box] .spray-words'), 'Hits: 1 to center, 1 to right.');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the box score with its chart fits the phone');
  // The next new game starts with it on, as the last one had it.
  await p.goto(base + '#/new');
  assert.equal(await p.isChecked('[name=spray]'), true);
  // Turned off in Game settings: a hit goes in with one tap again.
  await p.goto(base + '#/g/' + id);
  await p.click('[data-a=menu]');
  await p.click('[data-y=settings]');
  await p.uncheck('.sheet [data-g=spray]');
  await p.click('.sheet [data-close]');
  await p.click('[data-r="1B"]');
  assert.equal(await p.locator('.sheet .pick').count(), 0);
  assert.match(await tickerOf(p), /^Batter 4 singles\./);
  assert.equal((await stored(p, id)).spray, false);
  await p.context().close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
