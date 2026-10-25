// Games on this device, in localStorage. Every change is saved as soon as the screen has been drawn (see writeSoon());
// nothing waits for Google Drive.
import { cleanDoc, cleanGame } from './model.js';

export const KEY = 'backwards-k.v1';
const listeners = [];
// Why this device isn't saving: '' when the last save worked, 'full' when it's out of room, 'blocked' when the
// browser won't let the page store anything (private browsing, or site data turned off).
let problem = '';

// What's stored, tidied (an empty store when there's nothing, or nothing that can be read).
function read() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { problem = 'blocked'; return cleanDoc(null); }
  try { return cleanDoc(JSON.parse(raw || 'null')); } catch { unreadable = raw; aside(); return cleanDoc(null); }
}
// What was stored but can't be read (damaged, say) isn't written over: it's put aside first, under a name of its own
// (backwards-k.v1.unreadable-<when>), where it can still be got at. Until that works, nothing is written.
function aside() {
  if (unreadable == null) return true;
  try { localStorage.setItem(`${KEY}.unreadable-${Date.now()}`, unreadable); unreadable = null; return true; } catch (e) { problem = isFull(e) ? 'full' : 'blocked'; return false; }
}
function write() {
  if (!aside()) return false;
  try { localStorage.setItem(KEY, text()); problem = ''; } catch (e) { problem = isFull(e) ? 'full' : 'blocked'; }
  return !problem;
}
// Each game's JSON as it was last saved, so saving one game doesn't write out every other game again (with hundreds
// saved, that was most of a tap). A game's is made again when it's saved, added or read again from storage.
const json = new Map();
// Everything, as JSON: the same as JSON.stringify(doc), from the games' saved JSON.
function text() {
  const games = Object.entries(doc.games).map(([id, g]) => {
    if (!json.has(id)) json.set(id, JSON.stringify(g));
    return `${JSON.stringify(id)}:${json.get(id)}`;
  });
  return `{"app":${JSON.stringify(doc.app)},"v":${JSON.stringify(doc.v)},"games":{${games.join(',')}},"gone":${JSON.stringify(doc.gone)}}`;
}
// A save is written just after the screen is drawn (the next frame, and a moment after), so a tap shows straight away
// and the write comes after; several saves in one frame are one write. Leaving the page, or putting the phone away,
// writes anything still waiting, and so does a save while the page can't be seen (it has no frames).
let due = false, leaving = false;
function writeSoon() {
  if (due) return;
  due = true;
  if (leaving || typeof requestAnimationFrame !== 'function' || document.hidden) flush();
  else requestAnimationFrame(() => setTimeout(flush, 0));
}
// Writes a save that's waiting, now. When that changes whether this device can save, listeners hear 'saved'.
function flush() {
  if (!due) return;
  due = false;
  const was = problem;
  write();
  if (problem !== was) tell('saved');
}
const isFull = e => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
const tell = why => listeners.forEach(f => { try { f(why); } catch (e) { console.error(e); } });

// What's stored, read when the page opens; and what couldn't be read, until it's put aside (see aside()).
let unreadable = null, doc = read();

export const store = {
  all: () => Object.values(doc.games).sort((a, b) => b.updated - a.updated),
  get: id => doc.games[id] || null,
  // Save a game that changed: it's written just after the screen is drawn (see writeSoon()). If it can't be stored,
  // problem() says why (and listeners hear 'saved'); it's kept in memory anyway.
  save(g) {
    g.updated = Math.max(Date.now(), (g.updated || 0) + 1);
    doc.games[g.id] = g;
    json.delete(g.id);
    delete doc.gone[g.id];
    writeSoon();
    tell();
  },
  // Written straight away. Returns false if that couldn't be stored.
  remove(id) {
    delete doc.games[id];
    json.delete(id);
    doc.gone[id] = Date.now();
    due = false;
    const ok = write();
    tell();
    return ok;
  },
  // Games from a backup file or a shared link: a game this device already has is kept unless the other copy is newer.
  // Returns how many were added, and ok: false if they couldn't be stored.
  add(games) {
    let n = 0;
    for (const raw of games) {
      const g = cleanGame(raw);
      if (!g) continue;
      const mine = doc.games[g.id];
      if (mine && mine.updated >= g.updated) continue;
      doc.games[g.id] = g;
      json.delete(g.id);
      delete doc.gone[g.id];
      n++;
    }
    let ok = true;
    if (n) { due = false; ok = write(); tell(); }
    return { n, ok };
  },
  flush,
  problem: () => problem,
  doc: () => doc,
  // Drive (or another tab) changed what's stored: read it again. A game changed here that's newer than the stored
  // copy (the device was out of room, so it was never written) stays as it is here, rather than going back to the
  // stored copy, or seeming deleted when it was never stored at all.
  reload() {
    const was = doc;
    doc = read();
    json.clear();
    for (const g of Object.values(was.games)) {
      const there = doc.games[g.id];
      if ((there ? there.updated : doc.gone[g.id] || 0) < g.updated) { doc.games[g.id] = g; delete doc.gone[g.id]; }
    }
    tell('reload');
  },
  // f(why) runs after every change; why is 'reload' when it came from Drive or another tab, and 'saved' when a save
  // written after the screen was drawn changed whether this device can save.
  onChange(f) { listeners.push(f); },
};

window.addEventListener('storage', e => { if (e.key === KEY) store.reload(); });
window.addEventListener('pagehide', () => { leaving = true; flush(); });
window.addEventListener('pageshow', () => { leaving = false; });
globalThis.document?.addEventListener?.('visibilitychange', () => { if (document.hidden) flush(); });
