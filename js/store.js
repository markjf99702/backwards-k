// Games on this device, in localStorage. Every change is saved straight away; nothing waits for Google Drive.
import { cleanDoc, cleanGame, canon } from './model.js';

export const KEY = 'backwards-k.v1';
const listeners = [];
// Why this device isn't saving: '' when the last save worked, 'full' when it's out of room, 'blocked' when the
// browser won't let the page store anything (private browsing, or site data turned off).
let problem = '';
let doc = read();

function read() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { problem = 'blocked'; return cleanDoc(null); }
  try { return cleanDoc(JSON.parse(raw || 'null')); } catch { return cleanDoc(null); }
}
function write() {
  try { localStorage.setItem(KEY, canon(doc)); problem = ''; } catch (e) { problem = isFull(e) ? 'full' : 'blocked'; }
  return !problem;
}
const isFull = e => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
const tell = why => listeners.forEach(f => { try { f(why); } catch (e) { console.error(e); } });

export const store = {
  all: () => Object.values(doc.games).sort((a, b) => b.updated - a.updated),
  get: id => doc.games[id] || null,
  // Save a game that changed. Returns false if it couldn't be stored (problem() says why); it's kept in memory anyway.
  save(g) {
    g.updated = Math.max(Date.now(), (g.updated || 0) + 1);
    doc.games[g.id] = g;
    delete doc.gone[g.id];
    const ok = write();
    tell();
    return ok;
  },
  // Returns false if that couldn't be stored.
  remove(id) {
    delete doc.games[id];
    doc.gone[id] = Date.now();
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
      delete doc.gone[g.id];
      n++;
    }
    let ok = true;
    if (n) { ok = write(); tell(); }
    return { n, ok };
  },
  problem: () => problem,
  doc: () => doc,
  // Drive (or another tab) changed what's stored: read it again. A game changed here that's newer than the stored
  // copy (the device was out of room, so it was never written) stays as it is here, rather than going back to the
  // stored copy, or seeming deleted when it was never stored at all.
  reload() {
    const was = doc;
    doc = read();
    for (const g of Object.values(was.games)) {
      const there = doc.games[g.id];
      if ((there ? there.updated : doc.gone[g.id] || 0) < g.updated) { doc.games[g.id] = g; delete doc.gone[g.id]; }
    }
    tell('reload');
  },
  // f(why) runs after every change; why is 'reload' when it came from Drive or another tab.
  onChange(f) { listeners.push(f); },
};

window.addEventListener('storage', e => { if (e.key === KEY) store.reload(); });
