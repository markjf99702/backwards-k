// Backwards K: keep score at a baseball or softball game. This file picks the screen from the address.
//   #/          your games
//   #/new       start a game
//   #/g/ID      a game
//   #/sample    the sample game
//   #s=...      a game someone shared (the whole game is packed into the link)
import { store } from './store.js';
import { showHome } from './home.js';
import { showSetup } from './setup.js';
import { showGame, leaveGame } from './game.js';
import { unpack } from './share.js';
import { sampleGame } from './sample.js';
import { cleanGame, uid } from './model.js';
import { closeSheet, toast, go, routes, whyNot } from './ui.js';
import { drive } from './sync.js';

const app = document.getElementById('app');
let screen = '', loaded = false;

async function route(to) {
  const h = typeof to === 'string' ? to : location.hash;
  routes.shown(h);
  closeSheet();
  if (screen === 'game') leaveGame();
  const fresh = () => { const el = document.createElement('div'); app.replaceChildren(el); return el; };
  document.body.dataset.screen = '';
  window.scrollTo(0, 0);
  // Moving to another screen (not opening the page) takes the keyboard to the new screen's heading, so a screen
  // reader says where it is; the address bar's title says it too (a game's keeps the score: see game.js).
  const first = !loaded;
  loaded = true;
  const land = () => {
    const h = app.querySelector('h1');
    if (first || !h || document.getElementById('toast').contains(document.activeElement)) return;
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
  };

  if (h.startsWith('#s=')) {
    let g = null;
    try { g = cleanGame(await unpack(h.slice(3))); } catch { g = null; }
    if (!g) { toast('That link didn’t come through whole. Ask for it again.'); go('#/', { replace: true }); return; }
    open(fresh(), 'game', g, { shared: true, onSave: () => keep(g) });
    return land();
  }
  const m = /^#\/g\/([\w-]+)/.exec(h);
  if (m) {
    const g = store.get(m[1]);
    if (!g) { toast('That game isn’t on this device.'); go('#/', { replace: true }); return; }
    open(fresh(), 'game', g);
    return land();
  }
  if (h === '#/sample') {
    const g = sampleGame(7);
    open(fresh(), 'game', g, { shared: true, note: 'The sample game: nine innings, scored the whole way through. Tap any box on the card.', onSave: () => keepSample(g) });
    return land();
  }
  if (h === '#/new') { screen = 'setup'; document.title = 'New game · Backwards K'; showSetup(fresh()); return land(); }
  screen = 'home';
  document.title = 'Backwards K';
  showHome(fresh());
  land();
}
function open(el, name, g, opts) {
  screen = name;
  document.body.dataset.screen = name;
  showGame(el, g, opts);
}
// Someone else's game (or the sample) goes into this device's games.
function keep(g) {
  const mine = store.get(g.id);
  if (mine && mine.updated >= g.updated) { go('#/g/' + g.id); toast('You already have this game.'); return; }
  const { ok } = store.add([g]);
  drive.changed();
  go('#/g/' + g.id);
  if (ok) toast('Saved to your games.'); else toast(`Couldn’t save it: ${whyNot(store.problem())}.`, { ms: 6000 });
}

// The sample goes into this device's games once; Save again opens that copy, played on or not, and leaves it be. Each
// device's copy has an id of its own (so one saved on another device, which can come here through Google Drive,
// is never overwritten by this one), starting gsample7- so a second Save finds it.
function keepSample(g) {
  const had = store.all().find(x => x.id.startsWith('gsample7-'));
  if (had) { go('#/g/' + had.id); toast('You already have the sample in your games.'); return; }
  keep({ ...g, id: 'gsample7-' + uid() });
}

window.addEventListener('hashchange', () => route());
routes.use(route);
// Links within the app only change the part after the #. Set it directly, so they work wherever the page is shown,
// including inside another page whose address isn't this one.
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const h = a.getAttribute('href');
  if (location.hash !== h) go(h); else route(h);
});
store.onChange(() => { if (screen === 'home') showHome(app.firstElementChild); });
route();

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
