// Saving to Google Drive, so games follow a person from phone to tablet to computer.
// The page keeps working from localStorage exactly as before. When someone turns this on, every game goes into its
// own small file in a "Backwards K" folder in their own Google Drive, and what their other devices saved there comes
// back, game by game: whichever copy of a game changed last wins. A deleted game's file goes to Drive's bin, marked
// with when it was deleted, so the other devices delete it too.
// Nothing about this shows away from backwards-k.junkdrawer.works.
import { cleanGame, canon } from './model.js';
import { store, KEY } from './store.js';
import { replay, teamName, halfLabel } from './engine.js';

// The junkdrawer.works OAuth client, shared by every junkdrawer.works project. Google only accepts it from the
// addresses it lists, so anywhere else (localhost, the single-file copy) nothing about Drive shows.
const ORIGINS = ['https://backwards-k.junkdrawer.works'];
const CLIENT_ID = ORIGINS.includes(location.origin) ? '897653851078-p5jrh2bto6h3bj0lc4jist3k1vsc1pj4.apps.googleusercontent.com' : '';
// drive.file, like every junkdrawer.works project: Google lets them see only the files they made.
// Ours are one folder and a file per game in it, found by their appProperties, never by name.
const SCOPE = 'https://www.googleapis.com/auth/drive.file', API = 'https://www.googleapis.com/';
const FOLDER = { name: 'Backwards K', mimeType: 'application/vnd.google-apps.folder', appProperties: { backwardsk: 'folder' } };
const GAME = { backwardsk: 'game' };
// KT is shared by every junkdrawer.works project at this address: one sign-in, good for an hour.
const KS = 'backwards-k.sync', KT = 'junkdrawer.google';

const get = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fresh = () => ({ on: false, email: '', name: '', last: 0 });

let st = { ...fresh(), ...(get(KS) || {}) }, tok = get(KT);
let status = 'off', note = '', busy = null, again = false, client = null, gisLoading = false, pushT = null, folderId = '';
// Goes up whenever saving stops (here or in another tab), so a sync already under way leaves Drive and this
// device alone instead of putting back what it read before.
let gen = 0;
const ups = [], watchers = [];

const saveSt = () => put(KS, st);
const good = t => !!(t && t.token && t.exp - 60000 > Date.now() && String(t.scope || '').includes(SCOPE));
const sameAccount = (a, b) => !!a && String(a).toLowerCase() === String(b).toLowerCase();
// A sign-in this device can use: more than a minute left, and for the Google account this device saves to.
const usable = t => good(t) && (!st.email || sameAccount(t.email, st.email));
const live = () => usable(tok) || (usable(get(KT)) && !!(tok = get(KT)));
function setStatus(s, n = '') { status = s; note = n; for (const f of [...watchers]) { try { if (f() === false) watchers.splice(watchers.indexOf(f), 1); } catch { watchers.splice(watchers.indexOf(f), 1); } } }

async function api(method, path, body, type, t = tok) {
  if (!t) throw { auth: true };
  const headers = { Authorization: 'Bearer ' + t.token };
  if (type) headers['Content-Type'] = type;
  let r;
  try { r = await fetch(API + path, { method, headers, body }); } catch { throw { net: true }; } // no connection
  if (r.status === 401) { if (get(KT)?.token === t.token) put(KT, null); if (tok?.token === t.token) tok = null; throw { auth: true }; }
  if (!r.ok) throw { http: r.status };
  return r.status === 204 ? null : r.json();
}
const q = (k, v) => encodeURIComponent(`appProperties has { key='${k}' and value='${v}' }`);

async function folder() { // the "Backwards K" folder, made the first time (or again, if it was deleted)
  if (folderId) return folderId;
  const x = await api('GET', `drive/v3/files?spaces=drive&orderBy=createdTime&pageSize=10&fields=files(id)&q=${q('backwardsk', 'folder')}%20and%20trashed%3Dfalse`);
  folderId = x?.files?.[0]?.id || (await api('POST', 'drive/v3/files?fields=id', JSON.stringify(FOLDER), 'application/json')).id;
  return folderId;
}
// Every game file, binned ones too (they say a game was deleted).
async function listGames() {
  const out = [];
  let page = '';
  do {
    const x = await api('GET', `drive/v3/files?spaces=drive&pageSize=1000&fields=${encodeURIComponent('nextPageToken,files(id,trashed,appProperties)')}&q=${q('backwardsk', 'game')}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
    out.push(...(x?.files || []));
    page = x?.nextPageToken || '';
  } while (page);
  return out.map(f => ({ id: f.id, trashed: !!f.trashed, gid: f.appProperties?.gid || '', up: +f.appProperties?.up || 0, gone: +f.appProperties?.gone || 0 })).filter(f => f.gid);
}

// What goes in a game's file: the game, and a few lines a person can read when they open it in Drive.
function fileFor(g) {
  let summary = [];
  try {
    const S = replay(g);
    summary = [`${teamName(g, 0)} ${S.R[0]}, ${teamName(g, 1)} ${S.R[1]} (${halfLabel(S)})`, `${g.date}${g.place ? ', ' + g.place : ''}`];
  } catch { /* the game itself is what matters */ }
  return {
    name: `${g.date} ${teamName(g, 0)} at ${teamName(g, 1)}.json`.replace(/[\\/:*?"<>|]+/g, '-'),
    body: JSON.stringify({ app: 'backwards-k', v: 1, summary, game: g }, null, 1),
    props: { ...GAME, gid: g.id, up: String(g.updated), gone: null },
  };
}
async function upload(g, file) {
  const f = fileFor(g), b = 'bk-' + Date.now().toString(36);
  const meta = { name: f.name, mimeType: 'application/json', appProperties: f.props };
  const multipart = m => `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(m)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${f.body}\r\n--${b}--`;
  if (file) {
    const m = file.trashed ? { ...meta, trashed: false } : meta;
    return api('PATCH', `upload/drive/v3/files/${file.id}?uploadType=multipart&fields=id`, multipart(m), `multipart/related; boundary=${b}`);
  }
  return api('POST', 'upload/drive/v3/files?uploadType=multipart&fields=id', multipart({ ...meta, parents: [await folder()] }), `multipart/related; boundary=${b}`);
}
async function download(id) {
  const raw = await api('GET', `drive/v3/files/${id}?alt=media`).catch(e => { throw e instanceof SyntaxError ? { unreadable: true } : e; });
  return raw && raw.app === 'backwards-k' ? cleanGame(raw.game) : null;
}
const bin = (file, when) => api('PATCH', `drive/v3/files/${file.id}?fields=id`, JSON.stringify({ trashed: true, appProperties: { gone: String(when) } }), 'application/json');

function account(t) {
  return api('GET', 'drive/v3/about?fields=' + encodeURIComponent('user(displayName,emailAddress)'), null, null, t)
    .then(x => ({ email: x?.user?.emailAddress || '', name: x?.user?.displayName || '' }));
}
async function learnAccount(g) {
  const t = tok, who = await account(t);
  if (!who.email) throw { http: 0 };
  if (g !== gen) return;
  st.email = who.email; st.name = who.name; saveSt();
  t.email = who.email;
  if (get(KT)?.token === t.token) put(KT, t);
}

// One sync: for every game on either side, the newest of the game here, its deletion here, its file in Drive and
// its file's deletion wins, and the other side is brought up to date.
async function run(g) {
  if (!st.email) await learnAccount(g);
  if (g !== gen) return false;
  const doc = store.doc(), files = await listGames();
  const byGid = {};
  for (const f of files) {
    const cur = byGid[f.gid];
    // Two devices that each made a file for the same game: keep the newest, bin the others.
    if (!cur) byGid[f.gid] = f;
    else {
      const [keep, drop] = (f.trashed === cur.trashed ? f.up > cur.up : !f.trashed) ? [f, cur] : [cur, f];
      byGid[f.gid] = keep;
      if (!drop.trashed) await bin(drop, Date.now());
    }
  }
  const incoming = {}, gids = new Set([...Object.keys(doc.games), ...Object.keys(doc.gone), ...Object.keys(byGid)]);
  for (const gid of gids) {
    if (g !== gen) return false;
    const L = doc.games[gid], T = doc.gone[gid] || 0, F = byGid[gid];
    const fileUp = F && !F.trashed ? F.up : 0, fileGone = F && F.trashed ? (F.gone || F.up) : 0;
    const best = Math.max(L ? L.updated : 0, T, fileUp, fileGone);
    if (L && L.updated === best) {
      if (!F || F.trashed || F.up !== L.updated) await upload(L, F);
    } else if (T && T === best) {
      if (F && !F.trashed) await bin(F, T);
    } else if (fileUp && fileUp === best) {
      const got = await download(F.id);
      if (got) incoming[gid] = got;
    } else if (fileGone && fileGone === best && L) {
      incoming[gid] = { gone: fileGone };
    }
  }
  if (g !== gen) return false;
  // Put what came from Drive into this device's games, unless something here changed meanwhile.
  let changed = false;
  if (Object.keys(incoming).length) {
    let cur;
    try { cur = JSON.parse(localStorage.getItem(KEY) || 'null') || { app: 'backwards-k', v: 1, games: {}, gone: {} }; } catch { cur = null; }
    if (cur) {
      cur.games ||= {}; cur.gone ||= {};
      for (const [gid, x] of Object.entries(incoming)) {
        const mine = cur.games[gid];
        if (x.gone) { if (mine && mine.updated <= x.gone) { delete cur.games[gid]; cur.gone[gid] = x.gone; changed = true; } }
        else if ((!mine || mine.updated < x.updated) && !((cur.gone[gid] || 0) >= x.updated)) { cur.games[gid] = x; delete cur.gone[gid]; changed = true; }
      }
      if (changed) { try { localStorage.setItem(KEY, canon(cur)); } catch { changed = false; } }
    }
  }
  st.last = Date.now(); saveSt();
  if (changed) store.reload();
  return changed;
}

function sync() {
  if (!CLIENT_ID || !st.on) return Promise.resolve(false);
  if (!live()) { setStatus('tap'); return Promise.resolve(false); }
  if (busy) { again = true; return busy; }
  setStatus('busy');
  const g = gen;
  busy = run(g).then(changed => {
    if (g !== gen) return false;
    setStatus('ok');
    if (changed) ups.forEach(f => { try { f(); } catch (e) { console.error('Backwards K: showing synced games failed', e); } });
    return changed;
  }, e => {
    if (g !== gen) return false;
    if (e?.auth) setStatus('tap');
    else if (e?.unreadable) setStatus('error', 'A file in your Backwards K folder isn’t readable, so it was left alone.');
    // No signal (a ballpark, a tunnel): nothing's wrong, the games wait here until it's back.
    else if (e?.net || !navigator.onLine) setStatus('offline');
    else { if (e && !e.http) console.error(e); folderId = ''; setStatus('error', 'Couldn’t reach Google Drive. Check the connection and try again.'); }
    return false;
  }).then(changed => {
    busy = null;
    if (again) { again = false; return sync(); }
    return changed;
  });
  return busy;
}

// ---------- signing in (Google Identity Services, in a pop-up) ----------
// Google's script is fetched ahead of time (on the home screen, or when Drive is on), so the sign-in window can open
// from the first tap. With no signal and Drive off, that's nothing to mention, until someone asks to sign in.
const NOLOAD = 'Google sign-in didn’t load. Check the connection.';
let asked = false;
function loadGis() {
  if (!CLIENT_ID || client) return;
  if (window.google?.accounts?.oauth2) { init(); return; }
  if (gisLoading) return;
  gisLoading = true;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = init;
  s.onerror = () => { gisLoading = false; s.remove(); setStatus(st.on ? 'tap' : 'off', asked || st.on ? NOLOAD : ''); };
  document.head.append(s);
}
function init() {
  if (client) return;
  client = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPE, callback: gotToken,
    error_callback: e => setStatus(st.on ? 'tap' : 'off', e?.type === 'popup_closed' ? '' : 'Google sign-in didn’t finish.'),
  });
  setStatus(status, note === NOLOAD ? '' : note); // it has loaded now
}
function gotToken(r) {
  if (!r || r.error || !google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
    setStatus(st.on ? 'tap' : 'off', 'Google Drive wasn’t allowed, so nothing was saved there. Try again and leave the Drive box ticked.');
    return;
  }
  const t = { token: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000, scope: r.scope || SCOPE, email: '' }, g = gen;
  setStatus('busy');
  // Google's window lets someone pick any account, so ask Google whose this is before using it.
  account(t).then(who => {
    if (g !== gen) return;
    if (!who.email) throw { http: 0 };
    if (st.email && !sameAccount(who.email, st.email)) {
      setStatus('error', `You signed in as ${who.email}, but this device saves to ${st.email}, so nothing went to that Drive. Sign in as ${st.email}, or stop saving on this device to change accounts.`);
      return;
    }
    tok = { ...t, email: who.email };
    put(KT, tok);
    st.on = true; if (!st.email) { st.email = who.email; st.name = who.name; } saveSt();
    sync();
  }).catch(e => {
    if (g === gen) setStatus(st.on ? 'error' : 'off', e?.auth ? 'Google sign-in didn’t finish.' : 'Couldn’t reach Google Drive. Check the connection and try again.');
  });
}
function start() {
  if (!CLIENT_ID) return;
  asked = true;
  tok = get(KT);
  if (!live()) { signIn(); return; }
  st.on = true; if (!st.email && tok.email) st.email = tok.email; saveSt();
  sync();
}
// Google only opens its window from a tap, so this has to run inside a click handler.
function signIn() {
  asked = true;
  if (!client) { loadGis(); setStatus(status, 'Google sign-in is still loading. Tap again in a second.'); return; }
  const hint = st.email || tok?.email || '';
  client.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: 'select_account' });
}
// Stop on this device. Nothing is revoked: that would sign out every junkdrawer.works project.
function stop() {
  clearTimeout(pushT);
  gen++;
  st = fresh(); saveSt(); setStatus('off');
}
function now() { if (!st.on) start(); else if (!live()) signIn(); else sync(); } // inside a tap

// ---------- the bits of page ----------
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const OFFLINE = 'No connection. Your games are saved on this device and go to Google Drive when you’re back online.';
function title() {
  return status === 'busy' ? 'Saving to Google Drive'
    : status === 'tap' ? 'Tap to sign in to Google again and save'
      : status === 'error' ? note + ' Tap to try again.'
        : status === 'offline' ? OFFLINE
          : 'Saved to Google Drive' + (st.last ? ' ' + ago(st.last) : '') + '. Tap to sync now.';
}
const CLOUD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18.5h10.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.7 9.1 4.7 4.7 0 0 0 7 18.5z"/></svg>';

// The header button: a cloud with a dot, green when saved, amber while saving, red when it needs a tap, grey when
// there's no connection.
function chip(btn) {
  if (!btn) return;
  if (!CLIENT_ID) { btn.hidden = true; return; }
  btn.innerHTML = CLOUD + '<i class="dot"></i>';
  btn.addEventListener('click', now);
  watch(() => {
    if (!btn.isConnected) return false;
    btn.hidden = !st.on;
    btn.dataset.s = status;
    btn.title = title();
    btn.setAttribute('aria-label', title());
  });
}

// The card on the home screen: turn it on, see where it's saving, sync now, or stop.
function card(host) {
  if (!host) return;
  if (!CLIENT_ID) { host.hidden = true; return; }
  loadGis();
  host.hidden = false;
  let armed = false;
  const line = () => status === 'busy' ? 'Saving now.'
    : status === 'tap' ? 'Google signs you out after an hour. Tap <b>Sync now</b> to sign back in; your games are safe here meanwhile.'
      : status === 'error' ? esc(note)
        : status === 'offline' ? OFFLINE
          : st.last ? `Last saved ${ago(st.last)}.` : '';
  function draw() {
    if (!host.isConnected) return false;
    host.innerHTML = st.on
      ? `<h2>Saved to Google Drive</h2>
        <p>Your games are saved to <b>${esc(st.email || 'your Google Drive')}</b>, one file per game in a folder called “Backwards K”, and show up on every device where you turn this on. ${line()}</p>
        <div class="row"><button class="btn" type="button" data-a="now"${status === 'busy' ? ' disabled' : ''}>Sync now</button>
        <button class="btn quiet" type="button" data-a="off">${armed ? 'Tap again to stop' : 'Stop saving on this device'}</button></div>`
      : `<h2>Save across devices</h2>
        <p>Keep your games in your own Google Drive and they’ll be on every phone, tablet and computer where you turn this on. Each game is its own file in a “Backwards K” folder, and the junkdrawer.works projects can’t see anything else in your Drive. <a href="https://junkdrawer.works/privacy.html">Privacy</a></p>
        ${note ? `<p class="err">${esc(note)}</p>` : ''}
        <div class="row"><button class="btn primary" type="button" data-a="on">Save to Google Drive</button></div>`;
    host.querySelectorAll('button[data-a]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'on') start();
      else if (a === 'now') now();
      else if (!armed) { armed = true; draw(); }
      else { armed = false; stop(); }
    }));
  }
  watch(draw);
}
function watch(f) { watchers.push(f); f(); }

// The page saved something: send it along shortly. (During a game that's every few taps, so wait for a pause.)
function changed() {
  if (!CLIENT_ID || !st.on) return;
  clearTimeout(pushT);
  if (live()) pushT = setTimeout(sync, 2500); else setStatus('tap');
}

export const drive = {
  ready: !!CLIENT_ID,
  isOn: () => !!CLIENT_ID && st.on,
  chip, card, changed, now, stop,
  onUpdate(f) { ups.push(f); },
};

if (CLIENT_ID) {
  if (st.on) {
    loadGis();
    status = live() ? 'ok' : 'tap';
    if (live()) setTimeout(sync, 0);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (pushT && st.on && live()) { clearTimeout(pushT); pushT = null; sync(); } } // leaving: save now
    else if (st.on && live() && Date.now() - st.last > 30000) sync();
  });
  setInterval(() => { if (!document.hidden && st.on) { if (live()) sync(); else setStatus('tap'); } }, 5 * 60000);
  // The signal came back: fetch Google's script if it didn't load, and send what was saved here meanwhile.
  window.addEventListener('online', () => { if (!client) loadGis(); if (st.on) { if (live()) sync(); else setStatus('tap'); } });
  window.addEventListener('storage', e => {
    if (e.key === KS || e.key === KT) {
      st = { ...fresh(), ...(get(KS) || {}) };
      const t = get(KT);
      if (usable(t)) tok = t;
      else if (!t && e.key === KT && tok && (e.oldValue || '').includes(tok.token)) tok = null;
      if (!st.on) gen++;
      setStatus(st.on ? (busy ? 'busy' : live() ? 'ok' : 'tap') : 'off');
      if (st.on) loadGis();
    }
  });
}
