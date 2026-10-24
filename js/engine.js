// The rules of keeping score. A game is a list of events (pitches, plate appearances, runner moves, substitutions);
// replay() reads them in order and works out everything on screen: the count, outs, runners, the score by inning,
// each batter's box on the scorecard, the box score and the play-by-play. Undo is just dropping the last event.
//
// Sides: 0 is the visitors (they bat in the top of each inning), 1 is the home team.
// Bases: 1, 2 and 3 are the bags, 0 is the batter at the plate, 4 is home (a run).
// A move is [from, to, how?, fielders?]; to 0 means out.

export const POS = ['', 'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
export const POS_NAME = ['', 'pitcher', 'catcher', 'first baseman', 'second baseman', 'third baseman', 'shortstop', 'left fielder', 'center fielder', 'right fielder'];
// Where a ball went (to WHERE) and who threw it (FROM): flies out to center; short to first.
const WHERE = ['', 'the pitcher', 'the catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
const FROM = ['', 'pitcher', 'catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
export const BASE = ['home', 'first', 'second', 'third', 'home'];

// kind: hit, on (safe without a hit) or out. go: the base the batter reaches. ab: counts as an at-bat.
// pitch: what the last pitch was when this is tapped without counting it first (x in play, b ball, s strike).
// f: fielders to ask for (0 none, 1 one, 2 a sequence such as 6-4-3). rbi: 0 when runs on it earn no RBI.
export const RESULTS = {
  '1B': { label: 'Single', kind: 'hit', go: 1, ab: 1, pitch: 'x', f: 0, say: 'singles' },
  '2B': { label: 'Double', kind: 'hit', go: 2, ab: 1, pitch: 'x', f: 0, say: 'doubles' },
  '3B': { label: 'Triple', kind: 'hit', go: 3, ab: 1, pitch: 'x', f: 0, say: 'triples' },
  HR: { label: 'Home run', kind: 'hit', go: 4, ab: 1, pitch: 'x', f: 0, say: 'hits a home run' },
  BB: { label: 'Walk', kind: 'on', go: 1, ab: 0, pitch: 'b', f: 0, say: 'walks', bb: 1 },
  IBB: { label: 'Intentional walk', kind: 'on', go: 1, ab: 0, pitch: '', f: 0, say: 'is walked intentionally', bb: 1 },
  HBP: { label: 'Hit by pitch', kind: 'on', go: 1, ab: 0, pitch: 'b', f: 0, say: 'is hit by a pitch', hbp: 1 },
  E: { label: 'Error', kind: 'on', go: 1, ab: 1, pitch: 'x', f: 1, say: 'reaches on an error', rbi: 0, err: 1 },
  FC: { label: 'Fielder’s choice', kind: 'on', go: 1, ab: 1, pitch: 'x', f: 2, say: 'reaches on a fielder’s choice' },
  KD: { label: 'Dropped third strike', kind: 'on', go: 1, ab: 1, pitch: 's', f: 0, say: 'strikes out but reaches on a dropped third strike', k: 1, rbi: 0 },
  CI: { label: 'Catcher’s interference', kind: 'on', go: 1, ab: 0, pitch: 'x', f: 0, say: 'reaches on catcher’s interference' },
  K: { label: 'Strikeout swinging', kind: 'out', go: 0, ab: 1, pitch: 's', f: 0, say: 'strikes out swinging', k: 1 },
  KL: { label: 'Strikeout looking', kind: 'out', go: 0, ab: 1, pitch: 's', f: 0, say: 'strikes out looking', k: 1 },
  GO: { label: 'Ground out', kind: 'out', go: 0, ab: 1, pitch: 'x', f: 2, say: 'grounds out' },
  FO: { label: 'Fly out', kind: 'out', go: 0, ab: 1, pitch: 'x', f: 1, say: 'flies out' },
  LO: { label: 'Line out', kind: 'out', go: 0, ab: 1, pitch: 'x', f: 1, say: 'lines out' },
  PU: { label: 'Pop out', kind: 'out', go: 0, ab: 1, pitch: 'x', f: 1, say: 'pops out' },
  SF: { label: 'Sacrifice fly', kind: 'out', go: 0, ab: 0, pitch: 'x', f: 1, say: 'hits a sacrifice fly', sf: 1 },
  SAC: { label: 'Sacrifice bunt', kind: 'out', go: 0, ab: 0, pitch: 'x', f: 2, say: 'lays down a sacrifice bunt', sh: 1 },
  DP: { label: 'Double play', kind: 'out', go: 0, ab: 1, pitch: 'x', f: 2, say: 'grounds into a double play', rbi: 0 },
  TP: { label: 'Triple play', kind: 'out', go: 0, ab: 1, pitch: 'x', f: 2, say: 'hits into a triple play', rbi: 0 },
};

// How a runner moved when the batter didn't move them.
export const RUNS = {
  SB: { label: 'Stole', out: false },
  CS: { label: 'Caught stealing', out: true },
  PO: { label: 'Picked off', out: true },
  WP: { label: 'Wild pitch', out: false },
  PB: { label: 'Passed ball', out: false },
  BK: { label: 'Balk', out: false },
  E: { label: 'Error', out: false },
  OA: { label: 'Moved up', out: false },
  OB: { label: 'Out on the bases', out: true },
};

export const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const dash = f => (f && f.length ? f.join('-') : '');

// The scorer's shorthand for a plate appearance: 6-3, F8, E6, BB. A strikeout looking is KL here and is drawn
// as a backwards K wherever it's shown.
export function mark(code, f) {
  const d = dash(f), one = f && f.length ? f[0] : '';
  switch (code) {
    case 'GO': return f && f.length === 1 ? f[0] + 'U' : d || 'G';
    case 'FO': return 'F' + one;
    case 'LO': return 'L' + one;
    case 'PU': return 'P' + one;
    case 'SF': return 'SF' + one;
    case 'SAC': return d ? 'SAC ' + d : 'SAC';
    case 'E': return 'E' + one;
    case 'FC': return d ? 'FC ' + d : 'FC';
    case 'DP': return d ? d + ' DP' : 'DP';
    case 'TP': return d ? d + ' TP' : 'TP';
    case 'KD': return 'K';
    default: return code;
  }
}
function runMark(how, f) {
  if (how === 'E') return 'E' + (f && f.length ? f[0] : '');
  if (how === 'CS' || how === 'PO') return f && f.length ? how + ' ' + dash(f) : how;
  if (how === 'OA' || how === 'OB') return '';
  return how;
}

// ---------- names ----------
export function player(g, side, slot, p = 0) {
  const s = g.teams[side].lineup[slot];
  return (s && (s[p] || s[s.length - 1])) || { name: '', num: '' };
}
export function label(pl, slot) {
  if (pl.name) return pl.name;
  if (pl.num) return '#' + pl.num;
  return 'Batter ' + (slot + 1);
}
export const teamName = (g, side) => g.teams[side].name || (side ? 'Home' : 'Visitors');
export function pitcherLabel(g, side, i) {
  const p = g.teams[side].pitchers[i] || {};
  return p.name || (p.num ? '#' + p.num : i ? 'Pitcher ' + (i + 1) : 'Pitcher');
}

// ---------- replay ----------
export function replay(g) {
  const adds = [0, 0];
  for (const e of g.ev) if (e.t === 'add') adds[e.s]++;
  const S = {
    g, i: 0, inn: 1, half: 0, outs: 0, b: 0, s: 0, seq: '',
    bases: [null, null, null, null],
    size: [0, 1].map(t => Math.max(1, g.teams[t].lineup.length - adds[t])),
    up: [0, 0],
    pl: [0, 1].map(t => g.teams[t].lineup.map(() => 0)),
    pit: [0, 0],
    line: [[0], []], hInn: [[0], []], eInn: [[0], []], lob: [[], []],
    R: [0, 0], H: [0, 0], E: [0, 0],
    cells: [], extra: [[], []], col: { k: 0, used: new Set() }, last: null,
    plays: [], text: [], bat: {}, pitching: [[], []],
    over: false, ended: false, hold: false, between: false, batted: [false, false],
    waved: 0, // runners this half-inning who crossed the plate on the third out but didn't count: left on base
  };
  g.ev.forEach((e, i) => { S.i = i; step(S, e); });
  S.i = g.ev.length;
  if (S.over && !S.between) S.lob[S.half][S.inn - 1] = [1, 2, 3].filter(b => S.bases[b]).length + S.waved;
  return S;
}

// What happens in a game, as opposed to who's in it.
const PLAY = new Set(['p', 'pa', 'r', 'eoh']);

function step(S, e) {
  const g = S.g;
  // A play after the final (fewer innings set since it was scored, or an older game): play went on, so it counts
  // for the team that was batting.
  if (S.over && S.between && PLAY.has(e.t)) resume(S);
  switch (e.t) {
    case 'p': return pitch(S, e.k);
    case 'pa': return pa(S, e);
    case 'r': return runners(S, e);
    case 'sub': {
      const old = S.pl[e.s][e.slot];
      S.pl[e.s][e.slot] = e.i;
      if (e.ty === 'pr') for (const b of [1, 2, 3]) if (S.bases[b] && S.bases[b].side === e.s && S.bases[b].slot === e.slot) S.bases[b].p = e.i;
      const a = label(player(g, e.s, e.slot, e.i), e.slot), was = label(player(g, e.s, e.slot, old), e.slot);
      const verb = e.ty === 'ph' ? 'pinch-hits for' : e.ty === 'pr' ? 'pinch-runs for' : 'comes in for';
      return note(S, `${a} ${verb} ${was}.`, 'sub');
    }
    case 'pch':
      S.pit[e.s] = e.i;
      return note(S, `Pitching change: ${pitcherLabel(g, e.s, e.i)} pitches for ${teamName(g, e.s)}.`, 'sub');
    case 'add':
      S.size[e.s]++;
      // Added just as the order came back round to the top: the new batter is up first.
      if (S.up[e.s] === 0 && S.batted[e.s]) S.up[e.s] = S.size[e.s] - 1;
      return note(S, `${teamName(g, e.s)} add a batter to the order.`, 'sub');
    case 'eoh':
      S.text[S.i] = 'Ended the half-inning';
      return endHalf(S, true);
    case 'end':
      S.over = true; S.ended = true;
      return note(S, 'The game is called.', 'end');
    case 'on':
      note(S, 'Play goes on.', 'sub');
      return resume(S);
  }
}

// Keep playing, after the game was over or called.
function resume(S) {
  S.over = false; S.ended = false; S.hold = true;
  if (S.between) nextHalf(S);
}

function note(S, text, kind) {
  S.text[S.i] = text;
  S.plays.push({ i: S.i, inn: S.inn, half: S.half, text, kind, runs: 0 });
}

const key = (side, slot, p) => side + '.' + slot + '.' + p;
function bstat(S, side, slot, p) {
  return S.bat[key(side, slot, p)] ||= { pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, k: 0, hbp: 0, sb: 0, cs: 0 };
}
function pstat(S, side = 1 - S.half, i = S.pit[side]) {
  return S.pitching[side][i] ||= { np: 0, balls: 0, str: 0, bf: 0, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0, hbp: 0, wp: 0, bk: 0 };
}

function pitch(S, k) {
  const P = pstat(S);
  P.np++; S.seq += k;
  const count = () => `${S.b}-${S.s}`;
  if (k === 'b') {
    P.balls++; S.b++;
    if (S.b >= 4) return pa(S, { r: 'BB', auto: true });
    S.text[S.i] = `Ball (${count()})`;
  } else {
    P.str++;
    if (k === 'f') { if (S.s < 2) S.s++; S.text[S.i] = `Foul (${count()})`; return; }
    S.s++;
    if (S.s >= 3) return pa(S, { r: k === 'c' ? 'KL' : 'K', auto: true });
    S.text[S.i] = `${k === 'c' ? 'Called strike' : 'Swinging strike'} (${count()})`;
  }
}

function pa(S, e) {
  const g = S.g, side = S.half, fld = 1 - side, slot = S.up[side], p = S.pl[side][slot], R = RESULTS[e.r];
  if (!R) return;
  const P = pstat(S);
  if (!e.auto && R.pitch) {
    P.np++;
    if (R.pitch === 'b') P.balls++; else P.str++;
    S.seq += R.pitch;
  }
  if (S.col.used.has(slot)) { S.col.k++; S.col.used = new Set(); S.extra[side][S.inn - 1] = S.col.k; }
  S.col.used.add(slot);
  S.batted[side] = true;
  const cell = {
    n: S.cells.length, side, slot, p, inn: S.inn, k: S.col.k, r: e.r, f: e.f || null, mark: mark(e.r, e.f),
    count: [Math.min(S.b, 3), Math.min(S.s, 2)], seq: S.seq, ev: S.i, reach: 0, notes: ['', '', '', '', ''],
    outN: 0, outAt: 0, outHow: '', scored: false, rbi: 0, end: false, text: '', story: [],
  };
  S.cells.push(cell);

  const B = bstat(S, side, slot, p);
  B.pa++; B.ab += R.ab;
  if (R.bb) { B.bb++; P.bb++; }
  if (R.k) { B.k++; P.k++; }
  if (R.hbp) { B.hbp++; P.hbp++; }
  P.bf++;
  if (R.kind === 'hit') {
    B.h++; P.h++; S.H[side]++; S.hInn[side][S.inn - 1]++;
    if (R.go === 2) B.d++; else if (R.go === 3) B.t++; else if (R.go === 4) { B.hr++; P.hr++; }
  }
  if (R.err) { S.E[fld]++; S.eInn[side][S.inn - 1]++; }

  const moves = (e.m || suggest(S, e.r)).slice().sort((a, b) => b[0] - a[0]);
  const batter = { cell, side, slot, p, pi: S.pit[fld] };
  const batterName = label(player(g, side, slot, p), slot);
  const bits = [];
  let runs = 0, bOut = false, bTo = R.go;
  for (const [from, to] of moves) {
    const r = from === 0 ? batter : S.bases[from];
    if (!r) continue;
    if (from) S.bases[from] = null;
    const who = label(player(g, side, r.slot, r.p), r.slot);
    if (from === 0) bTo = to;
    if (to === 0) {
      if (from === 0) {
        bOut = true;
        // Out on a ball that would have put them on (thrown out stretching a single): the path to first, then out.
        if (R.kind !== 'out') { reach(cell, 0, R.go || 1, ''); out(S, r, (R.go || 1) + 1, ''); }
        else out(S, r, 0, '');
      } else {
        out(S, r, from + 1, dash(e.f));
        bits.push(`${who} is out at ${BASE[from + 1]}`);
        r.cell.story.push(`Out at ${BASE[from + 1]} on ${batterName}’s ${R.label.toLowerCase()}.`);
      }
    } else if (to === 4 && e.x) {
      // The third out came first (or was a force): the run doesn't count, and the runner counts as left on base.
      S.waved++;
      bits.push(`${who} crosses the plate, but the run doesn’t count`);
      r.cell.story.push('Crossed the plate, but the run doesn’t count.');
    } else {
      reach(r.cell, from, to, from ? String(slot + 1) : '');
      if (to === 4) {
        score(S, r);
        runs++;
        if (from) { bits.push(`${who} scores`); r.cell.story.push(`Scored on ${batterName}’s ${R.label.toLowerCase()}.`); }
      } else {
        S.bases[to] = r;
        if (from && to > from) { bits.push(`${who} to ${BASE[to]}`); r.cell.story.push(`To ${BASE[to]} on ${batterName}’s ${R.label.toLowerCase()}.`); }
      }
    }
  }
  if (runs && R.rbi !== 0) { cell.rbi = runs; B.rbi += runs; }

  let text = `${batterName} ${R.say}${fielderWords(e.r, e.f)}`;
  if (R.kind !== 'out' && bOut) text += `, but is out trying for ${BASE[(R.go || 1) + 1]}`;
  else if (R.kind !== 'out' && bTo > R.go && bTo < 4) text += ` and takes ${BASE[bTo]}`;
  else if (R.kind !== 'out' && bTo === 4 && R.go < 4) text += ' and comes all the way home';
  else if (R.kind === 'out' && !bOut && bTo > 0) text += ` but reaches ${BASE[bTo]}`;
  text += '.' + (bits.length ? ' ' + bits.join('. ') + '.' : '');
  cell.text = text;
  S.text[S.i] = text;
  S.plays.push({ i: S.i, inn: S.inn, half: side, text, kind: 'pa', runs, cell: cell.n, r: e.r });

  S.b = 0; S.s = 0; S.seq = '';
  S.up[side] = (slot + 1) % S.size[side];
  S.last = cell;
  walkoff(S);
  if (S.outs >= 3) endHalf(S);
}

function fielderWords(code, f) {
  if (!f || !f.length) return '';
  const m = mark(code, f);
  if (code === 'GO') return f.length === 1 ? ` to ${WHERE[f[0]]}, unassisted (${m})` : `, ${FROM[f[0]]} to ${FROM[f[f.length - 1]]} (${m})`;
  if (code === 'FO' || code === 'LO' || code === 'PU' || code === 'SF') return ` to ${WHERE[f[0]]} (${m})`;
  if (code === 'E') return ` by the ${POS_NAME[f[0]]} (${m})`;
  return ` (${dash(f)})`;
}

function runners(S, e) {
  const g = S.g, side = S.half, fld = 1 - side;
  const moves = e.m.slice().sort((a, b) => b[0] - a[0]);
  const bits = [];
  let runs = 0;
  const balk = moves.length && moves.every(m => m[2] === 'BK');
  for (const [from, to, how, f] of moves) {
    const r = S.bases[from];
    if (!r) continue;
    // Someone who didn't move is still on that base (the runners ahead go first): this runner stays put.
    if (to >= 1 && to <= 3 && to !== from && S.bases[to]) continue;
    S.bases[from] = null;
    const who = label(player(g, side, r.slot, r.p), r.slot), m = runMark(how, f);
    if (how === 'E') { S.E[fld]++; S.eInn[side][S.inn - 1]++; }
    if (how === 'SB') bstat(S, side, r.slot, r.p).sb++;
    if (how === 'CS') bstat(S, side, r.slot, r.p).cs++;
    if (to === 0) {
      out(S, r, how === 'PO' ? from : from + 1, m);
      bits.push(how === 'CS' ? `${who} is caught stealing ${BASE[from + 1]}`
        : how === 'PO' ? `${who} is picked off ${BASE[from]}`
          : `${who} is out at ${BASE[from + 1]}`);
      r.cell.story.push(bits[bits.length - 1].replace(who + ' is', 'Was') + '.');
    } else {
      reach(r.cell, from, to, m);
      const where = to === 4 ? 'scores' : `${how === 'SB' ? 'steals' : 'moves to'} ${BASE[to]}`;
      const why = how === 'WP' ? ' on a wild pitch' : how === 'PB' ? ' on a passed ball' : how === 'E' ? ` on an error by the ${POS_NAME[f && f[0]] || 'fielder'}${f && f[0] ? ` (E${f[0]})` : ''}` : '';
      bits.push(`${who} ${how === 'SB' && to === 4 ? 'steals home' : where}${balk ? '' : why}`);
      r.cell.story.push(`${how === 'SB' && to === 4 ? 'Stole home' : to === 4 ? 'Scored' : how === 'SB' ? 'Stole ' + BASE[to] : 'Moved to ' + BASE[to]}${balk ? ' on a balk' : why}.`);
      if (to === 4) { score(S, r); runs++; } else S.bases[to] = r;
    }
  }
  if (moves.some(m => m[2] === 'WP')) pstat(S).wp++;
  if (balk) pstat(S).bk++;
  const text = (balk ? 'Balk. ' : '') + (bits.length ? bits.join('. ') + '.' : '');
  S.text[S.i] = text;
  S.plays.push({ i: S.i, inn: S.inn, half: side, text, kind: 'run', runs });
  walkoff(S);
  if (S.outs >= 3) endHalf(S);
}

function reach(cell, from, to, how) {
  if (to > cell.reach) cell.reach = to;
  if (how && to > from) cell.notes[to] = how;
}
function out(S, r, at, how) {
  S.outs++;
  if (!r.cell.outN) { r.cell.outN = S.outs; r.cell.outAt = at; r.cell.outHow = how; }
  pstat(S).outs++;
}
function score(S, r) {
  const side = S.half;
  S.R[side]++; S.line[side][S.inn - 1]++;
  r.cell.scored = true;
  bstat(S, side, r.slot, r.p).r++;
  pstat(S, 1 - side, r.pi).r++;
}

function walkoff(S) {
  if (!S.hold && S.half === 1 && S.inn >= S.g.innings && S.R[1] > S.R[0]) S.over = true;
}
function endHalf(S, called) {
  const side = S.half;
  S.lob[side][S.inn - 1] = [1, 2, 3].filter(b => S.bases[b]).length + S.waved;
  S.waved = 0;
  if (S.last) S.last.end = true;
  const text = `End of the ${side ? 'bottom' : 'top'} of the ${ord(S.inn)}${called ? ' (called)' : ''}: ${teamName(S.g, 0)} ${S.R[0]}, ${teamName(S.g, 1)} ${S.R[1]}.`;
  S.plays.push({ i: S.i, inn: S.inn, half: side, text, kind: 'end', runs: 0 });
  if (!S.hold && S.inn >= S.g.innings) {
    if (side === 0 && S.R[1] > S.R[0]) S.over = true;
    if (side === 1 && S.R[0] !== S.R[1]) S.over = true;
  }
  S.hold = false;
  S.bases = [null, null, null, null];
  S.outs = 0; S.b = 0; S.s = 0; S.seq = '';
  if (S.over) { S.between = true; return; }
  nextHalf(S);
}
function nextHalf(S) {
  S.between = false;
  S.half = 1 - S.half;
  if (S.half === 0) S.inn++;
  const h = S.half, n = S.inn - 1;
  S.line[h][n] = 0; S.hInn[h][n] = 0; S.eInn[h][n] = 0;
  S.col = { k: 0, used: new Set() };
  S.last = null;
}

// ---------- what the buttons suggest ----------
const on = (S, b) => !!S.bases[b];
// A runner on base b has to run when the batter does: every base behind them is taken.
function forced(S, b) { for (let x = 1; x < b; x++) if (!on(S, x)) return false; return true; }
export const runnersOn = S => [3, 2, 1].filter(b => on(S, b));

// Where everyone most likely ends up after a play. The scorer sees this and changes what didn't happen.
export function suggest(S, code) {
  const R = RESULTS[code], rs = runnersOn(S), m = [];
  const all = fn => { for (const b of rs) m.push([b, fn(b)]); };
  const lead = on(S, 1) ? 1 : rs[0];
  switch (code) {
    case '1B': case '2B': case '3B': case 'HR':
      m.push([0, R.go]); all(b => Math.min(4, b + R.go)); break;
    case 'BB': case 'IBB': case 'HBP': case 'CI': case 'KD':
      m.push([0, 1]); all(b => (forced(S, b) ? b + 1 : b)); break;
    case 'E':
      m.push([0, 1]); all(b => Math.min(4, b + 1)); break;
    case 'FC':
      m.push([0, 1]); all(b => (b === lead ? 0 : forced(S, b) ? b + 1 : b)); break;
    case 'GO':
      m.push([0, 0]); all(b => (forced(S, b) ? b + 1 : b)); break;
    case 'SF':
      m.push([0, 0]); all(b => (b === 3 ? 4 : b)); break;
    case 'SAC':
      m.push([0, 0]); all(b => Math.min(4, b + 1)); break;
    case 'DP':
      m.push([0, 0]); all(b => (b === lead ? 0 : on(S, 1) && forced(S, b) ? b + 1 : b)); break;
    case 'TP': {
      const outs = on(S, 1) ? [1, ...rs.filter(b => b !== 1).slice(-1)] : rs.slice(0, 2);
      m.push([0, 0]); all(b => (outs.includes(b) ? 0 : b)); break;
    }
    default:
      m.push([0, 0]); all(b => b);
  }
  // Never more than three outs: keep the lead runners safe first.
  let extra = S.outs + m.filter(x => x[1] === 0).length - 3;
  for (const x of [...m].sort((a, b) => a[0] - b[0])) if (extra > 0 && x[1] === 0 && x[0] !== 0) { x[1] = x[0]; extra--; }
  // The third out ends it: the other runners stay where they were, and nobody scores (OBR 5.08(a)).
  if (S.outs + m.filter(x => x[1] === 0).length >= 3) for (const x of m) if (x[0] && x[1]) x[1] = x[0];
  return m;
}

// What's wrong with a set of moves, in words, or '' if they could have happened.
export function check(S, moves) {
  const want = [0, ...runnersOn(S)];
  for (const b of want) if (!moves.some(m => m[0] === b)) return `Say where the ${b ? 'runner on ' + BASE[b] : 'batter'} ended up.`;
  const taken = {};
  for (const [from, to] of moves) {
    if (to !== 0 && to < from) return 'Runners can’t go back a base.';
    if (from > 0 && to === from) { if (taken[to]) return `Two runners can’t both be on ${BASE[to]}.`; taken[to] = 1; continue; }
    if (to >= 1 && to <= 3) { if (taken[to]) return `Two runners can’t both be on ${BASE[to]}.`; taken[to] = 1; }
  }
  const safe = moves.filter(m => m[1] !== 0).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < safe.length; i++) {
    const [, behind] = safe[i - 1], [, ahead] = safe[i];
    if (behind > ahead || (behind === ahead && ahead !== 4)) return 'A runner can’t pass the runner ahead of them.';
  }
  if (S.outs + moves.filter(m => m[1] === 0).length > 3) return 'That’s more than three outs.';
  return '';
}

// When a play makes the third out, do the runs that crossed on it count? Not if the batter was out before reaching
// first or the third out was a force; usually yes otherwise (a runner scores before another is tagged out, or
// before the batter is thrown out stretching a hit: OBR 5.08(a)). The scorer can say.
export function runsCount(S, code, moves) {
  const outs = S.outs + moves.filter(m => m[1] === 0).length;
  if (outs < 3) return true;
  if (moves.some(m => m[0] === 0 && m[1] === 0)) return RESULTS[code].kind !== 'out';
  return !['FC', 'DP', 'TP', 'GO'].includes(code);
}

// ---------- reading the state ----------
export function now(S) {
  const g = S.g, side = S.half, slot = S.up[side], fld = 1 - side;
  const p = S.pl[side][slot] || 0;
  const deck = (slot + 1) % S.size[side];
  return {
    side, fld, slot, p, player: player(g, side, slot, p), name: label(player(g, side, slot, p), slot),
    deck, deckName: label(player(g, side, deck, S.pl[side][deck] || 0), deck),
    pitcher: S.pit[fld], pitcherName: pitcherLabel(g, fld, S.pit[fld]), pitches: pstat(S, fld, S.pit[fld]).np,
  };
}
export function halfLabel(S) {
  if (S.over) return S.ended ? 'Called' : 'Final';
  return `${S.half ? 'Bottom' : 'Top'} ${ord(S.inn)}`;
}
// Innings to draw on the scorecard: the scheduled ones, plus any extras played.
export function innings(S) {
  return Math.max(S.g.innings, S.inn, S.line[0].length, S.line[1].length);
}
// The scorecard's columns for one side: one per inning, and another when a team bats around.
export function columns(S, side) {
  const out = [];
  for (let inn = 1; inn <= innings(S); inn++) for (let k = 0; k <= (S.extra[side][inn - 1] || 0); k++) out.push({ inn, k });
  return out;
}
export const batKey = key;
export const pitchStat = (S, side, i) => S.pitching[side][i] || { np: 0, balls: 0, str: 0, bf: 0, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0, hbp: 0, wp: 0, bk: 0 };
export const ip = outs => Math.floor(outs / 3) + (outs % 3 ? '.' + (outs % 3) : '');
