// Keeps score of a game in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
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
await tap('.sheet [data-close]');
await tap('[data-p=c]');
assert.match(await ticker(), /Okafor strikes out looking/);
await tap('[data-r="K"]');
assert.match(await ticker(), /Brennan strikes out swinging/);

step('a single with a runner on: the runners sheet, then Save');
await tap('[data-r="1B"]');
await page.waitForSelector('.sheet .moves');
assert.deepEqual(await page.$$eval('.sheet .mv p', ps => ps.map(x => x.textContent)), ['Ruizwas on first', 'Castilloat bat']);
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
// Moreno's line: one batter, a home run, on one pitch, a strike (P-S 1-1).
assert.deepEqual(await page.$$eval('.pane[data-p=box] tr', trs => trs.filter(tr => /Moreno/.test(tr.querySelector('th')?.textContent)).map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent).join(' '))), ['0 1 1 0 0 1 1 1-1']);
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
const shown = p => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(''));

step('saving the sample twice keeps one copy, and the second Save says so');
{
  const p = await phone();
  for (let i = 0; i < 2; i++) {
    await p.goto(base + '#/sample');
    await p.click('[data-a=keep]');
    await p.waitForSelector('.live .field');
  }
  assert.equal(await seen(p), 'You already have the sample in your games.');
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
  assert.equal(await p.textContent('.ticker p'), 'Batter 2 singles. Speedy scores.');
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
  assert.deepEqual(await p.$$eval('.bug .bt', b => b.map(x => x.className)), ['bt', 'bt won'], 'the winner is lit on the board');
  assert.equal(await p.textContent('.bug .inn'), 'Final');
  assert.equal(await p.locator('.live [data-runner]').count(), 0);
  assert.equal(await p.textContent('.live .runner'), 'Left on third: Batter 8');
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
  assert.equal(await p.textContent('.ticker p'), 'Batter 3 hits a sacrifice fly to left (SF7). Batter 2 scores.');
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
  await p.click('.sheet [data-pos="6"]');
  assert.match(await p.textContent('.sheet .cell-big'), /E6 Error/);
  await p.keyboard.press('Escape');
  assert.match(await p.locator('.card').innerHTML(), />E6</);
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
  assert.match(await p.locator('.card').innerHTML(), />E6</);
  await p.click('.bar .undo');
  assert.equal(await seen(p), 'Took back: Batter 2 reaches on an error by the shortstop (E6).Redo');
  assert.equal(await plays(p, id), 'paK');
  await p.click('#toast button');
  assert.equal(await plays(p, id), 'paK paE');
  assert.match(await p.locator('.card').innerHTML(), />E6</);

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
  assert.match(await p.evaluate(() => navigator.clipboard.readText()), /^Owls 0, Home 0 \(Top 1st\)/);
  const free = sel => p.evaluate(sel => { const b = document.querySelector(sel), r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }, sel);
  assert.equal(await free('.sheet [data-close]'), true, 'Close isn’t under it');
  await p.click('.sheet [data-close]');
  await p.waitForFunction(() => !document.querySelector('.sheet-toast').textContent, null, { timeout: 1000 }); // it goes with the sheet
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
  await p.click('[data-r=HR]');
  await p.click('.sheet [data-x=save]');
  assert.equal(await said(), 'Batter 3 hits a home run. Batter 1 and Batter 2 score. Owls 3, Home 0. Nobody on, nobody out.');
  await p.click('.bar .undo');
  assert.equal(await said(), 'Took back: Batter 3 hits a home run. Batter 1 and Batter 2 score. Runners on second and third, nobody out, 0 balls, 1 strike.');
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
  const mineNow = () => p.evaluate(id => JSON.parse(localStorage.getItem('backwards-k.v1')).games[id], g.id);
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
  assert.deepEqual(await p.evaluate(id => JSON.parse(localStorage.getItem('backwards-k.v1')).games[id].ev.at(-1), g.id), e);
  // Reload brings the newest version there is (here, still this one).
  await Promise.all([p.waitForEvent('load'), p.click('[data-a=reload]')]);
  await p.waitForSelector('.shared-bar');
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
  assert.match(await p.textContent('.final p'), new RegExp(`The whole card is ${where}, and the box score under Box score`), `${width} wide`);
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

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
