// What a game looks like when it's saved, and how to tidy one that came from a file, a link or Google Drive.
//
// A game: { id, created, updated, date, place, innings, pitches, teams: [visitors, home], ev: [events] }
// A team: { name, lineup: [[player, sub, ...] per batting slot], pitchers: [player, ...] }
// A player: { name, num }
// Everything that happens in the game is in ev, in order (engine.js reads it).

export const APP = 'backwards-k';
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const blank = () => ({ name: '', num: '' });

export function today(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function newTeam(name = '', size = 9) {
  return { name, lineup: Array.from({ length: size }, () => [blank()]), pitchers: [blank()] };
}

export function newGame({ away = '', home = '', innings = 9, size = 9, pitches = true, date = today(), place = '' } = {}) {
  const t = Date.now();
  return { id: 'g' + uid(), created: t, updated: t, date, place, innings, pitches, teams: [newTeam(away, size), newTeam(home, size)], ev: [] };
}

const str = (v, max = 60) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');
const int = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
const cleanPlayer = p => ({ name: str(p && p.name), num: str(p && p.num, 4) });
const cleanList = (a, f) => (Array.isArray(a) ? a.map(f) : []);
const BASE = new Set([0, 1, 2, 3, 4]);
const cleanMoves = m => cleanList(m, x => (Array.isArray(x) ? x : []))
  .filter(x => BASE.has(x[0]) && BASE.has(x[1]))
  .map(x => {
    const out = [x[0], x[1]];
    if (typeof x[2] === 'string') out.push(x[2].slice(0, 4));
    if (Array.isArray(x[3])) { if (out.length < 3) out.push(''); out.push(fielders(x[3])); }
    return out;
  });
const fielders = f => (Array.isArray(f) ? f.map(n => int(n, 1, 9, 1)).slice(0, 6) : undefined);

function cleanEvent(e) {
  if (!e || typeof e !== 'object') return null;
  switch (e.t) {
    case 'p': return ['b', 'c', 's', 'f'].includes(e.k) ? { t: 'p', k: e.k } : null;
    case 'pa': {
      if (typeof e.r !== 'string') return null;
      const o = { t: 'pa', r: e.r.slice(0, 4) };
      if (Array.isArray(e.f) && e.f.length) o.f = fielders(e.f);
      if (Array.isArray(e.m)) o.m = cleanMoves(e.m);
      if (e.x) o.x = 1;
      return o;
    }
    case 'r': return { t: 'r', m: cleanMoves(e.m) };
    case 'sub': return { t: 'sub', s: int(e.s, 0, 1, 0), slot: int(e.slot, 0, 40, 0), i: int(e.i, 0, 40, 0), ty: ['ph', 'pr', 'def'].includes(e.ty) ? e.ty : 'def' };
    case 'pch': return { t: 'pch', s: int(e.s, 0, 1, 0), i: int(e.i, 0, 40, 0) };
    case 'add': return { t: 'add', s: int(e.s, 0, 1, 0) };
    case 'eoh': case 'end': case 'on': return { t: e.t };
    default: return null;
  }
}

function cleanTeam(t, side) {
  t = t && typeof t === 'object' ? t : {};
  let lineup = cleanList(t.lineup, s => cleanList(Array.isArray(s) ? s : [s], cleanPlayer)).filter(s => s.length).slice(0, 40);
  if (!lineup.length) lineup = newTeam('', 9).lineup;
  let pitchers = cleanList(t.pitchers, cleanPlayer).slice(0, 40);
  if (!pitchers.length) pitchers = [blank()];
  return { name: str(t.name) || '', lineup, pitchers, side };
}

// A game from anywhere outside this device, made safe to use. Returns null if it isn't a game at all.
export function cleanGame(g) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.teams)) return null;
  const t = Date.now();
  const teams = [cleanTeam(g.teams[0], 0), cleanTeam(g.teams[1], 1)].map(({ side, ...rest }) => rest);
  const ev = cleanList(g.ev, cleanEvent).filter(Boolean);
  // Substitutions point at players by position in a slot; drop any that point past the end.
  const ok = ev.filter(e => (e.t === 'sub' ? !!teams[e.s].lineup[e.slot] && e.i < teams[e.s].lineup[e.slot].length
    : e.t === 'pch' ? e.i < teams[e.s].pitchers.length : true));
  return {
    id: typeof g.id === 'string' && /^g[\w-]{4,40}$/.test(g.id) ? g.id : 'g' + uid(),
    created: int(g.created, 0, 9e15, t), updated: int(g.updated, 0, 9e15, t),
    date: /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : today(),
    place: str(g.place, 80), innings: int(g.innings, 1, 12, 9), pitches: g.pitches !== false,
    teams, ev: ok,
  };
}

// Everything on this device: { app, v, games: { id: game }, gone: { id: when it was deleted } }.
export function cleanDoc(d) {
  const out = { app: APP, v: 1, games: {}, gone: {} };
  if (!d || typeof d !== 'object') return out;
  for (const g of Object.values(d.games || {})) { const c = cleanGame(g); if (c) out.games[c.id] = c; }
  const old = Date.now() - 400 * 864e5;
  for (const [id, t] of Object.entries(d.gone || {})) if (+t > old && !out.games[id]) out.gone[id] = +t;
  return out;
}

// The same thing written the same way every time, to tell whether anything changed.
export const canon = d => JSON.stringify(d);

// A pasted lineup, one player per line: "Ruiz", "12 Ruiz", "Ruiz #12", or a lineup copied from a game preview,
// "1. Shohei Ohtani DH" or "1 Mookie Betts (R) SS". When the lines are numbered 1, 2, 3 in order, those numbers are
// places in the batting order, not jersey numbers, and lines without one (a team name, a heading) are left out.
const POSITION = /[\s,]+(P|SP|RP|C|1B|2B|3B|SS|LF|CF|RF|DH|EH|UT|IF|OF)$/i;
export function parseLineup(text) {
  let lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(l => /\p{L}/u.test(l));
  const lead = lines.map(l => /^(\d{1,2})(?:\s*[.)]|\s)/.exec(l));
  const numbered = lead.filter(Boolean).map(m => +m[1]);
  const ordered = numbered.length >= 2 && numbered.every((n, i) => n === i + 1);
  if (ordered) lines = lines.filter((_, i) => lead[i]);
  return lines.slice(0, 30).map(l => {
    l = l.replace(ordered ? /^\d{1,2}\s*[.)]?\s*/ : /^\d{1,2}\s*[.)]\s*/, '')
      .replace(/\s*\((?:L|R|S|B)\)/gi, '').replace(POSITION, '').replace(/\s+/g, ' ').trim();
    let m = /^#?(\d{1,3})\s+(.+)$/.exec(l);
    if (m) return { num: m[1], name: m[2].trim() };
    m = /^(.+?)[\s,]+#?(\d{1,3})$/.exec(l);
    if (m) return { name: m[1].trim(), num: m[2] };
    return { name: l, num: '' };
  });
}

// A team's lineup to start another game with: the players in each slot at the end of this one.
export function carryLineup(team) {
  return team.lineup.map(slot => [{ ...slot[slot.length - 1] }]);
}
