// Offline support: keep a copy of the app so it works at a ballpark with no signal.
// Games live in localStorage (and Google Drive, if it's on), not here.
// Network first, so a new version shows up as soon as you're online, but not for long: see answer(). Each page load
// gets one version of the app, the network's or the copy's, never some files from each: one version's file can ask
// another's for something it doesn't have, and the page stays blank.

const CACHE = 'backwards-k-v3'; // bump the number when the file list changes
const SHELL = [
  './', 'index.html', 'icon.svg', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png',
  'css/app.css', 'fonts/source-sans-3.woff2', 'fonts/big-shoulders.woff2', 'fonts/patrick-hand.woff2',
  'js/app.js', 'js/box.js', 'js/card.js', 'js/engine.js', 'js/field.js', 'js/game.js', 'js/help.js', 'js/home.js',
  'js/model.js', 'js/sample.js', 'js/setup.js', 'js/share.js', 'js/store.js', 'js/sync.js', 'js/ui.js',
];
// The copy is kept in sets: each a whole version of the app, fetched together, in a cache of its own called
// CACHE-<when it was made>. A set counts once every file is in it and DONE has been put in after them. The newest is
// the copy; the one before it stays too, for a page still loading from it.
const DONE = 'kept-set-done';

self.addEventListener('install', e => {
  e.waitUntil(fill().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(tidy().then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(answer(e));
});

// ---------- the sets ----------
const made = k => +k.slice(CACHE.length + 1) || 0;
let filling = null, newest = null;
// A new set: every file, from the network. It's written all at once, and only if every file came, so the copy
// is always one whole version; until then, the set before it is the copy.
function fill() {
  if (filling) return filling.done;
  const name = `${CACHE}-${Date.now()}`;
  const done = caches.open(name)
    .then(c => c.addAll(SHELL.map(f => new Request(f, { cache: 'no-cache' }))).then(() => c.put(DONE, new Response(''))))
    .then(() => { newest = Promise.resolve(name); return tidy(); }, err => caches.delete(name).then(() => { throw err; }))
    .finally(() => { filling = null; });
  filling = { name, done };
  return done;
}
// The whole sets, newest first.
async function whole() {
  const mine = (await caches.keys()).filter(k => k.startsWith(CACHE + '-')).sort((a, b) => made(b) - made(a));
  const out = [];
  for (const k of mine) if (await caches.match(DONE, { cacheName: k })) out.push(k);
  return out;
}
// The copy: the newest whole set ('' while there's none).
const current = () => (newest ||= whole().then(w => w[0] || ''));
// Everything but the newest two whole sets goes: copies kept before there were sets, or for an older list of files,
// and sets that never got all their files. A set being filled stays, and so does one a page loaded from lately.
async function tidy() {
  const keep = new Set((await whole()).slice(0, 2));
  if (filling) keep.add(filling.name);
  for (const l of loads.values()) if (Date.now() - l.at < 600000) keep.add(l.set);
  const old = (await caches.keys()).filter(k => k.startsWith('backwards-k-') && !keep.has(k));
  await Promise.all(old.map(k => caches.delete(k)));
}
// A file from one set (the page itself, for any address of the page), or nothing.
async function from(set, request) {
  if (!set) return undefined;
  const r = await caches.match(request, { cacheName: set, ignoreSearch: true })
    || (request.mode === 'navigate' ? await caches.match('index.html', { cacheName: set }) : undefined);
  return r && askAgainNextTime(r);
}
// Whether two answers hold the same file.
async function same(a, b) {
  const [x, y] = (await Promise.all([a.arrayBuffer(), b.arrayBuffer()])).map(z => new Uint8Array(z));
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// ---------- answering ----------
// One bar of signal at the ballpark is worse than none: a request goes out and nothing comes back for a long time,
// and the page asks for its files a few at a time, each waiting on the last (the page, app.js, what it imports, and
// what those import). So the network gets WAIT ms, and then the copy answers, and for SLOW ms after that the copy
// answers every page load straight away.
// Which version a page load gets is settled as it goes. While what the network sends is the same as the copy, either
// can answer, and the first file the network is too slow for comes from the copy, and so does the rest of the load.
// Once the network sends a file that's new, the rest of the load comes from the network too, however long that takes;
// if it takes more than WAIT, that file fails rather than mix the versions, and the page reloads itself (see the
// script in index.html), from the copy this time. A new file also has a new set fetched, for next time.
// Fonts and pictures can't break the page whichever version they're from, so each of those goes on its own.
const WAIT = 3000, SLOW = 30000;
let weakUntil = 0, lastNav = null;
const loads = new Map();
async function answer(e) {
  const { request } = e;
  const loose = ['font', 'image', 'manifest'].includes(request.destination);
  const load = await loadFor(e);
  const kept = () => from(load.set, request);
  if (load.mode === 'kept') {
    const r = await kept();
    if (r) return r;
  }
  // What the network sends, and the copy of the same file if they're different. It's compared with the copy only
  // while the load could still go either way.
  const got = fresh(request).then(async res => {
    const k = res.ok && !loose && load.mode !== 'net' ? await kept() : undefined;
    return { res, newer: k && !(await same(res.clone(), k.clone())) ? k : undefined };
  });
  e.waitUntil(got.then(x => x.newer && fill()).catch(() => {}));
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(resolve, WAIT, { late: true }); });
  const first = await Promise.race([got.catch(() => ({ failed: true })), late]);
  clearTimeout(timer);
  if (first.res) {
    if (!first.newer || loose || load.mode === 'net') return first.res;
    if (load.mode === 'kept') return first.newer; // the copy answered another file of this load meanwhile
    load.mode = 'net';
    return first.res;
  }
  if (first.late) weakUntil = Date.now() + SLOW;
  if (load.mode === 'net' && !loose) return Response.error();
  const r = await kept();
  if (r) { if (!loose) load.mode = 'kept'; return r; }
  return got.then(x => x.res, () => Response.error()); // nothing kept for this one: wait for the network after all
}
// A page load's set, and its mode: '' while the network and the copy agree, 'net' once the network has sent something
// new, 'kept' once the copy has answered. It's found by the page asking (a page load is its first request).
async function loadFor(e) {
  const now = Date.now();
  if (e.request.mode === 'navigate') {
    for (const [k, l] of loads) if (now - l.at > 3600000) loads.delete(k);
    const l = { set: await current(), mode: now < weakUntil ? 'kept' : '', at: now };
    if (e.resultingClientId) loads.set(e.resultingClientId, l);
    lastNav = e.resultingClientId ? null : l;
    return l;
  }
  let l = e.clientId && loads.get(e.clientId);
  // (A browser that doesn't say which page a page load is for: its files are for the latest one.)
  if (!l && lastNav && now - lastNav.at < 60000) l = lastNav;
  if (!l) l = { set: await current(), mode: '', at: now };
  if (e.clientId) loads.set(e.clientId, l);
  return l;
}

// GitHub Pages lets browsers keep files for ten minutes, so without this an update can take that long to show up.
// Ask the server every time instead; a file that hasn't changed comes back as a quick "not modified".
function fresh(request) {
  const got = request.mode === 'navigate'
    // A page load can't be answered with a redirected response, so fall back to the plain request if there was one.
    ? fetch(request.url, { cache: 'no-cache' }).then(res => (res.redirected ? fetch(request) : res))
    : fetch(request, { cache: 'no-cache' });
  return got.then(askAgainNextTime);
}

// The open tab keeps its own copy of each file too, and would reuse it on a reload without asking.
// Marking the copy it gets from here no-cache sends that reload back through fresh() as well.
function askAgainNextTime(res) {
  if (res.status !== 200 || res.type !== 'basic' || res.redirected) return res;
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-cache');
  headers.delete('content-encoding'); // the body here is already unpacked
  headers.delete('content-length');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
