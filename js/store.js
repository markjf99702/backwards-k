// Games on this device, in localStorage. Every change is saved straight away; nothing waits for Google Drive.
import { cleanDoc, cleanGame, canon } from './model.js';

export const KEY = 'backwards-k.v1';
const listeners = [];
let doc = read();

function read() {
  try { return cleanDoc(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return cleanDoc(null); }
}
function write() {
  try { localStorage.setItem(KEY, canon(doc)); return true; } catch { return false; }
}
const tell = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });

export const store = {
  all: () => Object.values(doc.games).sort((a, b) => b.updated - a.updated),
  get: id => doc.games[id] || null,
  // Save a game that changed. Returns false if the phone's storage is full.
  save(g) {
    g.updated = Math.max(Date.now(), (g.updated || 0) + 1);
    doc.games[g.id] = g;
    delete doc.gone[g.id];
    const ok = write();
    tell();
    return ok;
  },
  remove(id) {
    delete doc.games[id];
    doc.gone[id] = Date.now();
    write();
    tell();
  },
  // Games from a backup file or a shared link: a game this device already has is kept unless the other copy is newer.
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
    if (n) { write(); tell(); }
    return n;
  },
  doc: () => doc,
  // Drive (or another tab) changed what's stored: read it again.
  reload() { doc = read(); tell(); },
  onChange(f) { listeners.push(f); },
};

window.addEventListener('storage', e => { if (e.key === KEY) store.reload(); });
