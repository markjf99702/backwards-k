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

// A pasted lineup: one player per line, "Ruiz", "12 Ruiz", "Ruiz #12", "- Emma 4" or "Ohtani - DH"; names on one line
// with commas between them, as in a group text; or a lineup copied from a game preview, "1. Shohei Ohtani DH" or
// "1 Mookie Betts (R) SS .289". When the lines are numbered 1, 2, 3 in order, those numbers are places in the batting
// order, not jersey numbers, and lines without one (a team name, a heading) are left out. Headings ("Saturday lineup",
// "Dodgers lineup vs. LHP Snell:"), bullets, positions, (L) or (R) and batting averages go. A line marked SP, RP or
// P, or starting "Pitcher:", is the starting pitcher. Returns { batters: [player], pitcher: player or null }.
const POS = 'P|SP|RP|C|1B|2B|3B|SS|LF|CF|RF|DH|EH|UT|IF|OF';
const TRAIL = new RegExp(`(\\s*[,\\-–—]\\s*|\\s+)(${POS})$`, 'i');
const LEAD = new RegExp(`^(${POS})\\s+(?=[^\\s.])`); // "SS M. Betts" (capitals only, so it's not a name)
const PAREN = new RegExp(`\\s*\\((${POS})\\)`, 'gi');
const PITCHER = /^(?:SP|RP|P|starting pitcher|starter|pitcher|pitching)$/i;
const HEADING = /\b(?:line-?ups?|roster|batting order)\b/i;
const PITCHES = new Set(['P', 'SP', 'RP']);
const BULLET = /^[^\p{L}\p{N}#]+/u; // - • * · and emoji
// One line with everyone on it: split at semicolons, at commas (two or more), or before each "2." when they run 1, 2, 3.
function oneLine(l) {
  if (l.includes(';')) return l.split(';');
  if (l.split(',').length >= 3) return l.split(',');
  const at = [...l.matchAll(/(?:^|\s)(\d{1,2})[.)]\s*/g)];
  if (at.length >= 2 && at[0].index === 0 && at.every((m, i) => +m[1] === i + 1)) return at.map((m, i) => l.slice(m.index, at[i + 1]?.index));
  return [l];
}
export function parsePaste(text) {
  // Each line that names someone, with whether it's the pitcher; headings left out.
  const read = list => {
    const out = [];
    let next = false;
    for (let l of list) {
      l = l.trim().replace(BULLET, '');
      if (!/\p{L}/u.test(l)) continue;
      const lab = /^([^:]{1,60}):\s*(.*)$/.exec(l);
      if (lab && PITCHER.test(lab[1].trim())) { if (lab[2]) out.push({ l: lab[2], pitch: true }); else next = true; continue; }
      if (lab && !lab[2]) continue; // "Dodgers lineup vs. LHP Snell:"
      if (lab && (HEADING.test(lab[1]) || lab[2].split(',').length >= 3)) l = lab[2]; // "Lineup today: Emma, Liam, Ava"
      else if (HEADING.test(l)) continue; // "Saturday lineup"
      out.push({ l, pitch: next });
      next = false;
    }
    return out;
  };
  let lines = read(String(text).split(/\r?\n/));
  const named = lines.filter(x => !x.pitch);
  if (named.length === 1) lines = lines.flatMap(x => (x === named[0] ? read(oneLine(x.l)) : [x]));
  const lead = lines.map(x => /^(\d{1,2})(?:\s*[.)]|\s)/.exec(x.l));
  const numbered = lead.filter(Boolean).map(m => +m[1]);
  const ordered = numbered.length >= 2 && numbered.every((n, i) => n === i + 1);
  // First names and initials ("Liam O", "Ava K"): a P or C at the end is someone's initial, not a position.
  const initials = lines.some(x => /\s\p{Lu}\.?$/u.test(x.l) && !/\s[PC]$/i.test(x.l));
  const all = lines.map((x, i) => ({ ...one(x.l, ordered, initials), pitch: x.pitch, inOrder: !ordered || !!lead[i] }));
  const dh = all.some(p => p.pos === 'DH');
  // A pitcher who doesn't bat: after "Pitcher:", or marked SP or RP, or P with a DH in the order (OBR 5.11). In a
  // numbered order, everyone with a number bats, and the pitcher can be a line outside it.
  const bats = p => p.inOrder && !p.pitch && (ordered || !(p.pos === 'SP' || p.pos === 'RP' || (p.pos === 'P' && dh)));
  const pitcher = all.find(p => p.pitch || PITCHES.has(p.pos));
  const strip = ({ name, num }) => ({ name, num });
  return { batters: all.filter(bats).slice(0, 30).map(strip), pitcher: pitcher ? strip(pitcher) : null };
}
// One player from one line: { name, num, pos }.
function one(l, ordered, initials) {
  let pos = '';
  const take = (_, p) => { pos ||= p.toUpperCase(); return ''; };
  const trail = s => {
    const m = TRAIL.exec(s);
    if (!m || (initials && m[2].length === 1 && !/[,\-–—]/.test(m[1]))) return s;
    pos ||= m[2].toUpperCase();
    return s.slice(0, m.index);
  };
  l = l.replace(ordered ? /^\d{1,2}\s*[.)]?\s*/ : /^\d{1,2}\s*[.)]\s*/, '')
    .replace(/\s+[01]?\.\d{3}\b.*$/, '') // a batting average, and whatever stats come after it
    .replace(/\s*\((?:L|R|S|B)\)/gi, '').replace(PAREN, take).replace(LEAD, take);
  l = trail(l.replace(/\s+/g, ' ').trim()).trim();
  let m = /^#?(\d{1,3})\s+(.+)$/.exec(l);
  if (m) return { num: m[1], name: trail(m[2]).trim(), pos };
  m = /^(.+?)[\s,]+#?(\d{1,3})$/.exec(l);
  if (m) return { name: trail(m[1]).trim(), num: m[2], pos };
  return { name: l, num: '', pos };
}
// The batters from a pasted lineup (see parsePaste).
export const parseLineup = text => parsePaste(text).batters;

// Undo: the last event comes off, and with it the batting slot or the player it added, unless an earlier event still
// points at that player (someone brought back in, or a pitcher brought back). Returns what Redo needs, or null.
export function takeBack(g) {
  const e = g.ev.pop();
  if (!e) return null;
  const r = { e }, same = x => x.t === e.t && x.s === e.s && x.i === e.i && x.slot === e.slot;
  if (e.t === 'add') r.slot = g.teams[e.s].lineup.pop();
  const list = e.t === 'sub' ? g.teams[e.s].lineup[e.slot] : e.t === 'pch' ? g.teams[e.s].pitchers : null;
  if (list && list.length - 1 === e.i && !g.ev.some(same)) r.player = list.pop();
  return r;
}
// Redo: what takeBack took, put back.
export function putBack(g, r) {
  if (r.slot) g.teams[r.e.s].lineup.push(r.slot);
  if (r.player) (r.e.t === 'sub' ? g.teams[r.e.s].lineup[r.e.slot] : g.teams[r.e.s].pitchers).push(r.player);
  g.ev.push(r.e);
}

// A team's lineup to start another game with: the players in each slot at the end of this one. at: who that was in
// each slot, by place in it (replay's pl), since a starter can come back in; without it, the last one listed.
export function carryLineup(team, at = []) {
  return team.lineup.map((slot, i) => [{ ...(slot[at[i]] || slot[slot.length - 1]) }]);
}
