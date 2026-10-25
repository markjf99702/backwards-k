// The rules of keeping score. A game is a list of events (pitches, plate appearances, runner moves, substitutions);
// replay() reads them in order and works out everything on screen: the count, outs, runners, the score by inning,
// each batter's box on the scorecard, the box score and the play-by-play. Undo is just dropping the last event.
//
// Sides: 0 is the visitors (they bat in the top of each inning), 1 is the home team.
// Bases: 1, 2 and 3 are the bags, 0 is the batter at the plate, 4 is home (a run).
// A move is [from, to, how?, fielders?]; to 0 means out. On a plate appearance, how says where a runner (or the batter)
// put out was put out, '@3' for third (else the next base, or the one after his hit), and how one who got further than
// the play usually takes him did it: 'T' on the throw, 'E' on an error by fielders[0], or '' on the play itself.

export const POS = ['', 'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
export const POS_NAME = ['', 'pitcher', 'catcher', 'first baseman', 'second baseman', 'third baseman', 'shortstop', 'left fielder', 'center fielder', 'right fielder'];
// Where a ball went (to WHERE) and who threw it (FROM): flies out to center; short to first.
const WHERE = ['', 'the pitcher', 'the catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
const FROM = ['', 'pitcher', 'catcher', 'first', 'second', 'third', 'short', 'left', 'center', 'right'];
export const BASE = ['home', 'first', 'second', 'third', 'home'];

// kind: hit, on (safe without a hit) or out. go: the base the batter reaches. ab: counts as an at-bat.
// pitch: what the last pitch was when this is tapped without counting it first (x in play, b ball, s strike).
// f: fielders to ask for (0 none, 1 one, 2 a sequence such as 6-4-3). rbi: 0 when runs on it earn no RBI. err: the
// fielding team is charged with an error.
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
  CI: { label: 'Catcher’s interference', kind: 'on', go: 1, ab: 0, pitch: 'x', f: 0, say: 'reaches on catcher’s interference', err: 1 },
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

// Each pitch in words, from the letters kept for an at-bat (b ball, c called strike, s swinging, f foul, x in play).
export const PITCH = { b: 'ball', c: 'called strike', s: 'swinging strike', f: 'foul', x: 'in play' };
export const pitchWords = seq => [...seq].map(k => PITCH[k]).filter(Boolean).join(', ');

// Names in a list, as said: "Ruiz", "Ruiz and Okafor", "Ruiz, Okafor and Brennan".
const list = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a.at(-1));
export const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const dash = f => (f && f.length ? f.join('-') : '');
// A hit for so many bases.
const HITS = ['', '1B', '2B', '3B'];

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
// upTo: how many of the events to play, for the game as it stood earlier (the batters added later are left out of
// the order until they're added).
export function replay(g, upTo = g.ev.length) {
  const adds = [0, 0];
  for (const e of g.ev) if (e.t === 'add') adds[e.s]++;
  const S = {
    g, i: 0, inn: 1, half: 0, outs: 0, b: 0, s: 0, seq: '',
    bases: [null, null, null, null],
    size: [0, 1].map(t => Math.max(1, g.teams[t].lineup.length - adds[t])),
    up: [0, 0],
    pl: [0, 1].map(t => g.teams[t].lineup.map(() => 0)),
    been: [0, 1].map(t => g.teams[t].lineup.map(() => new Set([0]))), // everyone who has been in each slot
    pit: [0, 0],
    line: [[0], []], hInn: [[0], []], eInn: [[0], []], lob: [[], []],
    R: [0, 0], H: [0, 0], E: [0, 0],
    errs: [[], []], // each team's errors in order: the fielder's number, 0 when not given, or 'CI'
    cells: [], extra: [[], []], col: { k: 0, used: new Set() }, last: null,
    plays: [], text: [], bat: {}, pitching: [[], []],
    over: false, ended: false, hold: false, between: false, batted: [false, false],
    why: '', // why the scorer ended it: 'rule' (a run rule) or 'time' (a time limit), else '' (called: rain, darkness)
    mercy: null, // the league's mercy rule ended it: { by: runs ahead, inn: innings played, '4' or '3½' }
    delayed: false, // play is stopped for a delay: the game waits, and goes on as it was

    fresh: false, // a half-inning has just started and nothing has happened in it yet
    relief: null, // the pitcher a walk goes to, when a new one came in with the batter ahead in the count
    ph: null, // the batter who left with two strikes, for a pinch hitter's strikeout
    waved: 0, // runners this half-inning who crossed the plate on the third out but didn't count: left on base
    upTo, // how many events are played: what comes after the one being played, for goesOn()
  };
  for (let i = 0; i < upTo; i++) { S.i = i; step(S, g.ev[i]); }
  S.i = upTo;
  // Over in the middle of a half-inning (a walk-off, or called): it ends here, with the runners still on.
  if (S.over && !S.between) {
    S.lob[S.half][S.inn - 1] = [1, 2, 3].filter(b => S.bases[b]).length + S.waved;
    if (S.last) S.last.end = true;
  }
  return S;
}

// What happens in a game, as opposed to who's in it.
const PLAY = new Set(['p', 'pa', 'r', 'eoh']);

// Whether the game with other settings (g2: other league rules, or another inning for the runner on second) plays
// back the same up to its last play: each play made from the same inning, half, outs, score and runners, with the
// game going on or over the same. A run limit a half-inning already went past (or was ended at by hand), a mercy
// rule the game already went past, or a runner on second in an inning already played would change plays already
// scored, and move every play after them to the other team. The last play can come out differently: that's the new
// rules taking effect now.
export function sameSoFar(g, g2) {
  const A = replay(g, 0), B = replay(g2, 0), at = S => [S.inn, S.half, S.outs, S.over, ...S.R, ...S.bases.map(Boolean)].join();
  A.upTo = B.upTo = g.ev.length;
  for (let i = 0; i < g.ev.length; i++) {
    if (PLAY.has(g.ev[i].t) && at(A) !== at(B)) return false;
    A.i = B.i = i; step(A, g.ev[i]); step(B, g2.ev[i]);
  }
  return true;
}

function step(S, e) {
  const g = S.g;
  // A play after the final (fewer innings set since it was scored, or an older game): play went on, so it counts
  // for the team that was batting.
  if (S.over && S.between && PLAY.has(e.t)) resume(S);
  // A play during a delay: play went on.
  if (S.delayed && PLAY.has(e.t)) S.delayed = false;
  // (A kind of event or pitch from a newer version is passed over: see model.js.)
  switch (e.t) {
    case 'p': return ['b', 'c', 's', 'f'].includes(e.k) ? pitch(S, e.k) : undefined;
    case 'pa': return pa(S, e);
    case 'r': return runners(S, e);
    case 'sub': {
      const old = S.pl[e.s][e.slot];
      // A pinch hitter with two strikes already on: if he strikes out, it's the first batter's (OBR 9.15(b)).
      if (e.ty === 'ph' && e.s === S.half && e.slot === S.up[e.s] && S.s === 2) S.ph ??= old;
      S.pl[e.s][e.slot] = e.i;
      // A substitute for a player who's on base runs for him, whatever the change was called (OBR 5.10): the runs he
      // scores are the substitute's.
      for (const b of [1, 2, 3]) {
        const r = S.bases[b];
        if (r && r.side === e.s && r.slot === e.slot && (e.ty === 'pr' || r.p === old)) r.p = e.i;
      }
      const a = label(player(g, e.s, e.slot, e.i), e.slot), was = label(player(g, e.s, e.slot, old), e.slot);
      // Someone who was in this spot before: a starter re-entering, or the runner who ran for him.
      const been = S.been[e.s][e.slot], back = !!been && been.has(e.i);
      if (been) been.add(e.i);
      const verb = back ? 'comes back in for' : e.ty === 'ph' ? 'pinch-hits for' : e.ty === 'pr' ? 'pinch-runs for' : 'comes in for';
      return note(S, `${a} ${verb} ${was}.`, 'sub');
    }
    case 'pch':
      // A new pitcher with the batter ahead, 2-0, 2-1, 3-0, 3-1 or 3-2: if that batter walks, the walk and the batter
      // are the pitcher's who left (OBR 9.16(h)).
      if (e.s === 1 - S.half) S.relief = S.b >= 2 && S.b > S.s ? S.relief ?? S.pit[e.s] : null;
      S.pit[e.s] = e.i;
      // A pitcher brought in before anything has happened in the half-inning starts it, so the runner put on second
      // to start an extra inning is his, not the one's who left (OBR 7.01(b), 9.16(g)).
      if (S.fresh && e.s === 1 - S.half) for (const r of S.bases) if (r && r.cell.auto) r.pi = r.cell.pi = e.i;
      {
        // The starter, or someone who pitched earlier, comes back in; anyone else is new.
        const back = !e.i || g.ev.slice(0, S.i).some(x => x.t === 'pch' && x.s === e.s && x.i === e.i), who = pitcherLabel(g, e.s, e.i);
        return note(S, `${teamName(g, e.s)} bring ${back ? `${who} back in` : `in ${who}`} to pitch.`, 'sub');
      }
    case 'add':
      S.size[e.s]++;
      // Added just as the order came back round to the top: the new batter is up first.
      if (S.up[e.s] === 0 && S.batted[e.s]) S.up[e.s] = S.size[e.s] - 1;
      return note(S, `${teamName(g, e.s)} add a batter to the order.`, 'sub');
    case 'eoh':
      S.text[S.i] = `Ended the ${S.half ? 'bottom' : 'top'} of the ${ord(S.inn)} early.`;
      return endHalf(S, 'early');
    case 'end':
      if (S.fresh) unstart(S);
      // (A reason from a newer version reads as called.)
      S.over = true; S.ended = true; S.delayed = false; S.why = Object.hasOwn(ENDS, e.why) ? e.why : '';
      return note(S, S.why ? ENDS[S.why].text : 'The game is called.', 'end');
    case 'delay':
      if (S.over) return;
      S.delayed = true;
      return note(S, 'Play stops for a delay.', 'sub');
    case 'on':
      if (S.delayed) { S.delayed = false; return note(S, 'Play resumes.', 'sub'); }
      note(S, 'Play goes on.', 'sub');
      return resume(S);
  }
}

// Why the scorer can end a game before its last out, besides calling it: a run rule or a time limit. Either way the
// game is complete, and reads Final.
export const ENDS = {
  rule: { text: 'The game is over on the run rule.', short: 'run rule' },
  time: { text: 'The game is over on the time limit.', short: 'time limit' },
};

// Keep playing, after the game was over or called. After a final, the half-inning is played out (the home team
// going ahead doesn't end it again) and the game ends when it's over; a game ended by hand goes on as usual, and one
// ended by hand while a half after the final was being played out goes on playing it out.
function resume(S) {
  S.hold = S.hold || (S.over && !S.ended);
  S.over = false; S.ended = false; S.why = ''; S.mercy = null;
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
// (ur: the runs charged that are unearned because the runner was put on second to start an extra inning.)
function pstat(S, side = 1 - S.half, i = S.pit[side]) {
  return S.pitching[side][i] ||= { np: 0, balls: 0, str: 0, bf: 0, outs: 0, h: 0, r: 0, ur: 0, bb: 0, k: 0, hr: 0, hbp: 0, wp: 0, bk: 0 };
}

function pitch(S, k) {
  S.fresh = false;
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
  const g = S.g, side = S.half, fld = 1 - side, slot = S.up[side], p = S.pl[side][slot];
  if (!RESULTS[e.r]) return;
  const moves = (e.m || suggest(S, e.r)).slice().sort((a, b) => b[0] - a[0]);
  // A hit that wins the game counts for the bases the winning run needed, and nobody behind that run gets further
  // (OBR 9.06(f)): with the bases loaded, a double that wins it is a single.
  const need = winningRun(S, e.r, moves, e.x), code = creditedHit(e.r, need, moves), R = RESULTS[code];
  S.fresh = false;
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
    n: S.cells.length, side, slot, p, pi: S.pit[fld], inn: S.inn, k: S.col.k, r: code, f: e.f || null, mark: mark(code, e.f),
    count: [Math.min(S.b, 3), Math.min(S.s, 2)], seq: S.seq, ev: S.i, reach: 0, notes: ['', '', '', '', ''],
    outN: 0, outAt: 0, outHow: '', scored: false, rbi: 0, end: false, text: '', story: [],
  };
  S.cells.push(cell);

  // Whose at-bat it was, and which pitcher faced him: usually the ones there now (OBR 9.15(b), 9.16(h)).
  const B = bstat(S, side, slot, R.k && S.ph != null ? S.ph : p);
  const pi = R.bb && S.relief != null ? S.relief : S.pit[fld], F = pstat(S, fld, pi);
  B.pa++; B.ab += R.ab;
  if (R.bb) { B.bb++; F.bb++; }
  if (R.k) { B.k++; P.k++; }
  if (R.hbp) { B.hbp++; P.hbp++; }
  F.bf++;
  if (R.kind === 'hit') {
    B.h++; P.h++; S.H[side]++; S.hInn[side][S.inn - 1]++;
    if (R.go === 2) B.d++; else if (R.go === 3) B.t++; else if (R.go === 4) { B.hr++; P.hr++; }
  }
  if (R.err) { S.E[fld]++; S.eInn[side][S.inn - 1]++; S.errs[fld].push(e.r === 'CI' ? 'CI' : (e.f && e.f[0]) || 0); }

  // A 6-4-3 double play: the runner was out 6-4 and the batter 4-3, so the runner's box gets the throws before the
  // last. (With two runners out, or two fielders, there's no telling: each keeps the whole play.)
  const split = (e.r === 'DP' || e.r === 'TP') && e.f && e.f.length >= 3 && moves.some(m => !m[0] && !m[1])
    && moves.filter(m => m[0] && !m[1]).length === 1;
  const runnerF = dash(split ? e.f.slice(0, -1) : e.f);
  const batter = { cell, side, slot, p, pi };
  const batterName = label(player(g, side, slot, p), slot);
  // Everyone who scores is in one sentence, where the first of them would be: "Okafor, Brennan and Castillo score."
  // The same for runs that don't count. The winning run, when a runner brings it in, is said last.
  const bits = [], scored = {}, waved = [], past = [];
  const together = (names, one, more) => { if (!names.length) bits.push(() => `${list(names)} ${names.length > 1 ? more : one}`); };
  let runs = 0, bOut = false, bTo = R.go, bAt = 0, bWhy = '', handed = null;
  // A league's run limit: the runs that can still count this half-inning, on this play.
  const cap = room(S);
  // Where the play usually takes each runner, to tell one who got further on the throw or on an error.
  const plan = suggest(S, e.r), usual = from => usualBase(S, e.r, from, plan);
  // Errors on the way (a runner who took an extra base on one): one for each fielder who made one (OBR 9.12), besides
  // the one the play itself was (E6).
  const errBy = new Set();
  // (A play from a file that lists someone twice moves them once: the first time.)
  const moved = new Set();
  let rbi = 0, lastWhy = null;
  for (const [from, was, how, hf] of moves) {
    const r = from === 0 ? batter : S.bases[from];
    if (!r || moved.has(from)) continue;
    moved.add(from);
    const to = need && was ? Math.min(was, from + need) : was;
    if (from) S.bases[from] = null;
    // A batter who reaches without a hit while a runner another pitcher let on is put out takes that runner's place:
    // he's that pitcher's (OBR 9.16(g)). The runners go first, so the batter comes last.
    if (from && to === 0 && handed == null && r.pi !== S.pit[fld]) handed = r.pi;
    if (!from && to && handed != null && R.kind !== 'hit') r.pi = handed;
    const who = label(player(g, side, r.slot, r.p), r.slot);
    // Further than the play usually takes him, on the throw or on an error (by fielder ef, 0 when not said).
    const u = usual(from), extra = to > u && (how === 'T' || how === 'E'), ef = extra && how === 'E' ? (hf && hf[0]) || 0 : null;
    const why = !extra ? '' : how === 'T' ? ' on the throw' : ` on an error by the ${POS_NAME[ef] || 'fielder'}${ef ? ` (E${ef})` : ''}`;
    if (ef != null) errBy.add(ef);
    if (from === 0) { bTo = to; bWhy = why; }
    if (to === 0) {
      if (from === 0) {
        bOut = true;
        // Out on a ball that would have put them on (thrown out stretching a single): the path to the base before the
        // one he was out at, then out. On a home run (a missed base, on appeal) the whole way round.
        if (R.kind !== 'out') { bAt = outAt(0, how, R); reach(cell, 0, bAt - 1, ''); out(S, r, bAt, ''); }
        else out(S, r, 0, '');
      } else {
        // Out at the next base, or one further on (from first, thrown out at third: second was his on the way).
        const at = outAt(from, how, R);
        if (at - 1 > from) reach(r.cell, from, at - 1, String(slot + 1));
        out(S, r, at, runnerF);
        bits.push(`${who} is out at ${BASE[at]}`);
        r.cell.story.push(`Out at ${BASE[at]} on ${batterName}’s ${R.label.toLowerCase()}.`);
      }
    } else if (to === 4 && e.x) {
      // The third out came first (or was a force): the run doesn't count, and the runner counts as left on base.
      S.waved++;
      together(waved, 'crosses the plate, but the run doesn’t count', 'cross the plate, but the runs don’t count');
      waved.push(who);
      r.cell.story.push('Crossed the plate, but the run doesn’t count.');
    } else if (to === 4 && runs >= cap) {
      // Past the league's run limit for a half-inning: the run doesn't count, and the runner is left on base.
      overLimit(S, r, from, who, past, together);
    } else {
      // The extra base goes on the card as it's done on paper: the batter's number where the play took him, then T
      // (on the throw) or the error, E9, at the base he went on to.
      const num = from ? String(slot + 1) : '';
      if (extra) { reach(r.cell, from, u, num); reach(r.cell, u, to, how === 'T' ? 'T' : 'E' + (ef || '')); }
      else reach(r.cell, from, to, num);
      const on = `${batterName}’s ${R.label.toLowerCase()}${why ? ',' + why : ''}`;
      if (to === 4) {
        score(S, r);
        runs++;
        // A run that scores because of an error earns no RBI (OBR 9.04(a)).
        if (ef == null) rbi++;
        if (from) {
          // Everyone who scored the same way in one sentence: "Okafor and Brennan score on the throw."
          if (!scored[why]) { const names = scored[why] = [], w = why; bits.push(() => scorers(names, need > 0 && need < 4 && w === lastWhy, w)); }
          scored[why].push(who);
          lastWhy = why;
          r.cell.story.push(`Scored on ${on}.`);
        }
      } else {
        S.bases[to] = r;
        if (from && to > from) { bits.push(`${who} to ${BASE[to]}${why}`); r.cell.story.push(`To ${BASE[to]} on ${on}.`); }
      }
    }
  }
  if (rbi && R.rbi !== 0) { cell.rbi = rbi; B.rbi += rbi; }
  const own = R.err ? (e.r === 'CI' ? 'CI' : (e.f && e.f[0]) || 0) : null;
  for (const f of errBy) if (f !== own) { S.E[fld]++; S.eInn[side][S.inn - 1]++; S.errs[fld].push(f); }

  let text = `${batterName} ${R.say}${fielderWords(code, e.f)}`;
  if (R.kind !== 'out' && bOut) text += R.go === 4 ? ', but is called out on the bases' : `, but is out trying for ${BASE[bAt]}`;
  else if (R.kind !== 'out' && bTo > R.go && bTo < 4) text += ` and takes ${BASE[bTo]}${bWhy}`;
  else if (R.kind !== 'out' && bTo === 4 && R.go < 4) text += ` and comes all the way home${bWhy}${need === 4 ? ' with the winning run' : ''}`;
  else if (R.kind === 'out' && !bOut && bTo > 0) text += ` but reaches ${BASE[bTo]}${bWhy}`;
  text += '.' + (bits.length ? ' ' + sentences(bits) + '.' : '');
  if (code !== e.r) text += ` ${credit(e.r, code)}`;
  const full = (runs || past.length) && S.outs < 3 && limited(S);
  if (full) text += ' ' + limitWords(S);
  cell.text = text;
  S.text[S.i] = text;
  S.plays.push({ i: S.i, inn: S.inn, half: side, text, kind: 'pa', runs, cell: cell.n, r: code });

  S.b = 0; S.s = 0; S.seq = ''; S.relief = null; S.ph = null;
  S.up[side] = (slot + 1) % S.size[side];
  S.last = cell;
  walkoff(S);
  if (S.outs >= 3 || (full && !S.over)) endHalf(S, S.outs >= 3 ? '' : 'limit');
}

// ---------- league rules ----------
// A game's league rules (g.rules, see model.js), when it has them: runs, the most a team can score in a half-inning
// (0 for no limit), and last, whether that holds in the last inning (and extra innings) too; all, whether every run
// on the play that reaches it counts (else the run that reaches it is the last); mercy, [[innings, runs ahead]]: the
// game is over when a team is that far ahead after that many innings (half an inning sooner when it's the home team,
// which doesn't need its turn).
// How many more runs can count this half-inning (Infinity with no limit, or when every run on the play counts).
function room(S) {
  const r = S.g.rules;
  if (!r || !r.runs || r.all || (!r.last && S.inn >= S.g.innings)) return Infinity;
  return Math.max(0, r.runs - (S.line[S.half][S.inn - 1] || 0));
}
// The batting team has its limit of runs for the half-inning.
function limited(S) {
  const r = S.g.rules;
  return !!r && r.runs > 0 && (r.last || S.inn < S.g.innings) && (S.line[S.half][S.inn - 1] || 0) >= r.runs;
}
// "That's 5 runs: the half-inning is over." (Past the limit, when every run on the play counts.)
function limitWords(S) {
  const n = S.line[S.half][S.inn - 1], max = S.g.rules.runs;
  return `That’s ${n} runs${n > max ? `, past the ${max}-run limit` : ''}: the half-inning is over.`;
}
// A runner who crosses the plate after the run that reached the limit: the run doesn't count, and he counts as left
// on base. His box shows the way round, without the run.
function overLimit(S, r, from, who, past, together) {
  S.waved++;
  reach(r.cell, from, 4, '');
  together(past, `crosses the plate too, but the ${S.g.rules.runs}-run limit was reached, so the run doesn’t count`, `cross the plate too, but the ${S.g.rules.runs}-run limit was reached, so the runs don’t count`);
  past.push(who);
  r.cell.story.push(`Crossed the plate after the ${S.g.rules.runs}-run limit was reached: the run doesn’t count.`);
}
// The game is over on the league's mercy rule: after the top of an inning, the home team that far ahead; after the
// bottom, or the moment the home team gets that far ahead in it, either team (Little League 4.10(e)). Not while a
// half-inning after the final is played out (Keep playing) until it ends. Returns { by, inn } or null.
function mercy(S, ended) {
  const r = S.g.rules;
  if (!r || !r.mercy || (!ended && (S.hold || S.half !== 1))) return null;
  const lead = S.half === 0 || !ended ? S.R[1] - S.R[0] : Math.abs(S.R[1] - S.R[0]);
  for (const [n, by] of r.mercy) if (S.inn >= n && lead >= by) return { by, inn: S.half === 0 ? `${S.inn - 1}½` : String(S.inn) };
  return null;
}
// The game ends on it, and the play that ended it and the play-by-play say so: "That's the game on the 10-run rule:
// the Comets lead 11–1 after 4 innings."
function mercyEnds(S) {
  const w = S.R[1] > S.R[0] ? 1 : 0, m = S.mercy;
  const text = `That’s the game on the ${m.by}-run rule: the ${teamName(S.g, w)} lead ${S.R[w]}–${S.R[1 - w]} after ${m.inn} inning${m.inn === '1' ? '' : 's'}.`;
  S.over = true;
  S.text[S.i] += ' ' + text;
  S.plays.push({ i: S.i, inn: S.inn, half: S.half, text, kind: 'end', runs: 0 });
}

// A play's sentences, joined. A sentence that lists everyone who scored is a function, written out once they're all
// known.
const sentences = bits => bits.map(b => (typeof b === 'function' ? b() : b)).join('. ');
// Everyone who scored, in one sentence, with the one who brought in the winning run last (win): "Okafor scores, and
// Brennan scores the winning run." why: what they scored on, " on a wild pitch".
function scorers(names, win, why = '') {
  const n = win ? names.slice(0, -1) : names, words = n.length ? `${list(n)} ${n.length > 1 ? 'score' : 'scores'}${why}` : '';
  if (!win) return words;
  return words ? `${words}, and ${names.at(-1)} scores the winning run` : `${names.at(-1)} scores the winning run${why}`;
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
  S.fresh = false;
  const g = S.g, side = S.half, fld = 1 - side;
  const moves = e.m.slice().sort((a, b) => b[0] - a[0]);
  // Runners who score for the same reason are in one sentence: "Ruiz and Okafor score on a wild pitch."
  const bits = [], scored = {};
  let runs = 0, err = null;
  const balk = moves.length && moves.every(m => m[2] === 'BK');
  // (From a file: a runner listed twice moves once, and nothing happens after the third out.)
  const moved = new Set(), past = [], cap = room(S);
  // The run that puts the home team ahead in its last turn ends the game: nobody behind it gets further than the
  // bases it took (need), and it's said last, as the winning run (win).
  const live = !S.over && S.R[1] <= S.R[0];
  let need = 0, win = null, mk = '';
  for (const [from, was, how, f] of moves) {
    const r = S.bases[from];
    if (!r || moved.has(from) || S.outs >= 3) continue;
    moved.add(from);
    const to = need && was ? Math.min(was, from + need) : was;
    // Someone who didn't move is still on that base (the runners ahead go first): this runner stays put.
    if (to >= 1 && to <= 3 && to !== from && S.bases[to]) continue;
    S.bases[from] = null;
    const who = label(player(g, side, r.slot, r.p), r.slot), m = runMark(how, f);
    mk ||= m; // the play's mark in the play-by-play: the first of its moves' (SB, WP, CS 2-6)
    if (how === 'E' && !err) err = f && f[0] ? f : [0];
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
      const why = how === 'WP' ? ' on a wild pitch' : how === 'PB' ? ' on a passed ball' : how === 'E' ? ` on an error by the ${POS_NAME[f && f[0]] || 'fielder'}${f && f[0] ? ` (E${f[0]})` : ''}` : '';
      const said = balk ? '' : why;
      if (to === 4 && runs >= cap) { overLimit(S, r, from, who, past, (names, one, more) => { if (!names.length) bits.push(() => `${list(names)} ${names.length > 1 ? more : one}`); }); continue; }
      if (to === 4) { score(S, r); runs++; } else S.bases[to] = r;
      const winning = to === 4 && live && !need && won(S) && !goesOn(S);
      if (winning) need = 4 - from;
      if (to === 4 && how !== 'SB') {
        if (winning) win = said;
        if (!scored[said]) { const names = scored[said] = []; bits.push(() => scorers(names, win === said, said)); }
        scored[said].push(who);
      } else bits.push(`${who} ${to === 4 ? `steals home${winning ? ' with the winning run' : ''}` : `${how === 'SB' ? 'steals' : 'moves to'} ${BASE[to]}`}${said}`);
      r.cell.story.push(`${how === 'SB' && to === 4 ? 'Stole home' : to === 4 ? 'Scored' : how === 'SB' ? 'Stole ' + BASE[to] : 'Moved to ' + BASE[to]}${balk ? ' on a balk' : why}.`);
    }
  }
  // One wild throw is one error, and one wild pitch is one, however many runners move up on it (OBR 9.12).
  if (err) { S.E[fld]++; S.eInn[side][S.inn - 1]++; S.errs[fld].push(err[0]); }
  if (moves.some(m => m[2] === 'WP')) pstat(S).wp++;
  if (balk) pstat(S).bk++;
  const full = (runs || past.length) && S.outs < 3 && limited(S);
  const text = (balk ? 'Balk. ' : '') + (bits.length ? sentences(bits) + '.' : '') + (full ? ' ' + limitWords(S) : '');
  S.text[S.i] = text;
  S.plays.push({ i: S.i, inn: S.inn, half: side, text, kind: 'run', runs, mark: mk });
  walkoff(S);
  if (S.outs >= 3 || (full && !S.over)) endHalf(S, S.outs >= 3 ? '' : 'limit');
}

// Where someone put out on a batted ball was put out: the base the scorer picked (a move's how, '@3' for third), or else
// the next one, or for the batter the one after his hit (thrown out stretching a single: at second). R: the play.
export function outAt(from, how, R) {
  const d = from ? from + 1 : Math.min((R.go || 1) + 1, 4), b = /^@[2-4]$/.test(how || '') ? +how[1] : 0;
  return b > (from || R.go || 1) ? b : d;
}
// The bases someone put out on a batted ball could have been put out at, when there's a choice: from first, second,
// third or home; for the batter after a single, second, third or home. (After a triple only home, and the batter out
// on an out is out at first.)
export function outBases(from, R) {
  if (!from && R.kind === 'out') return [];
  const lo = from ? from + 1 : Math.min((R.go || 1) + 1, 4), out = [];
  for (let b = lo; b <= 4; b++) out.push(b);
  return out.length > 1 ? out : [];
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
  const P = pstat(S, 1 - side, r.pi);
  P.r++;
  // The runner put on second to start an extra inning scores an unearned run (OBR 7.01(b)).
  if (r.cell.auto) P.ur++;
}

// The home team is ahead in its last turn (or an extra inning): the game is over (OBR 7.01(g)). Not while the scorer
// plays out a half-inning after the final (Keep playing).
const won = S => !S.hold && S.half === 1 && S.inn >= S.g.innings && S.R[1] > S.R[0];
function walkoff(S) {
  if (won(S)) S.over = true;
  // Or the home team, batting, gets far enough ahead for the league's mercy rule.
  else if (!S.over && (S.mercy = mercy(S, false))) mercyEnds(S);
}
// The hit a batter gets when it wins the game: no more bases than the winning run took (need), when he made it that
// far (OBR 9.06(f)). A home run is still a home run.
export function creditedHit(code, need, moves) {
  const R = RESULTS[code];
  return need && R.kind === 'hit' && need < R.go && !moves.some(m => m[0] === 0 && m[1] === 0) ? HITS[need] : code;
}
// Why a hit that won the game is scored as less: "It went for a double, but counts as a single: the winning run
// needed only one base."
export const credit = (code, as) => `It went for a ${RESULTS[code].label.toLowerCase()}, but counts as a ${RESULTS[as].label.toLowerCase()}: the winning run needed only ${['', 'one base', 'two bases'][RESULTS[as].go]}.`;
// On a play in the home team's last turn, how many bases the run that puts it ahead takes, from where it was (0 when
// none does): the game ends as it scores, so nobody behind it gets further than that, and a hit counts for that many
// bases (OBR 5.08(b), 9.06(f)). Not on a home run, when everyone scores (9.06(g)), nor when the runs on the play
// don't count (x), nor in a half-inning played out after the final, nor when play went on after it (goesOn()).
export function winningRun(S, code, moves, x) {
  if (S.over || S.hold || S.half !== 1 || S.inn < S.g.innings || S.R[1] > S.R[0] || code === 'HR' || x) return 0;
  let runs = S.R[1];
  const seen = new Set();
  for (const [from, to] of moves.slice().sort((a, b) => b[0] - a[0])) {
    if (seen.has(from) || (from && !S.bases[from])) continue;
    seen.add(from);
    if (to === 4 && ++runs > S.R[0]) return goesOn(S) ? 0 : 4 - from;
  }
  return 0;
}
// Play went on after the event being played: Keep playing (for a league that plays the inning out), or plays scored
// after it in a game from an older version. The half-inning was played out, so the run that put the home team ahead
// didn't end it, and every run on the play counts, as it did before Keep playing was tapped.
function goesOn(S) {
  for (let j = S.i + 1; j < S.upTo; j++) if (S.g.ev[j].t === 'on' || PLAY.has(S.g.ev[j].t)) return true;
  return false;
}
// how: '' after three outs, 'early' when the scorer ended it, 'limit' on the league's run limit.
function endHalf(S, how = '') {
  const side = S.half;
  S.lob[side][S.inn - 1] = [1, 2, 3].filter(b => S.bases[b]).length + S.waved;
  S.waved = 0;
  if (S.last) S.last.end = true;
  const why = how === 'early' ? ', ended early' : how === 'limit' ? `, on the ${S.g.rules.runs}-run limit` : '';
  const text = `End of the ${side ? 'bottom' : 'top'} of the ${ord(S.inn)}${why}: ${teamName(S.g, 0)} ${S.R[0]}, ${teamName(S.g, 1)} ${S.R[1]}.`;
  // The half-inning in numbers, as a broadcaster gives it: 0 runs, 2 hits, no errors, 3 left on base.
  const n = S.inn - 1, few = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`, err = S.eInn[side][n] || 0;
  const sum = `${few(S.line[side][n] || 0, 'run')}, ${few(S.hInn[side][n] || 0, 'hit')}, ${err ? few(err, 'error') : 'no errors'}, ${S.lob[side][n]} left on base.`;
  S.plays.push({ i: S.i, inn: S.inn, half: side, text, kind: 'end', runs: 0, sum });
  if (S.inn >= S.g.innings) {
    if (side === 0 && S.R[1] > S.R[0]) S.over = true;
    if (side === 1 && S.R[0] !== S.R[1]) S.over = true;
  }
  if (!S.over && (S.mercy = mercy(S, true))) mercyEnds(S);
  S.hold = false;
  S.bases = [null, null, null, null];
  S.outs = 0; S.b = 0; S.s = 0; S.seq = ''; S.relief = null; S.ph = null;
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
  S.fresh = true;
  if (S.g.tie && S.inn >= S.g.tie) placeRunner(S);
}
// Extra innings that start with a runner on second (g.tie, the first inning they do; OBR 7.01(b), in MLB since 2020):
// the player in the batting order just before the half-inning's leadoff batter. He didn't bat, so it's not a trip to
// the plate, but he has a box of his own in that inning, marked AR (the automatic runner), and a line in the plays.
// His run is unearned: for that, he reached on an error nobody made.
export const AUTO = { label: 'On second to start the inning', kind: 'on' };
function placeRunner(S) {
  const h = S.half, n = S.size[h];
  if (n < 2) return;
  const slot = (S.up[h] + n - 1) % n, p = S.pl[h][slot], pi = S.pit[1 - h], who = label(player(S.g, h, slot, p), slot);
  const cell = {
    n: S.cells.length, side: h, slot, p, pi, inn: S.inn, k: 0, r: 'AR', f: null, mark: 'AR', count: [0, 0], seq: '', ev: -1,
    reach: 2, from: 2, notes: ['', '', '', '', ''], outN: 0, outAt: 0, outHow: '', scored: false, rbi: 0, end: false,
    text: `${who} starts the ${ord(S.inn)} on second.`, story: [], auto: true,
  };
  S.cells.push(cell);
  S.col.used.add(slot);
  S.bases[2] = { cell, side: h, slot, p, pi };
  S.plays.push({ i: S.i, inn: S.inn, half: h, text: `Extra innings: ${who} starts on second.`, kind: 'run', runs: 0, mark: 'AR', auto: true });
}
// The game ended before anything happened in the half-inning that had just started (a mercy rule, rain between
// innings): nobody batted in it, so it comes off the line score, and the game stops after the half before it. Keep
// playing starts it again. Substitutions made in the meantime were made between the two.
function unstart(S) {
  const h = S.half, inn = S.inn;
  S.line[h].pop(); S.hInn[h].pop(); S.eInn[h].pop();
  // (And the runner put on second to start it, if it was an extra inning.)
  const here = x => x.auto && x.inn === inn && (x.side ?? x.half) === h;
  if (S.cells.some(here)) { S.cells = S.cells.filter(c => !here(c)); S.plays = S.plays.filter(p => !here(p)); S.bases = [null, null, null, null]; }
  S.half = 1 - h;
  if (h === 0) S.inn--;
  for (const p of S.plays) if (p.inn === inn && p.half === h) { p.inn = S.inn; p.half = S.half; }
  S.between = true; S.fresh = false;
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

// Where a play usually takes someone, past which he took an extra base (on the throw, or on an error): the batter, the
// base his hit or walk is for (first, on an out he was safe on); a runner, where suggest() has him, or when it has him
// out, the next base if he was forced to it, else his own. plan: suggest()'s moves, when they're at hand.
export function usualBase(S, code, from, plan = suggest(S, code)) {
  const R = RESULTS[code];
  if (!from) return R.kind === 'out' ? 1 : R.go;
  const t = (plan.find(x => x[0] === from) || [])[1];
  return t || (forced(S, from) ? from + 1 : from);
}

// What's wrong with a set of moves, in words, or '' if they could have happened. code: the play they're for, when
// it's known: a caught fly ball can't leave the batter safe, and nor can a strikeout with first base taken and fewer
// than two out (OBR 5.09(a)(3)). A sacrifice can: a bunt with everyone safe on an error is still a sacrifice (9.08(b)).
export function check(S, moves, code) {
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
  const batterSafe = moves.some(m => m[0] === 0 && m[1] !== 0);
  if (batterSafe && ['FO', 'LO', 'PU', 'SF'].includes(code)) return 'A caught fly ball is an out. If it was dropped, that’s an error: Cancel and tap E.';
  if (batterSafe && (code === 'K' || code === 'KL') && S.bases[1] && S.outs < 2) return 'No dropped third strike with a runner on first and fewer than two out.';
  return '';
}

// Whether a play Undo took back can go back in as it was, now that something else has gone in before it (a forgotten
// steal, say): '' if it can, else why not. at: how things stood when it was first made ({ half, inn, outs, over }).
// Nothing goes back into another half-inning than it was made in, or past the end of the game ('over'). A pitch goes
// back as it was. A plate appearance needs a result that could happen now ('result': a sacrifice, a sacrifice fly
// or a double play with fewer than two out, a triple play with nobody out and two on, a fielder's choice with someone
// on, a dropped third strike with first base open or two out), and, as can a runner's move, the same runners on,
// where they could all have gone ('runners'); one with runs crossing that ends the half-inning, now or when it was
// made, the same outs too (whether the runs counted was answered for those). A substitution needs its spot in the
// order ('gone').
export function fits(S, e, at) {
  if (S.half !== at.half || S.inn !== at.inn || S.over !== at.over) return 'over';
  if (e.t === 'pa' && RESULTS[e.r]) {
    const on = runnersOn(S).length;
    const not = { SF: !S.bases[3] || S.outs > 1, SAC: !on || S.outs > 1, DP: !on || S.outs > 1, TP: on < 2 || S.outs > 0, FC: !on, KD: !!S.bases[1] && S.outs < 2 };
    if (not[e.r]) return 'result';
    const m = e.m || suggest(S, e.r), from = [...new Set(m.map(x => x[0]))].sort().join();
    if (from !== [0, ...runnersOn(S)].sort().join() || check(S, m, e.r)) return 'runners';
    if (S.outs !== at.outs && m.some(x => x[1] === 4) && (e.x || S.outs + m.filter(x => x[1] === 0).length >= 3)) return 'runners';
  }
  if (e.t === 'r') {
    if (!e.m.length || !e.m.every(([b]) => S.bases[b])) return 'runners';
    // Where everyone on base ends up: nobody goes back, passes the runner ahead or shares a base, and no more than
    // three are out.
    const to = b => { const x = e.m.find(y => y[0] === b); return x ? x[1] : b; };
    let ahead = 5, outs = S.outs;
    for (const b of runnersOn(S)) {
      const t = to(b);
      if (!t) { outs++; continue; }
      if (t < b || (t < 4 && t >= ahead)) return 'runners';
      if (t < 4) ahead = t;
    }
    if (outs > 3) return 'runners';
  }
  if (e.t === 'sub' && !(e.slot < S.size[e.s])) return 'gone';
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

// What a play really was, from where everyone ended up. A fly ball or line drive caught in the outfield that brings
// the runner home from third with fewer than two out is a sacrifice fly, and a sacrifice fly the runner didn't score
// on is a fly out (OBR 9.08(d)). A bunt that puts out a runner but not the batter is a fielder's choice (9.08(c)).
// A double play is two outs and a triple play three: a double play that got three is a triple play, and a triple
// play that got two a double play. A double or triple play that got only the batter is a ground out (with an RBI for
// a run that scored on it, 9.04(a)(2)), and one that got only a runner, or nobody, a fielder's choice. A strikeout
// the batter reached base on is a dropped third strike, and a ground ball he was safe on a fielder's choice.
export function scoredAs(S, code, f, moves) {
  const batterOut = moves.some(m => m[0] === 0 && m[1] === 0), home = moves.some(m => m[0] === 3 && m[1] === 4);
  const deep = !f || !f.length || f[0] >= 7, outs = moves.filter(m => m[1] === 0).length;
  if (code === 'SF' && !home) return 'FO';
  if ((code === 'FO' || ((code === 'LO' || code === 'PU') && deep)) && S.outs < 2 && home && batterOut) return 'SF';
  if (code === 'SAC' && !batterOut && moves.some(m => m[0] > 0 && m[1] === 0)) return 'FC';
  if (code === 'DP' && outs === 3) return 'TP';
  if (code === 'TP' && outs === 2) return 'DP';
  if ((code === 'DP' || code === 'TP') && outs < 2) return outs && batterOut ? 'GO' : 'FC';
  if ((code === 'K' || code === 'KL') && !batterOut && (!S.bases[1] || S.outs >= 2)) return 'KD';
  if (code === 'GO' && !batterOut) return 'FC';
  return code;
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
// Where the game is, in a word or two: "Top 3rd", "Delayed, top 5th", "Final", "Final/10" after extra innings, as box
// scores put it, or "Called". A game ended on a run rule or a time limit is complete, so it's Final.
export function halfLabel(S) {
  if (S.over) return S.ended && !S.why ? 'Called' : S.inn > S.g.innings ? `Final/${S.inn}` : 'Final';
  const at = `${S.half ? 'Bottom' : 'Top'} ${ord(S.inn)}`;
  return S.delayed ? `Delayed, ${at.toLowerCase()}` : at;
}
// How many innings a called game needs to count (to be a regulation game): five of nine, or of seven (OBR 7.01(c),
// and high school's 4-2-2); four of six (Little League 4.10(c)); two thirds of a shorter game.
export const regulation = innings => (innings >= 7 ? 5 : Math.ceil(innings * 2 / 3));
// Whether a called game counts: it went that many innings, or half an inning fewer with the home team ahead (the
// home team doesn't need its last turn), OBR 7.01(c)(2).
export function official(S) {
  const n = regulation(S.g.innings), done = (S.inn - 1) * 2 + S.half + (S.between ? 1 : 0);
  return done >= 2 * n || (done >= 2 * n - 1 && S.R[1] > S.R[0]);
}
// Who won: 0 or 1, or null while the game goes on, for a tie, and for a game called before it counted.
export function winner(S) {
  if (!S.over || S.R[0] === S.R[1] || (S.ended && !S.why && !official(S))) return null;
  return S.R[1] > S.R[0] ? 1 : 0;
}
// Why a game ended before its last out, for after the score: "run rule", "time limit", the league's "10-run rule, 4
// innings", or for a called game that didn't count, "before it was official". '' otherwise.
export function endNote(S) {
  if (S.over && S.mercy) return `${S.mercy.by}-run rule, ${S.mercy.inn} inning${S.mercy.inn === '1' ? '' : 's'}`;
  if (!S.over || !S.ended) return '';
  return S.why ? ENDS[S.why].short : official(S) ? '' : 'before it was official';
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
export const pitchStat = (S, side, i) => S.pitching[side][i] || { np: 0, balls: 0, str: 0, bf: 0, outs: 0, h: 0, r: 0, ur: 0, bb: 0, k: 0, hr: 0, hbp: 0, wp: 0, bk: 0 };
export const ip = outs => Math.floor(outs / 3) + (outs % 3 ? '.' + (outs % 3) : '');
// A pitcher's day so far, in words, from pitchStat: "43 pitches (33 strikes), 4 innings and 1 out, 13 batters faced,
// 1 hit, 0 runs, 0 walks, 4 strikeouts." (The box score keeps the scorer's 4.1.) pitches: whether they're counted.
const many = (k, one, more = one + 's') => `${k} ${k === 1 ? one : more}`;
export function pitchDay(st, pitches = true) {
  return `${pitches ? `${many(st.np, 'pitch', 'pitches')} (${many(st.str, 'strike')}), ` : ''}${pitchWork(st)}, ${many(st.h, 'hit')}, ${many(st.r, 'run')}${st.ur ? ` (${st.ur} unearned)` : ''}, ${many(st.bb, 'walk')}, ${many(st.k, 'strikeout')}.`;
}
// The outs a pitcher got and the batters he faced, in words: "1 inning and 2 outs, 7 batters faced".
export function pitchWork(st) {
  const inn = Math.floor(st.outs / 3), outs = st.outs % 3;
  const work = !st.outs ? 'no outs yet' : [inn ? many(inn, 'inning') : '', outs ? many(outs, 'out') : ''].filter(Boolean).join(' and ');
  return `${work}, ${many(st.bf, 'batter')} faced`;
}
// A pitch count in words: "1 pitch", "34 pitches".
export const pitchCount = np => many(np, 'pitch', 'pitches');

// ---------- pitch limits ----------
// A game's pitch limit (g.limit, see model.js): 0 for none, or { by: 'll' (Little League), 'ps' (Pitch Smart) or ''
// (a number of the scorer's own), age: the pitchers' league age, max: the most pitches in a day }. The most by age:
// Little League Regulation VI(c), and Pitch Smart (MLB and USA Baseball), the same numbers, with 19-22 too.
export const PITCH_AGES = { '7-8': 50, '9-10': 75, '11-12': 85, '13-14': 95, '15-16': 95, '17-18': 105, '19-22': 120 };
export const LIMIT_BY = { ll: 'Little League', ps: 'Pitch Smart' };
// The days of rest a pitcher needs after so many pitches, the same in both (Regulation VI(d)): through 14, none after
// 1-20, 1 after 21-35, 2 after 36-50, 3 after 51-65, 4 after 66 or more; at 15-18 the steps are 30, 45, 60 and 75;
// at 19-22 (Pitch Smart) a 5th day after 105. null with no table (a number of the scorer's own) or no pitches.
const restSteps = limit => { const age = parseInt(limit.age, 10); return age >= 19 ? [30, 45, 60, 75, 105] : age >= 15 ? [30, 45, 60, 75] : [20, 35, 50, 65]; };
export function restDays(limit, np) {
  if (!limit || !LIMIT_BY[limit.by] || !PITCH_AGES[limit.age] || !np) return null;
  return restSteps(limit).filter(x => np > x).length;
}
// The pitches that make that many days of rest, in words: "36 to 50 pitches", "66 or more pitches".
export function restBand(limit, np) {
  const steps = restSteps(limit), d = steps.filter(x => np > x).length;
  return d === steps.length ? `${steps[d - 1] + 1} or more pitches` : `${d ? steps[d - 1] + 1 : 1} to ${steps[d]} pitches`;
}
// In Little League a pitcher who threw 41 or more in a game can't catch for the rest of the day (Regulation VI).
export const noCatch = (limit, np) => !!limit && limit.by === 'll' && np >= 41;
// Where the pitcher now in the field stands against the limit: '' (well short, or no limit), 'near' (5 pitches or
// fewer from it), 'finish' (he reached it during this at-bat: he may finish this batter, Regulation VI(c)), or 'over'
// (at it with a new batter up: time for a new pitcher). With pitches counted only.
export function limitState(S) {
  const L = S.g.limit, fld = 1 - S.half;
  if (!L || !L.max || !S.g.pitches || S.over) return '';
  const np = pitchStat(S, fld, S.pit[fld]).np;
  if (np < L.max - 5) return '';
  if (np < L.max) return 'near';
  return S.seq && np - S.seq.length < L.max ? 'finish' : 'over';
}
