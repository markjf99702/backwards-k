// What a game looks like when it's saved, and how to tidy one that came from a file, a link or Google Drive.
//
// A game: { id, created, updated, date, place, innings, pitches, rules, tie, limit, spray, start, tz,
// teams: [visitors, home], ev: [events] }
// (A game scored from partway through starts with { t: 'join', inn, half, r: [runs, runs], up }: see engine.js.)
// tie: the first inning that starts with a runner on second (extra innings, OBR 7.01(b)), or 0 for none.
// limit: a pitch limit, or 0 for none: { by: 'll' (Little League), 'ps' (Pitch Smart) or '' (a number), age: the
// pitchers' league age ('11-12', for the rest they need after), max: the most pitches } (engine.js)
// rules: the league's rules, or null: { set: 'll', 'minors' or 'custom' (which ones, for Game settings), runs: the
// most runs a half-inning (0 for no limit), last: that limit holds in the last inning too, all: every run on the play
// that reaches it counts, mercy: [[innings, runs ahead], ...] } (engine.js plays them)
// spray: each hit asks where it went (the fielder it went to, in the play's f), for "singles to left" and the line on
// the card; off, a hit asks nothing more, as before.
// start: when the first pitch was scored (milliseconds, 0 before it), and tz: the time zone it was scored in (minutes
// ahead of UTC), so the box score reads the ballpark's clock wherever it's opened. Each event from the first pitch on
// has at: when it was scored, in seconds since then.
// A team: { name, lineup: [[player, sub, ...] per batting slot], pitchers: [player, ...] }
// A player: { name, num, pos? }, pos: where he plays, when the scorer said ('SS'; one of POSITIONS)
// Everything that happens in the game is in ev, in order (engine.js reads it).
// Anything a newer Backwards K saves that this one doesn't know (a new kind of event, pitch, play or substitution, or a
// new value on a game, team, player or event) is kept as it came, as long as it's small, so this copy can show the
// game and save it again without losing it; and a game holding any of it opens look-only (see newer()).
import { RESULTS, ENDS, PITCH_AGES, LIMIT_BY } from './engine.js';

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

export function newGame({ away = '', home = '', innings = 9, size = 9, pitches = true, rules = null, tie = 0, limit = 0, spray = false, date = today(), place = '' } = {}) {
  const t = Date.now();
  return { id: 'g' + uid(), created: t, updated: t, date, place, innings, pitches, rules, tie, limit, spray, start: 0, tz: 0, teams: [newTeam(away, size), newTeam(home, size)], ev: [] };
}

const str = (v, max = 60) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
const int = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);

// What this version knows: the values on a game, a team, a player and each kind of event, and the kinds of pitch and
// substitution.
const KNOWN = new Map(Object.entries({
  game: ['id', 'created', 'updated', 'date', 'place', 'innings', 'pitches', 'rules', 'tie', 'limit', 'spray', 'start', 'tz', 'teams', 'ev'],
  team: ['name', 'lineup', 'pitchers'], player: ['name', 'num', 'pos'], rules: ['set', 'runs', 'last', 'all', 'mercy'], limit: ['by', 'age', 'max'],
  // (Every kind of event has at, when it was scored.)
  p: ['t', 'k', 'v', 'at'], pa: ['t', 'r', 'f', 'm', 'x', 'at'], r: ['t', 'm', 'at'], sub: ['t', 's', 'slot', 'i', 'ty', 'at'], pch: ['t', 's', 'i', 'at'],
  add: ['t', 's', 'at'], eoh: ['t', 'at'], end: ['t', 'why', 'at'], delay: ['t', 'at'], on: ['t', 'at'], gone: ['t', 's', 'slot', 'at'], back: ['t', 's', 'slot', 'at'],
  cr: ['t', 's', 'b', 'slot', 'name', 'num', 'at'], up: ['t', 's', 'slot', 'at'], join: ['t', 'inn', 'half', 'r', 'up', 'at'],
}));
const EVENTS = new Set(['p', 'pa', 'r', 'sub', 'pch', 'add', 'eoh', 'end', 'delay', 'on', 'gone', 'back', 'cr', 'up', 'join']), KINDS = ['b', 'c', 's', 'f'], SUBS = ['ph', 'pr', 'def'];
// A value from a newer version, as plain JSON: text (200 characters at most), numbers, true, false and null, and lists
// (50 long) and objects (20 values) of those, four deep. Anything else is left out (undefined).
function plain(v, deep = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.slice(0, 200);
  if (!v || typeof v !== 'object' || deep >= 4) return undefined;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => plain(x, deep + 1) ?? null);
  const o = {};
  for (const [k, x] of Object.entries(v).slice(0, 20)) { const y = plain(x, deep + 1); if (y !== undefined && /^[\w-]{1,20}$/.test(k) && k !== '__proto__') o[k] = y; }
  return o;
}
// The values on o that this version doesn't know, kept if they come to no more than max characters, else none.
function more(o, known, max) {
  const out = plain(Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k))));
  return JSON.stringify(out).length <= max ? out : {};
}
// Where a player can play: the nine positions, a designated or extra hitter, and the two outfielders between them in
// a softball or youth game with four.
export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'LC', 'RC', 'DH', 'EH'];
const cleanPlayer = p => ({
  name: str(p && p.name), num: str(p && p.num, 4), ...(p && POSITIONS.includes(p.pos) ? { pos: p.pos } : {}),
  ...(p && typeof p === 'object' ? more(p, KNOWN.get('player'), 500) : {}),
});
const cleanList = (a, f) => (Array.isArray(a) ? a.map(f) : []);
// A player's number, name or position as typed or picked (no position is none at all, not an empty one).
export function setField(p, f, v) {
  v = String(v).trim();
  if (f === 'pos' && !POSITIONS.includes(v)) delete p.pos; else p[f] = v;
}
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
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  // A kind of event, or of pitch, from a newer version: kept whole, if it's small (the engine passes over it).
  if (!EVENTS.has(e.t) || (e.t === 'p' && !KINDS.includes(e.k))) {
    if (typeof e.t !== 'string' || !/^\w{1,12}$/.test(e.t)) return null;
    const o = { t: e.t, ...plain(e) };
    return JSON.stringify(o).length <= 1000 ? o : null;
  }
  let o;
  switch (e.t) {
    // An automatic ball or strike (the pitch clock) is v: 1. (Another v, from a newer version, is kept.)
    case 'p': o = { t: 'p', k: e.k }; if (e.v != null && plain(e.v) !== undefined) o.v = e.v === 1 ? 1 : plain(e.v); break;
    case 'pa':
      if (typeof e.r !== 'string') return null;
      o = { t: 'pa', r: e.r.slice(0, 4) };
      if (Array.isArray(e.f) && e.f.length) o.f = fielders(e.f);
      if (Array.isArray(e.m)) o.m = cleanMoves(e.m);
      if (e.x) o.x = 1;
      break;
    case 'r': o = { t: 'r', m: cleanMoves(e.m) }; break;
    // (A kind of substitution from a newer version is kept, and the engine takes it as a change in the field.)
    case 'sub': o = { t: 'sub', s: int(e.s, 0, 1, 0), slot: int(e.slot, 0, 40, 0), i: int(e.i, 0, 40, 0), ty: typeof e.ty === 'string' && /^\w{1,8}$/.test(e.ty) ? e.ty : 'def' }; break;
    case 'pch': o = { t: 'pch', s: int(e.s, 0, 1, 0), i: int(e.i, 0, 40, 0) }; break;
    case 'add': o = { t: 'add', s: int(e.s, 0, 1, 0) }; break;
    // A player who left the game, skipped in a continuous order, and back in it: her spot in the order.
    // (And someone else is batting than the order said: his spot.)
    case 'gone': case 'back': case 'up': o = { t: e.t, s: int(e.s, 0, 1, 0), slot: int(e.slot, 0, 40, 0) }; break;
    // Scored from partway through (the first event): the inning and half, each team's runs then, and who led off.
    case 'join': {
      const r = Array.isArray(e.r) ? e.r : [];
      o = { t: 'join', inn: int(e.inn, 1, 30, 1), half: e.half ? 1 : 0, r: [int(r[0], 0, 99, 0), int(r[1], 0, 99, 0)], up: int(e.up, 0, 40, 0) };
      break;
    }
    // A courtesy runner for the runner on base b: someone in the order (her spot), or a name and number.
    case 'cr':
      o = { t: 'cr', s: int(e.s, 0, 1, 0), b: int(e.b, 1, 3, 1) };
      if (e.slot != null && e.slot !== '') o.slot = int(e.slot, 0, 40, 0); else Object.assign(o, { name: str(e.name), num: str(e.num, 4) });
      break;
    // Why the game ended: a run rule or a time limit (none: called). A reason from a newer version is kept.
    case 'end': o = { t: 'end' }; if (typeof e.why === 'string' && /^\w{1,12}$/.test(e.why)) o.why = e.why; break;
    default: o = { t: e.t };
  }
  // When it was scored: seconds since the first pitch.
  if (Number.isFinite(e.at)) o.at = int(e.at, 0, 1e7, 0);
  return Object.assign(o, more(e, KNOWN.get(e.t), 1000));
}

// A league's rules (see above), or null for none. A mercy rule needs both its numbers; there are four at most.
function cleanRules(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const mercy = cleanList(r.mercy, m => m).filter(m => Array.isArray(m) && whole(m[0], 1, 30) && whole(m[1], 1, 99)).map(m => [m[0], m[1]]).slice(0, 4);
  return {
    set: typeof r.set === 'string' && /^\w{1,12}$/.test(r.set) ? r.set : 'custom', runs: int(r.runs, 0, 99, 0), last: !!r.last, all: !!r.all, mercy,
    ...more(r, KNOWN.get('rules'), 500),
  };
}

// A pitch limit (see above), or 0 for none. A kind or a league age this version doesn't know (from a newer one) is
// kept, and the game opens look-only (see newer()).
function cleanLimit(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !(+v.max >= 1)) return 0;
  const word = x => (typeof x === 'string' && /^[\w-]{1,12}$/.test(x) ? x : '');
  const by = word(v.by);
  return { by, age: by ? word(v.age) : '', max: int(v.max, 1, 300, 85), ...more(v, KNOWN.get('limit'), 300) };
}
// A limit by league age that this version has the table for (or a plain number).
const knownLimit = L => !L.by || (Object.hasOwn(LIMIT_BY, L.by) && Object.hasOwn(PITCH_AGES, L.age));

// The league rules and pitch limit a new game starts with, from the last one: only what this version knows. Anything a
// newer Backwards K saved in them belongs to that game, and in a new one would make it look-only.
export function carried(g) {
  const only = (o, k) => Object.fromEntries(KNOWN.get(k).filter(x => x in o).map(x => [x, structuredClone(o[x])]));
  return { rules: g && g.rules ? only(g.rules, 'rules') : null, limit: g && g.limit && knownLimit(g.limit) ? only(g.limit, 'limit') : 0 };
}

function cleanTeam(t, side) {
  t = t && typeof t === 'object' ? t : {};
  let lineup = cleanList(t.lineup, s => cleanList(Array.isArray(s) ? s : [s], cleanPlayer)).filter(s => s.length).slice(0, 40);
  if (!lineup.length) lineup = newTeam('', 9).lineup;
  let pitchers = cleanList(t.pitchers, cleanPlayer).slice(0, 40);
  if (!pitchers.length) pitchers = [blank()];
  return { name: str(t.name) || '', lineup, pitchers, side, ...more(t, KNOWN.get('team'), 1000) };
}

// A game from anywhere outside this device, made safe to use. Returns null if it isn't a game at all.
export function cleanGame(g) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.teams)) return null;
  const t = Date.now();
  const teams = [cleanTeam(g.teams[0], 0), cleanTeam(g.teams[1], 1)].map(({ side, ...rest }) => rest);
  const ev = cleanList(g.ev, cleanEvent).filter(Boolean);
  // Substitutions point at players by position in a slot; drop any that point past the end.
  const ok = ev.filter(e => (e.t === 'sub' ? !!teams[e.s].lineup[e.slot] && e.i < teams[e.s].lineup[e.slot].length
    : e.t === 'gone' || e.t === 'back' || e.t === 'up' || (e.t === 'cr' && 'slot' in e) ? !!teams[e.s].lineup[e.slot]
    : e.t === 'pch' ? e.i < teams[e.s].pitchers.length : true));
  return {
    id: typeof g.id === 'string' && /^g[\w-]{4,40}$/.test(g.id) ? g.id : 'g' + uid(),
    created: int(g.created, 0, 9e15, t), updated: int(g.updated, 0, 9e15, t),
    date: /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : today(),
    place: str(g.place, 80), innings: int(g.innings, 1, 30, 9), pitches: g.pitches !== false, rules: cleanRules(g.rules), tie: int(g.tie, 0, 30, 0), limit: cleanLimit(g.limit),
    spray: g.spray === true, start: int(g.start, 0, 9e15, 0), tz: int(g.tz, -840, 840, 0), teams, ev: ok, ...more(g, KNOWN.get('game'), 2000),
  };
}

// Whether a game holds something from a newer Backwards K that this one doesn't know. Such a game opens look-only:
// scoring on from a game this copy can't read all of would go wrong.
export function newer(g) {
  const extra = (o, k) => Object.keys(o).some(x => !KNOWN.get(k).includes(x));
  return extra(g, 'game') || (!!g.rules && extra(g.rules, 'rules')) || (!!g.limit && (extra(g.limit, 'limit') || !knownLimit(g.limit))) || g.teams.some(t => extra(t, 'team') || [...t.lineup.flat(), ...t.pitchers].some(p => extra(p, 'player')))
    || g.ev.some(e => !EVENTS.has(e.t) || extra(e, e.t) || (e.t === 'p' && (!KINDS.includes(e.k) || ('v' in e && e.v !== 1)))
      || (e.t === 'pa' && !Object.hasOwn(RESULTS, e.r)) || (e.t === 'sub' && !SUBS.includes(e.ty)) || (e.t === 'end' && 'why' in e && !Object.hasOwn(ENDS, e.why)));
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
// The plays written out the same way whatever order their values were set in (a play made here has them in another
// order than the same play read back from storage, Drive or a link), to tell whether two lists of plays are the same.
export const plays = ev => JSON.stringify(ev, (k, v) => (v && v.constructor === Object ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

// A pasted lineup: one player per line, "Ruiz", "12 Ruiz", "Ruiz #12", "- Emma 4" or "Ohtani - DH"; names on one line
// with commas between them, as in a group text; or a lineup copied from a game preview, "1. Shohei Ohtani DH" or
// "1 Mookie Betts (R) SS .289". When the lines are numbered 1, 2, 3 in order, those numbers are places in the batting
// order, not jersey numbers, and lines without one (a team name, a heading) are left out. Headings ("Saturday lineup",
// "Dodgers lineup vs. LHP Snell:"), bullets, (L) or (R) and batting averages go, and a position goes with the batter
// (pos). A line marked SP, RP or P, or starting "Pitcher:", is the starting pitcher. Returns { batters: [player],
// pitcher: player or null }.
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
  // A batter keeps his position, as the card and the box score show it (a starter, SP, is the pitcher, P).
  const at = p => { const pos = PITCHES.has(p.pos) ? 'P' : p.pos; return POSITIONS.includes(pos) ? { ...strip(p), pos } : strip(p); };
  return { batters: all.filter(bats).slice(0, 30).map(at), pitcher: pitcher ? strip(pitcher) : null };
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
// points at that player (someone brought back in, or a pitcher brought back). Never the starter (0), whom no event
// added: a starting pitcher brought back, after the change that took him out was left out by Put back, stays the
// team's starter. Returns what Redo needs, or null.
export function takeBack(g) {
  const e = g.ev.pop();
  if (!e) return null;
  const r = { e }, same = x => x.t === e.t && x.s === e.s && x.i === e.i && x.slot === e.slot;
  if (e.t === 'add') r.slot = g.teams[e.s].lineup.pop();
  const list = e.t === 'sub' ? g.teams[e.s].lineup[e.slot] : e.t === 'pch' ? g.teams[e.s].pitchers : null;
  if (list && e.i > 0 && list.length - 1 === e.i && !g.ev.some(same)) r.player = list.pop();
  return r;
}
// Redo: what takeBack took, put back. Put back later, after other changes (see game.js), a player it brought in goes at
// the end of the list again, and the event points at him there. Returns the event as it went in.
export function putBack(g, r) {
  let e = r.e;
  if (r.slot) g.teams[e.s].lineup.push(r.slot);
  if (r.player) {
    const list = e.t === 'sub' ? g.teams[e.s].lineup[e.slot] : g.teams[e.s].pitchers;
    list.push(r.player);
    if (e.i !== list.length - 1) e = { ...e, i: list.length - 1 };
  }
  g.ev.push(e);
  return e;
}

// Two copies of one game made one, for Google Drive and for saving a shared link: a, the copy that keeps the game,
// and b, the other. When one copy's plays are the start of the other's, the longer list wins. But when the longer list
// is exactly the plays both copies had the last time they were compared (seen, from Drive: see seenOf()), the shorter
// one took plays back with Undo, and it keeps them taken back. The names and settings are put together one by one:
// each from the copy that changed it since that comparison, and from the copy changed last when both did, or when
// there's nothing to compare with (a shared link). When each copy has plays the other lacks, both are kept: b goes in as
// a game of its own, marked (second copy). Returns { game, second }; game is a or b itself when that copy is already
// the answer, or else a new copy, changed after both.
export function merge(a, b, seen = null) {
  const now = Math.max(Date.now(), a.updated + 1, b.updated + 1), newer = b.updated > a.updated ? b : a;
  if (plays(a.ev) === plays(b.ev) && !seen) return { game: newer, second: null };
  const [short, long] = a.ev.length <= b.ev.length ? [a, b] : [b, a];
  if (plays(long.ev.slice(0, short.ev.length)) !== plays(short.ev)) {
    const place = /\(second copy\)$/.test(b.place) ? b.place : `${b.place.slice(0, 66)} (second copy)`.trim();
    return { game: a.updated > b.updated ? a : { ...a, updated: now }, second: { ...b, id: 'g' + uid(), place, updated: now } };
  }
  const from = seen && long.ev.length === seen.n && hash(plays(long.ev)) === seen.h ? short : long;
  // One name or setting: x is a's, y is b's and z what they both had (undefined when that isn't known).
  const pick = (x, y, z) => (plays(x) === plays(y) ? x : z !== undefined && plays(x) === plays(z) ? y : z !== undefined && plays(y) === plays(z) ? x : newer === b ? y : x);
  const was = seen?.k, own = (p, f) => (p ? p[f] ?? '' : undefined);
  // A player's name, number and position, for one the two copies both have.
  const player = (p, x, y, z) => {
    if (!x || !y) return p;
    const [name, num, pos] = ['name', 'num', 'pos'].map(f => pick(own(x, f), own(y, f), own(z, f)));
    const { pos: _, ...rest } = { ...p, name, num };
    return pos ? { ...rest, pos } : rest;
  };
  const team = (t, s) => {
    const [x, y, z] = [a.teams[s], b.teams[s], was?.teams?.[s]];
    return {
      ...t, name: pick(x.name, y.name, z?.name),
      lineup: t.lineup.map((slot, i) => slot.map((p, j) => player(p, x.lineup[i]?.[j], y.lineup[i]?.[j], z?.lineup?.[i]?.[j]))),
      pitchers: t.pitchers.map((p, j) => player(p, x.pitchers[j], y.pitchers[j], z?.pitchers?.[j])),
    };
  };
  const game = { ...from, ...Object.fromEntries(SET.map(k => [k, pick(a[k], b[k], was?.[k])])), teams: from.teams.map(team), updated: now };
  // (Already one of them: that copy, when it's the one changed last, as nothing about it changes.)
  return { game: canon({ ...game, updated: 0 }) === canon({ ...newer, updated: 0 }) ? newer : game, second: null };
}
// The names and settings merge() puts together one by one.
const SET = ['date', 'place', 'innings', 'pitches', 'rules', 'tie', 'limit', 'spray'];
const named = p => ({ name: p.name, num: p.num, ...(p.pos ? { pos: p.pos } : {}) });
// What Drive remembers of a game after comparing it (see merge()): how many plays, a fingerprint of them, and its
// names and settings (k).
export const seenOf = g => ({
  n: g.ev.length, h: hash(plays(g.ev)),
  k: { ...Object.fromEntries(SET.map(x => [x, g[x]])), teams: g.teams.map(t => ({ name: t.name, lineup: t.lineup.map(s => s.map(named)), pitchers: t.pitchers.map(named) })) },
});
// A short fingerprint of some text (FNV-1a).
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

// A team's batting order to start another game with: whoever started in each spot, by name, number and position.
// Next week's order is usually the same players in the same spots; a pinch hitter or a pinch runner rarely starts.
export const starters = team => team.lineup.map(({ 0: p }) => ({ name: p.name, num: p.num, ...(p.pos ? { pos: p.pos } : {}) }));
