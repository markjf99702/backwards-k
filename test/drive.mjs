// Google Drive saving, with two devices sharing one pretend Drive:  node test/drive.mjs  (needs Playwright)
// Nothing here talks to Google: test/fake-google.mjs stands in for sign-in and the Drive API.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fakeGoogle } from './fake-google.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const origin = base.slice(0, -1);

const google = fakeGoogle();
const browser = await pw.chromium.launch();
const problems = [];
// A device: its own browser storage, the shared pretend Drive, and Drive allowed at localhost.
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await google.install(ctx, { rewrite: { '**/js/sync.js': s => s.replace("['https://backwards-k.junkdrawer.works']", `['${origin}']`) } });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`${name}: ${m.text()}`); });
  await page.goto(base);
  return page;
}
const settle = page => page.waitForFunction(() => { const c = document.querySelector('.cloud'); return c && !c.hidden && c.dataset.s === 'ok'; }, null, { timeout: 8000 });
const syncNow = async page => { await page.click('.cloud'); await page.waitForTimeout(100); await settle(page); };
const games = page => page.evaluate(() => [...document.querySelectorAll('.gi-teams')].map(g => [...g.children].map(s => s.textContent.replace(/\s+/g, ' ').trim()).join(' ')).sort());
const gameFiles = () => google.files().filter(f => f.appProperties?.backwardsk === 'game');
const step = name => console.log('·', name);

async function newGame(page, away, home) {
  await page.goto(base + '#/new');
  await page.fill('[data-side="0"] [data-name]', away);
  await page.fill('[data-side="1"] [data-name]', home);
  await page.click('[data-go]');
  await page.waitForSelector('.live .field');
}

step('turning it on: a folder, and a file for the game');
const a = await device('phone');
await newGame(a, 'Foxes', 'Comets');
await a.click('[data-r="HR"]');
await a.goto(base);
await a.click('.drive-card [data-a=on]');
await settle(a);
assert.equal(google.files().filter(f => f.appProperties?.backwardsk === 'folder').length, 1);
assert.equal(gameFiles().length, 1);
const file = gameFiles()[0], saved = JSON.parse(file.body);
assert.equal(saved.app, 'backwards-k');
assert.equal(saved.summary[0], 'Foxes 1, Comets 0 (Top 1st)');
assert.equal(file.name.endsWith('Foxes at Comets.json'), true, file.name);
assert.equal(file.appProperties.gid, saved.game.id);
assert.equal(file.appProperties.up, String(saved.game.updated));
assert.match(await a.textContent('.drive-card'), /mark@gmail\.com/);

step('a second device joins and gets the game; its own game goes up too');
const b = await device('tablet');
await newGame(b, 'Owls', 'Bears');
await b.goto(base);
await b.click('.drive-card [data-a=on]');
await settle(b);
assert.deepEqual(await games(b), ['Foxes 1 Comets 0', 'Owls at Bears']);
assert.equal(gameFiles().length, 2);
await syncNow(a);
assert.deepEqual(await games(a), ['Foxes 1 Comets 0', 'Owls at Bears']);

step('scoring on one device shows up on the other');
await b.click('.gi >> nth=1');
await b.waitForSelector('.live .field');
assert.match(await b.textContent('.bar .title'), /Foxes/);
await b.click('[data-r="2B"]');
await b.click('[data-r="1B"]');
await b.click('[data-x=save]');
await syncNow(b);
await syncNow(a);
assert.deepEqual(await games(a), ['Foxes 1 Comets 0', 'Owls at Bears']);
assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('backwards-k.v1')).games[Object.keys(JSON.parse(localStorage.getItem('backwards-k.v1')).games).find(k => JSON.parse(localStorage.getItem('backwards-k.v1')).games[k].teams[0].name === 'Foxes')].ev.length), 3);

step('the page showing the game picks up the change');
await a.click('.gi >> text=Foxes');
await a.waitForSelector('.live .field');
await b.click('[data-r="K"]');
await syncNow(b);
await syncNow(a);
assert.match(await a.textContent('.ticker p'), /strikes out swinging/);

step('no connection: the cloud goes quiet, and what was scored goes up when it’s back');
const noSignal = r => r.abort('internetdisconnected');
await b.context().route('https://www.googleapis.com/**', noSignal);
await b.click('[data-r="BB"]');
await b.click('.cloud');
await b.waitForFunction(() => document.querySelector('.cloud')?.dataset.s === 'offline', null, { timeout: 8000 });
assert.match(await b.getAttribute('.cloud', 'title'), /^No connection\. Your games are saved on this device/);
await b.context().unroute('https://www.googleapis.com/**', noSignal);
await b.evaluate(() => window.dispatchEvent(new Event('online')));
await settle(b);
const foxes = () => JSON.parse(gameFiles().find(f => JSON.parse(f.body).game.teams[0].name === 'Foxes').body).game;
assert.equal(foxes().ev.at(-1).r, 'BB');

step('deleting on one device deletes on the other, and bins the file');
await a.goto(base);
await settle(a);
await a.click('.gi >> text=Owls'); // the other device has that game open
await a.waitForSelector('.live .field');
await b.goto(base);
await b.click('.gi >> text=Owls');
await b.click('[data-a=menu]');
await b.click('[data-y=delete]');
await b.click('[data-y=delete]');
await b.waitForSelector('.hero');
await syncNow(b);
const owls = gameFiles().find(f => JSON.parse(f.body).game.teams[0].name === 'Owls');
assert.equal(owls.trashed, true);
assert.ok(+owls.appProperties.gone > 0);
await syncNow(a);
assert.match(await a.textContent('#toast'), /This game was deleted on another device/);
await a.goto(base);
assert.deepEqual(await games(a), ['Foxes 1 Comets 0']);

// Both devices with no signal while they each change the same game, then back one after the other.
const fox = foxes().id, apart = async () => { for (const p of [a, b]) await p.context().route('https://www.googleapis.com/**', noSignal); };
const back = async p => { await p.context().unroute('https://www.googleapis.com/**', noSignal); await syncNow(p); };
const stored = async (p, pick = g => g.id === fox) => (await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('backwards-k.v1')).games))).filter(pick);
const open = async p => { await p.goto(base + '#/g/' + fox); await p.waitForSelector('.live .field'); };
const rename = async (p, side, name) => {
  await p.click('[data-a=menu]');
  await p.click('[data-y=settings]');
  await p.fill(`[data-t="${side}"]`, name);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600); // the name is saved after a pause in the typing
};

step('scored on with no signal while the other device, with the copy from before, renamed a team: every play stays, and the new name');
await open(a);
await open(b);
const plays = (await stored(a))[0].ev.length;
await apart();
for (const k of ['b', 'b', 's']) await a.click(`[data-p="${k}"]`);
await rename(b, 0, 'Red Foxes');
await back(b);
await back(a);
await syncNow(b);
for (const p of [a, b]) {
  const [g] = await stored(p);
  assert.deepEqual([g.ev.length, g.teams[0].name], [plays + 3, 'Red Foxes']);
}
assert.equal(JSON.parse(gameFiles().find(f => f.appProperties.gid === fox).body).game.ev.length, plays + 3);

step('scored differently on two devices with no signal: both are kept, and the device that finds it says so');
await apart();
await a.click('[data-p="b"]');
await b.click('[data-p="s"]');
await back(a);
await back(b);
assert.equal(await b.textContent('#toast'), 'Red Foxes at Comets was scored on another device too, with plays this one didn’t have, so both are kept. The one scored here is marked (second copy).');
await syncNow(a);
for (const p of [a, b]) {
  const both = (await stored(p, g => g.teams[0].name === 'Red Foxes')).sort((x, y) => x.place.length - y.place.length);
  assert.deepEqual(both.map(g => [g.place, g.ev.at(-1).k]), [['', 'b'], ['(second copy)', 's']]);
  assert.equal(both[0].id, fox);
}
assert.equal(gameFiles().filter(f => !f.trashed).length, 2);

step('a play taken back on one device while the other renamed a team: the play stays taken back, and the name stays');
await open(b);
const had = (await stored(a))[0].ev.length;
await apart();
await a.click('[data-a=undo]');
await rename(b, 1, 'Comets II');
await back(a);
await back(b);
await syncNow(a);
for (const p of [a, b]) {
  const [g] = await stored(p);
  assert.deepEqual([g.ev.length, g.teams[1].name], [had - 1, 'Comets II']);
}
await a.goto(base);

step('a sign-in that ran out: the cloud asks for a tap, and one tap fixes it');
await a.evaluate(() => { const t = JSON.parse(localStorage.getItem('junkdrawer.google')); t.token = 'tok-expired'; localStorage.setItem('junkdrawer.google', JSON.stringify(t)); });
await a.reload();
await a.waitForFunction(() => document.querySelector('.cloud')?.dataset.s === 'tap', null, { timeout: 8000 });
await a.click('.cloud');
await settle(a);

step('stopping on a device leaves the shared sign-in alone and stops the calls');
await a.click('.drive-card [data-a=off]');
await a.click('.drive-card [data-a=off]');
assert.equal(await a.locator('.drive-card [data-a=on]').count(), 1);
assert.ok(await a.evaluate(() => localStorage.getItem('junkdrawer.google')), 'the sign-in is still there for the other projects');
assert.equal(await a.evaluate(() => window.__revoked || 0), 0, 'nothing revoked');
await b.context().close(); // the other device keeps syncing, as it should
const n = google.calls.length;
await newGame(a, 'Larks', 'Wrens');
await a.waitForTimeout(3000);
assert.equal(google.calls.length, n, 'no Drive calls after stopping: ' + google.calls.slice(n).join(', '));

step('no signal and Drive off: the home says nothing about Google until someone asks');
{
  const GIS = 'https://accounts.google.com/gsi/client';
  // A phone with Google's script blocked, as with no signal.
  const offPhone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await google.install(ctx, { rewrite: { '**/js/sync.js': s => s.replace("['https://backwards-k.junkdrawer.works']", `['${origin}']`) } });
    await ctx.route(GIS, noSignal); // (the route added last is the one used)
    const p = await ctx.newPage();
    p.on('pageerror', e => problems.push(`no signal: ${e.message}`));
    const gone = p.waitForEvent('requestfailed', r => r.url() === GIS);
    await p.goto(base);
    await gone;
    await p.waitForTimeout(100);
    return p;
  };
  const p = await offPhone();
  assert.equal(await p.locator('.drive-card .err').count(), 0, 'nothing said: ' + await p.textContent('.drive-card'));
  // Someone taps it: now it says why nothing happened, in red.
  const gone = p.waitForEvent('requestfailed', r => r.url() === GIS);
  await p.click('.drive-card [data-a=on]');
  await gone;
  await p.waitForFunction(() => document.querySelector('.drive-card .err')?.textContent === 'Google sign-in didn’t load. Check the connection.');
  assert.equal(await p.$eval('.drive-card .err', el => getComputedStyle(el).color), 'rgb(192, 57, 43)');
  // With a signal again, the home screen shown again loads Google's script, and the line goes.
  await p.context().unroute(GIS, noSignal);
  await p.goto(base + '#/new');
  await p.goto(base);
  await p.waitForFunction(() => window.__cfg);
  assert.equal(await p.locator('.drive-card .err').count(), 0, 'gone: ' + await p.textContent('.drive-card'));
  await p.context().close();

  step('and when the signal comes back, Google’s script loads, so the first tap signs in');
  const q = await offPhone();
  await q.context().unroute(GIS, noSignal);
  await q.evaluate(() => window.dispatchEvent(new Event('online')));
  await q.waitForFunction(() => window.__cfg);
  await q.click('.drive-card [data-a=on]');
  await q.waitForFunction(() => document.querySelector('.drive-card h2')?.textContent === 'Saved to Google Drive', null, { timeout: 8000 });
  await q.context().close();
}

// The expired sign-in's 401 and the dropped connection are logged by the browser itself; those are expected.
assert.deepEqual(problems.filter(p => !/status of 401|net::ERR_INTERNET_DISCONNECTED/.test(p)), [], 'problems while syncing');
await browser.close();
server.close();
console.log('all good');
