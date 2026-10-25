// The sw.js phones had before it kept whole versions (from c067c3e to 138c9d3), served by test/e2e.mjs to check
// that a page it puts together from two versions reloads itself and comes back whole. Not part of the app.

// Offline support: keep a copy of the app so it works at a ballpark with no signal.
// Games live in localStorage (and Google Drive, if it's on), not here.
// Network first, so a new version shows up as soon as you're online, but not for long: see answer().

const CACHE = 'backwards-k-v2'; // bump the number when the file list changes
const SHELL = [
  './', 'index.html', 'icon.svg', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png',
  'css/app.css', 'fonts/source-sans-3.woff2', 'fonts/big-shoulders.woff2', 'fonts/patrick-hand.woff2',
  'js/app.js', 'js/box.js', 'js/card.js', 'js/engine.js', 'js/field.js', 'js/game.js', 'js/help.js', 'js/home.js',
  'js/model.js', 'js/sample.js', 'js/setup.js', 'js/share.js', 'js/store.js', 'js/sync.js', 'js/ui.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('backwards-k-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(answer(e));
});

// One bar of signal at the ballpark is worse than none: a request goes out and nothing comes back for a long time,
// and the page asks for its files a few at a time, each waiting on the last (the page, app.js, what it imports, and
// what those import). So the network gets WAIT ms, and then the copy kept here answers. For SLOW ms after that, the
// copy answers straight away (the network only for a file that isn't kept), so the rest of the page doesn't wait
// too. A late answer from the network still refreshes the copy for next time. No network at all fails at once, and
// the copy answers then too.
const WAIT = 3000, SLOW = 30000;
let slowUntil = 0;
async function answer(e) {
  const { request } = e;
  // The copy of this file (the page itself, for any address of the page), or none.
  const kept = () => caches.match(request, { ignoreSearch: true }).then(r => r || (request.mode === 'navigate' ? caches.match('index.html') : r));
  // With no network, the copy, or failing that the page.
  const offline = () => caches.match(request, { ignoreSearch: true }).then(r => r || caches.match('index.html'));
  if (Date.now() < slowUntil) {
    const r = await kept();
    if (r) return r;
  }
  let copied = Promise.resolve();
  const net = fresh(request).then(res => {
    if (res.ok) { const copy = res.clone(); copied = caches.open(CACHE).then(c => c.put(request, copy)); }
    return res;
  });
  e.waitUntil(net.then(() => copied).catch(() => {}));
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(resolve, WAIT, { late: true }); });
  const first = await Promise.race([net.then(res => ({ res }), () => ({ failed: true })), late]);
  clearTimeout(timer);
  if (first.res) return first.res;
  if (first.failed) return offline();
  const r = await kept();
  if (r) { slowUntil = Date.now() + SLOW; return r; }
  return net.catch(offline); // nothing kept for this one: keep waiting for the network
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
