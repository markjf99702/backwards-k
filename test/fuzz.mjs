// Random games, played through the same steps the game screen takes, with the rules and the bookkeeping checked after
// every tap:  node test/fuzz.mjs   (FUZZ_GAMES=1500 for a long run, FUZZ_SEED=n to start from another seed)
//
// Each game is seeded, so a run is the same every time. A step is what a tap on the game screen does (js/game.js):
// a pitch, a result with its fielders and the runners sheet (check(), scoredAs() and "did the run count"), Fix
// runners, a runner's steal, pickoff, wild pitch or balk, a substitution or someone back in, a pitching change, a
// batter added, End this half-inning, End the game here (a delay, a run rule, a time limit, called), Keep playing
// and Resume play, a box switched to another result, and Undo,
// Redo and Put back. After each one: the outs, the count and the bases make sense; runs, hits and errors add up the
// same way on the line score, the card, the batters and the pitchers; every half-inning passes the scorer's proof
// (OBR 9.03(c)); the game ends when it should, and a walk-off counts only the winning run; Undo and Redo give back
// exactly the game before; replaying the start of the game gives what was on screen then; and the game comes back the
// same from storage, a file and a link, with the card and the box score agreeing with it. When something breaks, the
// game is cut down to the fewest taps that still break it, and those are printed.
import assert from 'node:assert/strict';

globalThis.document ??= { readyState: 'complete', getElementById: () => null };
const E = await import('../js/engine.js'), M = await import('../js/model.js');
const { pack, unpack } = await import('../js/share.js');
const { cardHtml, lineHtml } = await import('../js/card.js');
const { boxHtml, playsHtml } = await import('../js/box.js');
const { RESULTS, replay, suggest, check, runsCount, runnersOn, scoredAs, fits } = E;

const GAMES = +(process.env.FUZZ_GAMES || 100), SEED = +(process.env.FUZZ_SEED || 1), STEPS = 1200;

// mulberry32, as in js/sample.js.
function dice(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const weighed = (rnd, items) => { let x = rnd() * items.reduce((a, [w]) => a + w, 0); for (const [w, v] of items) if ((x -= w) < 0) return v; return items.at(-1)[1]; };
const sum = a => a.reduce((x, y) => x + (y || 0), 0);
// JSON with its keys in one order, to compare games.
const sorted = v => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, sorted(v[k])])) : v);
const canon = v => JSON.stringify(sorted(v));

// ---------- a game, and the game screen's steps (js/game.js) ----------
function makeGame(setup) {
  const g = M.newGame({ away: 'Foxes', home: 'Comets', innings: setup.innings, pitches: setup.pitches, rules: setup.rules || null, tie: setup.tie || 0, limit: setup.limit || 0, date: '2026-10-25', place: 'Fuzz' });
  g.id = 'gfuzz' + setup.seed; g.created = g.updated = 1;
  g.teams.forEach((t, s) => {
    t.lineup = Array.from({ length: setup.size[s] }, (_, i) => [i % 4 === 3 ? M.blank() : { name: `${s ? 'H' : 'V'}${i + 1}`, num: String(i + 1) }]);
    t.pitchers = [{ name: `${s ? 'H' : 'V'}P1`, num: '' }];
  });
  return g;
}
const QUIET = new Set(['K', 'KL', 'PU', 'BB', 'IBB', 'HBP', 'CI']);
const SAME = [['K', 'KL', 'GO', 'FO', 'LO', 'PU', 'SF', 'SAC'], ['1B', 'BB', 'IBB', 'HBP', 'E', 'FC', 'KD', 'CI']];
const withF = (e, f) => { if (f && f.length) e.f = f; return e; };
// The buttons that are there to tap (liveHtml's and moreSheet's can).
function offered(C, code) {
  const S = C.S, on = runnersOn(S).length;
  if (S.over || S.delayed) return false;
  return ({ SF: !!S.bases[3] && S.outs < 2, SAC: on && S.outs < 2, DP: on && S.outs < 2, FC: !!on, TP: on >= 2 && S.outs === 0,
    KD: (S.s >= 2 || !C.g.pitches) && !(S.bases[1] && S.outs < 2) })[code] ?? true;
}
// Nothing to ask about the runners (game.js quiet()).
const quiet = (S, code) => { const on = runnersOn(S).length; return !on || QUIET.has(code) || (S.outs === 2 && RESULTS[code].kind === 'out') || (code === 'DP' && on === 1) || (code === 'TP' && on === 2); };
// The runners sheet's Save: the moves shown, or null when Save is greyed out. st: how things stood before the play.
function sheet(st, code, f, m, said) {
  if (check(st, m, code)) return null;
  const outs = m.filter(x => x[1] === 0).length, runs = m.filter(x => x[1] === 4).length, third = st.outs + outs >= 3;
  const counts = said == null || !(third && runs) ? runsCount(st, code, m) : said;
  const e = withF({ t: 'pa', r: scoredAs(st, code, f, m), m: m.map(x => x.slice()) }, f);
  if (third && !counts) e.x = 1;
  return e;
}
// The play Fix runners changes, or -1 (game.js fixable()).
function fixable(C) {
  const { g, S } = C;
  let k = g.ev.length - 1;
  while (k >= 0 && g.ev[k].t === 'p') k--;
  const e = g.ev[k], R = e && RESULTS[e.r];
  if (!R || e.t !== 'pa' || !e.m || (e.m.length < 2 && R.kind === 'out')) return -1;
  const box = S.cells.at(-1);
  if (k < g.ev.length - 1 && (S.over || !box || box.ev !== k || box.side !== S.half || box.inn !== S.inn)) return -1;
  return k;
}
// What a box can't be switched to (game.js cantBe()).
function cantBe(C, c, e) {
  const st = replay(C.g, c.ev), why = {}, nobody = !runnersOn(st).length, two = st.outs >= 2;
  why.FC = nobody; why.SAC = nobody || two;
  why.SF = !(e.m || []).some(x => x[0] === 3 && x[1] === 4) || two;
  why.KD = (C.g.pitches && st.s !== 2) || (!!st.bases[1] && st.outs < 2);
  if ((e.m || []).some(x => x[0] === 0 && x[1] !== 0)) for (const k of ['K', 'KL', 'GO', 'FO', 'LO', 'PU', 'SF']) why[k] = true;
  return why;
}
// Two runners on one base, or one passing another, after some move up together (game.js jam()).
function jam(S, moves) {
  const at = runnersOn(S).map(x => [x, (moves.find(m => m[0] === x) || [x, x])[1]]);
  for (let i = 1; i < at.length; i++) {
    const [from, ahead] = at[i - 1], behind = at[i][1];
    if (behind < ahead || (behind === 4 && ahead === 4)) continue;
    if (ahead === from || behind >= ahead) return true;
  }
  return false;
}
function save(C) { C.S = replay(C.g); }
// A new play after Undo keeps what Undo took back, to put back (game.js moved()).
function moved(C) { if (C.redo.length && !C.kept) C.kept = { stack: C.redo, n: C.g.ev.length }; C.redo = []; }
function act(C, e) { C.g.ev.push(e); moved(C); save(C); }
const where = S => ({ half: S.half, inn: S.inn, outs: S.outs, over: S.over });

// Runs one step. Returns false when the screen wouldn't offer it; or what it rewrote, for the Undo check.
function run(C, a) {
  const { S, g } = C;
  switch (a.a) {
    case 'p': if (S.over || S.delayed || !g.pitches) return false; act(C, { t: 'p', k: a.k }); return true;
    case 'pa': {
      if (!RESULTS[a.r] || !offered(C, a.r)) return false;
      if (quiet(S, a.r)) {
        const m = suggest(S, a.r);
        if (a.r === '1B' && S.outs === 2 && S.bases[2]) m.find(x => x[0] === 2)[1] = 4;
        const e = withF({ t: 'pa', r: a.r, m }, a.f);
        C.tapped = { e, r: a.r }; act(C, e); return true;
      }
      const e = sheet(S, a.r, a.f, a.m || suggest(S, a.r), a.said);
      if (!e) return false;
      C.tapped = { e, r: a.r }; act(C, e); return true;
    }
    case 'fix': {
      const k = fixable(C);
      if (k < 0 || !a.m) return false;
      const e = g.ev[k], code = C.tapped.e === e ? C.tapped.r : e.r, st = replay(g, k);
      const e2 = sheet(st, code, e.f || null, a.m, a.said);
      if (!e2) return false;
      if (k < g.ev.length - 1) {
        const S2 = replay({ ...g, ev: g.ev.map((x, i) => (i === k ? e2 : x)) });
        if ((S2.over && !S.over) || S2.half !== S.half || S2.inn !== S.inn || S2.outs !== S.outs) return false;
      }
      g.ev[k] = e2; C.tapped = { e: e2, r: code }; moved(C); save(C);
      return { fixed: k, ev: structuredClone(e2) };
    }
    case 'run': {
      const r = S.bases[a.b];
      if (S.over || S.delayed || !r) return false;
      const next = a.b + 1;
      if (a.how === 'BK') { act(C, { t: 'r', m: runnersOn(S).map(x => [x, x + 1, 'BK']) }); return true; }
      if (a.how === 'SB') { if (S.bases[next] && next < 4) return false; act(C, { t: 'r', m: [[a.b, next, 'SB']] }); return true; }
      if (['CS', 'PO', 'OB'].includes(a.how)) { act(C, { t: 'r', m: [[a.b, 0, a.how]] }); return true; }
      const moves = runnersOn(S).map(x => [x, x === a.b ? a.to : a.also && x > a.b ? Math.min(4, x + 1) : x, a.how]).filter(m => m[1] !== m[0]);
      if (!(a.to > a.b) || jam(S, moves)) return false;
      act(C, { t: 'r', m: a.how === 'E' && a.f ? moves.map(m => [...m, a.f]) : moves });
      return true;
    }
    case 'sub': { // a pinch hitter or runner, a change in the field, or someone who was in the spot before back in
      if (!(a.slot < S.size[a.side])) return false;
      const list = g.teams[a.side].lineup[a.slot], cur = S.pl[a.side][a.slot] ?? 0;
      const on = a.side === S.half && [1, 2, 3].some(b => S.bases[b] && S.bases[b].slot === a.slot && S.bases[b].p === cur);
      const ty = on ? 'pr' : a.ty;
      if (a.back) {
        const been = [0, ...g.ev.filter(e => e.t === 'sub' && e.s === a.side && e.slot === a.slot).map(e => e.i)].filter(i => i !== cur);
        if (!been.length) return false;
        act(C, { t: 'sub', s: a.side, slot: a.slot, i: been[a.back % been.length], ty });
        return true;
      }
      list.push({ name: `${a.side ? 'H' : 'V'}${a.slot + 1}${'bcdefghijklmnopqrstuvwxyz'[list.length - 1] || 'z'}`, num: '' });
      act(C, { t: 'sub', s: a.side, slot: a.slot, i: list.length - 1, ty });
      return true;
    }
    case 'pitcher': {
      const ps = g.teams[a.side].pitchers;
      ps.push({ name: `${a.side ? 'H' : 'V'}P${ps.length + 1}`, num: '' });
      act(C, { t: 'pch', s: a.side, i: ps.length - 1 });
      return true;
    }
    case 'back': { // Bring back an earlier pitcher (the pitcher button, so the team in the field)
      const ps = g.teams[1 - S.half].pitchers;
      if (S.over || ps.length < 2 || a.j % ps.length === S.pit[1 - S.half]) return false;
      act(C, { t: 'pch', s: 1 - S.half, i: a.j % ps.length });
      return true;
    }
    case 'add': g.teams[a.side].lineup.push([M.blank()]); act(C, { t: 'add', s: a.side }); return true;
    case 'eoh': case 'delay': if (S.over || S.delayed) return false; act(C, { t: a.a }); return true;
    case 'end': if (S.over) return false; act(C, a.why ? { t: 'end', why: a.why } : { t: 'end' }); return true;
    case 'on': if (!S.over && !S.delayed) return false; act(C, { t: 'on' }); return true;
    case 'undo': {
      const r = M.takeBack(g);
      if (!r) return false;
      C.redo.push(r); save(C);
      Object.assign(r, { at: where(C.S) });
      return true;
    }
    case 'redo': { const r = C.redo.pop(); if (!r) return false; M.putBack(g, r); save(C); return true; }
    case 'putback': { // each as it was when it fits, its runners sheet when it doesn't, or left out (game.js goBack())
      if (C.redo.length || !C.kept || g.ev.length < C.kept.n) return false;
      const list = C.kept.stack.slice().reverse();
      C.kept = null;
      for (const r of list) {
        const why = fits(C.S, r.e, r.at);
        if (!why) M.putBack(g, r);
        else if (why === 'runners' && r.e.t === 'pa') {
          const m = suggest(C.S, r.e.r);
          const e = quiet(C.S, r.e.r) ? withF({ t: 'pa', r: r.e.r, m }, r.e.f) : sheet(C.S, r.e.r, r.e.f || null, m, null);
          if (!e) continue;
          g.ev.push(e);
        } else continue;
        save(C);
      }
      save(C);
      return { put: true };
    }
    case 'box': { // a box on the card: Change what it was
      const c = S.cells[a.n], e = c && g.ev[c.ev];
      if (!e) return false;
      const group = e.t === 'pa' ? SAME.find(gr => gr.includes(e.r)) : e.t === 'p' && (c.r === 'K' || c.r === 'KL') ? ['K', 'KL'] : null;
      if (!group || !group.includes(a.to) || a.to === c.r || (e.t === 'pa' && cantBe(C, c, e)[a.to])) return false;
      if (e.t === 'p') e.k = a.to === 'KL' ? 'c' : 's';
      else { e.r = a.to; if (!RESULTS[e.r].f) delete e.f; else if (a.f) e.f = a.f; }
      if (C.tapped.e === e) C.tapped.r = e.r;
      save(C);
      return { fixed: c.ev, ev: structuredClone(e) };
    }
  }
  return false;
}

// ---------- choosing a step ----------
const LIKELY = [[21, '1B'], [6, '2B'], [1, '3B'], [3.5, 'HR'], [9, 'BB'], [1, 'IBB'], [1, 'HBP'], [2, 'E'], [3, 'FC'], [1, 'KD'], [0.5, 'CI'],
  [18, 'K'], [5, 'KL'], [26, 'GO'], [20, 'FO'], [10, 'LO'], [10, 'PU'], [3, 'SF'], [2, 'SAC'], [5, 'DP'], [0.5, 'TP']];
const opts = from => [0, ...[1, 2, 3, 4].filter(b => b >= Math.max(from, 1))];
function fielders(rnd, code) {
  const R = RESULTS[code];
  if (!R.f || rnd() < 0.25) return null;
  return Array.from({ length: R.f === 1 ? 1 : 1 + Math.floor(rnd() * 3) }, () => 1 + Math.floor(rnd() * 9));
}
// The sheet's chips, some changed: where the runners went if not where they usually do, and now and then, for one
// marked out, where (the Out at row).
function changed(rnd, S, m, code) {
  for (let i = 0; i < 25; i++) {
    const t = m.map(x => x.slice());
    for (const x of t) if (rnd() < 0.5) x[1] = pick(rnd, opts(x[0]));
    if (check(S, t)) continue;
    for (const x of t) {
      x.length = 2;
      const at = x[1] === 0 && code ? E.outBases(x[0], RESULTS[code]) : [];
      if (at.length && rnd() < 0.4) x.push('@' + pick(rnd, at));
    }
    return t;
  }
  return m;
}
const said = (rnd, S, m) => (S.outs + m.filter(x => x[1] === 0).length >= 3 && m.some(x => x[1] === 4) && rnd() < 0.3 ? rnd() < 0.5 : null);
function choose(C, rnd) {
  const { S, g } = C, w = [];
  if (S.over) w.push([5, 'stop'], [3, 'on'], [1.5, 'undo'], [0.5, 'sub'], [0.3, 'pitcher'], [0.4, 'box']);
  else if (S.delayed) w.push([3, 'on'], [0.5, 'end'], [0.5, 'undo'], [0.3, 'sub'], [0.2, 'pitcher'], [0.2, 'back'], [0.2, 'box']);
  else {
    if (g.pitches) w.push([6, 'p']);
    w.push([3.2, 'pa'], [0.12, 'sub'], [0.05, 'pitcher'], [0.08, 'back'], [0.03, 'add'], [0.02, 'eoh'], [0.012, 'end'], [0.01, 'delay'], [0.4, 'undo'], [0.08, 'box']);
    if (runnersOn(S).length) w.push([0.7, 'run']);
  }
  if (fixable(C) >= 0) w.push([0.15, 'fix']);
  if (C.redo.length) w.push([1.2, 'redo']);
  if (C.kept && !C.redo.length) w.push([0.8, 'putback']);
  const k = weighed(rnd, w);
  switch (k) {
    case 'stop': return null;
    case 'p': return { a: 'p', k: weighed(rnd, [[2.2, 'b'], [1.2, 'c'], [0.8, 's'], [1.2, 'f']]) };
    case 'pa': {
      const ok = Object.keys(RESULTS).filter(c => offered(C, c));
      const r = rnd() < 0.5 ? pick(rnd, ok) : weighed(rnd, LIKELY.filter(([, c]) => ok.includes(c))), f = fielders(rnd, r);
      if (quiet(S, r)) return { a: 'pa', r, f };
      const m = rnd() < 0.45 ? changed(rnd, S, suggest(S, r), r) : suggest(S, r);
      return { a: 'pa', r, f, m, said: said(rnd, S, m) };
    }
    case 'fix': {
      const k = fixable(C), st = replay(g, k), m = changed(rnd, st, g.ev[k].m, g.ev[k].r);
      return { a: 'fix', m, said: said(rnd, st, m) };
    }
    case 'run': {
      const b = pick(rnd, runnersOn(S));
      const how = weighed(rnd, [[35, 'SB'], [10, 'CS'], [5, 'PO'], [5, 'OB'], [15, 'WP'], [7, 'PB'], [8, 'E'], [5, 'OA'], [5, 'BK'], [5, 'PR']]);
      if (how === 'PR') return { a: 'sub', side: S.half, slot: S.bases[b].slot, ty: 'pr' };
      return { a: 'run', b, how, to: rnd() < 0.7 ? b + 1 : b + 1 + Math.floor(rnd() * (4 - b)), also: rnd() < 0.3, f: how === 'E' && rnd() < 0.7 ? [1 + Math.floor(rnd() * 9)] : null };
    }
    case 'sub': {
      const side = rnd() < 0.5 ? S.half : 1 - S.half, ph = side === S.half && rnd() < 0.5;
      return { a: 'sub', side, slot: ph ? S.up[side] : Math.floor(rnd() * S.size[side]), ty: ph ? 'ph' : pick(rnd, ['def', 'def', 'ph', 'pr']), back: rnd() < 0.25 ? 1 + Math.floor(rnd() * 3) : 0 };
    }
    case 'pitcher': return { a: 'pitcher', side: rnd() < 0.8 ? 1 - S.half : S.half };
    case 'back': return { a: 'back', j: Math.floor(rnd() * 5) };
    case 'add': return { a: 'add', side: rnd() < 0.5 ? 0 : 1 };
    case 'end': return { a: 'end', why: pick(rnd, ['', '', 'rule', 'time']) };
    case 'box': {
      if (!S.cells.length) return { a: 'undo' };
      const c = pick(rnd, S.cells);
      return { a: 'box', n: c.n, to: pick(rnd, SAME.find(gr => gr.includes(c.r)) || ['K', 'KL']), f: fielders(rnd, 'GO') };
    }
    default: return { a: k };
  }
}

// ---------- what has to hold ----------
const BAD = /undefined|NaN|\bnull\b|\[object/;
// What replay() worked out, without the game itself, for comparing. (Who's in each spot only for the spots in the
// order then: a batter added later has a spot, empty, in a replay of the start.)
const shown = S => JSON.stringify(S, (k, v) => (k === 'g' ? undefined : v instanceof Set ? [...v].sort()
  : k === 'pl' || k === 'been' ? v.map((a, t) => a.slice(0, S.size[t]))
    : k === 'bases' ? v.map(r => (r ? [r.side, r.slot, r.p, r.pi, r.cell.n] : null)) : k === 'last' ? (v ? v.n : null) : v));
function rules(C, fresh) {
  const { S, g } = C, out = [], bad = (key, msg) => out.push({ key, msg });
  if (!(S.outs >= 0 && S.outs <= 2)) bad('outs', `${S.outs} outs`);
  if (!(S.b >= 0 && S.b <= 3 && S.s >= 0 && S.s <= 2)) bad('count', `a count of ${S.b}-${S.s}`);
  if (S.between && !S.over) bad('between', 'between half-innings, but the game isn’t over');
  for (const t of [0, 1]) if (!(S.up[t] >= 0 && S.up[t] < S.size[t])) bad('up', `batter ${S.up[t] + 1} up in an order of ${S.size[t]}`);
  const seen = new Set();
  for (const b of [1, 2, 3]) {
    const r = S.bases[b];
    if (!r) continue;
    if (r.side !== S.half || S.between) bad('bases', `a runner on ${b} for the team in the field`);
    if (seen.has(r.cell)) bad('bases', 'one runner on two bases');
    seen.add(r.cell);
    if (r.cell.reach !== b || r.cell.scored || r.cell.outN) bad('bases', `the runner on ${b} has a box that says ${r.cell.scored ? 'scored' : r.cell.outN ? 'out' : 'reached ' + r.cell.reach}`);
    if (r.p !== S.pl[r.side][r.slot] && S.size[r.side] > 3) bad('runner-sub', `the runner on ${b} is player ${r.p} of spot ${r.slot + 1}, but the order has player ${S.pl[r.side][r.slot]} there`);
  }
  for (const side of [0, 1]) {
    // (cells: every box, the runner put on second to start an extra inning's too; pas: the trips to the plate.)
    const f = 1 - side, cells = S.cells.filter(c => c.side === side), pas = cells.filter(c => !c.auto), R = S.R[side];
    const bats = Object.entries(S.bat).filter(([k]) => k.startsWith(side + '.')).map(([, b]) => b), arms = S.pitching[f].filter(Boolean);
    const add = (key, got, want, what) => { if (got !== want) bad(key, `side ${side}: ${what} ${got}, should be ${want}`); };
    add('R', sum(S.line[side]), R, 'runs by inning'); add('R', cells.filter(c => c.scored).length, R, 'boxes that scored');
    add('R', sum(bats.map(b => b.r)), R, 'batters’ runs'); add('R', sum(arms.map(p => p.r)), R, 'runs charged to pitchers');
    const H = S.H[side];
    add('H', pas.filter(c => RESULTS[c.r].kind === 'hit').length, H, 'hit boxes'); add('H', sum(S.hInn[side]), H, 'hits by inning');
    add('H', sum(bats.map(b => b.h)), H, 'batters’ hits'); add('H', sum(arms.map(p => p.h)), H, 'hits off pitchers');
    add('E', sum(S.eInn[side]), S.E[f], 'errors by inning'); add('E', S.errs[f].length, S.E[f], 'errors listed');
    if (S.E[f] < pas.filter(c => RESULTS[c.r].err).length) bad('E', `side ${f}: fewer errors than boxes that say E or CI`);
    add('outs', sum(arms.map(p => p.outs)), cells.filter(c => c.outN).length, 'outs the pitchers got vs boxes out');
    add('pa', sum(arms.map(p => p.bf)), pas.length, 'batters faced'); add('pa', sum(bats.map(b => b.pa)), pas.length, 'trips to the plate');
    add('ab', sum(bats.map(b => b.ab)), sum(pas.map(c => RESULTS[c.r].ab)), 'at-bats');
    add('ur', sum(arms.map(p => p.ur)), cells.filter(c => c.auto && c.scored).length, 'unearned runs by the runner put on second'); add('rbi', sum(bats.map(b => b.rbi)), sum(cells.map(c => c.rbi)), 'RBI');
    for (const k of ['k', 'bb', 'hbp']) add(k, sum(bats.map(b => b[k])), sum(arms.map(p => p[k])), `batters’ ${k} vs pitchers’`);
    for (const p of arms) if (p.np !== p.balls + p.str) bad('pitches', `${p.np} pitches aren’t ${p.balls} balls and ${p.str} strikes`);
    for (const c of cells) {
      if (c.scored && (c.reach !== 4 || c.outN)) bad('box', `box ${c.n} scored, but reached ${c.reach}, out ${c.outN}`);
      if (c.rbi && RESULTS[c.r]?.rbi === 0) bad('rule-rbi', `box ${c.n} (${c.r}) has an RBI (OBR 9.04(b))`);
    }
    // The proof, each half-inning: every trip to the plate ends as a run, a runner left on base or an out (OBR 9.03(c)).
    for (const inn of new Set(cells.map(c => c.inn))) {
      const here = cells.filter(c => c.inn === inn), now = side === S.half && inn === S.inn && !S.between;
      const lob = now && !S.over ? runnersOn(S).length + S.waved : S.lob[side][inn - 1];
      if (here.length !== (S.line[side][inn - 1] || 0) + lob + here.filter(c => c.outN).length) bad('proof', `side ${side}, inning ${inn}: ${here.length} trips, ${S.line[side][inn - 1] || 0} runs, ${lob} left on, ${here.filter(c => c.outN).length} out`);
    }
    for (const p of S.plays) if (p.kind === 'end' && p.half === side && /^End of the .*\d\.$/.test(p.text) && !/ended early|run limit/.test(p.text) && cells.filter(c => c.inn === p.inn && c.outN).length !== 3) bad('three-outs', p.text);
  }
  // The game ends when the home team goes ahead in its last turn, and the winning run is the last to count, unless
  // it came on a home run (OBR 5.08(b), 7.01(g), 9.06(f)); a half that ends with it decided ends it.
  if (!S.over && !S.hold && S.half === 1 && S.inn >= g.innings && S.R[1] > S.R[0]) bad('rule-walkoff', `bottom ${S.inn}, the home team ahead ${S.R[1]}-${S.R[0]}, and the game goes on`);
  if (S.over && !S.ended && !S.between && !S.mercy) {
    const p = S.plays.findLast(x => x.runs), e = p && g.ev[p.i];
    if (!(e && e.t === 'pa' && e.r === 'HR') && S.R[1] - S.R[0] !== 1) bad('rule-walkoff-run', `a walk-off that ends ${S.R[0]}-${S.R[1]}: only the winning run counts`);
  }
  // A league's rules: no more runs in a half-inning than its limit (unless every run on the play counts), and the game
  // over when a half ends with a team far enough ahead (Little League 4.10(e)).
  const r = g.rules;
  if (r && r.runs && !r.all) for (const side of [0, 1]) S.line[side].forEach((n, i) => { if (n > r.runs && (r.last || i + 1 < g.innings)) bad('rule-limit', `side ${side}, inning ${i + 1}: ${n} runs, past the ${r.runs}-run limit`); });
  const ended = S.plays.findLast(p => p.kind === 'end' && /^End of /.test(p.text));
  if (r && ended && ended.i === g.ev.length - 1 && !S.over && S.plays.at(-1) === ended
    && r.mercy.some(([n, by]) => ended.inn >= n && (ended.half === 0 ? S.R[1] - S.R[0] : Math.abs(S.R[1] - S.R[0])) >= by)) bad('rule-mercy', `${ended.text} and the game goes on`);
  const last = S.plays.at(-1);
  if (last && last.kind === 'end' && last.i === g.ev.length - 1 && last.inn >= g.innings && !S.over && !S.hold && ((last.half === 0 && S.R[1] > S.R[0]) || (last.half === 1 && S.R[0] !== S.R[1]))) bad('rule-end', `${last.text} and the game goes on`);
  // What the runners sheet lets through: a play no scorer would write.
  const e = fresh && g.ev.at(-1);
  if (e && e.t === 'pa' && e.m && RESULTS[e.r]) {
    const bm = e.m.find(x => x[0] === 0), outs = e.m.filter(x => x[1] === 0).length;
    // (A sacrifice bunt with everyone safe on an error is still one, OBR 9.08(b), and on a double or triple play the
    // outs can all be on the bases.)
    if (RESULTS[e.r].kind === 'out' && bm && bm[1] > 0 && !['SAC', 'DP', 'TP'].includes(e.r)) bad('rule-out-safe', `${e.r} saved with the batter safe at ${bm[1]}: "${S.text.at(-1)}"`);
    if (e.r === 'DP' && outs !== 2) bad('rule-dp', `a double play with ${outs} out(s): "${S.text.at(-1)}"`);
    if (e.r === 'TP' && outs !== 3) bad('rule-tp', `a triple play with ${outs} out(s): "${S.text.at(-1)}"`);
  }
  for (let i = 0; i < g.ev.length; i++) if (typeof S.text[i] !== 'string' || (!S.text[i] && g.ev[i].t !== 'r') || BAD.test(S.text[i])) bad('words', `event ${i} (${g.ev[i].t}) reads "${S.text[i]}"`);
  for (const c of S.cells) for (const t of [c.text, ...c.story]) if (BAD.test(t)) bad('words', `box ${c.n}: "${t}"`);
  return out;
}
// The card, the box score and the plays agree with the game.
function pages(C) {
  const { S } = C, out = [], bad = (key, msg) => out.push({ key, msg });
  const html = { card0: cardHtml(S, 0, { live: true }), card1: cardHtml(S, 1), line: lineHtml(S), box: boxHtml(S), plays: playsHtml(S) };
  for (const [k, h] of Object.entries(html)) { const m = /undefined|NaN|\[object/.exec(h); if (m) bad('html', `${k}: …${h.slice(Math.max(0, m.index - 60), m.index + 30)}…`); }
  for (const side of [0, 1]) {
    const h = html['card' + side], drawn = [...h.matchAll(/data-cell="(\d+)"/g)].map(m => +m[1]).sort((a, b) => a - b);
    if (drawn.join() !== S.cells.filter(c => c.side === side).map(c => c.n).join()) bad('card', `side ${side}: the card draws boxes ${drawn.join()}`);
    const tot = [...h.split('<tfoot>')[1].matchAll(/<td class="tot" colspan="4">([^<]*)<\/td>/g)].map(m => +m[1]);
    if (tot[0] !== S.R[side] || tot[1] !== S.H[side]) bad('card', `side ${side}: the card’s R and H are ${tot[0]} and ${tot[1]}, the game’s ${S.R[side]} and ${S.H[side]}`);
    // The box score's batting totals: AB R H RBI BB K.
    const t = html.box.split('<table class="stats">')[side * 2 + 1], foot = t && /<tfoot>([\s\S]*?)<\/tfoot>/.exec(t);
    const got = foot ? [...foot[1].matchAll(/<td>(\d+)<\/td>/g)].map(m => +m[1]) : [];
    const want = ['ab', 'r', 'h', 'rbi', 'bb', 'k'].map(k => sum(Object.entries(S.bat).filter(([x]) => x.startsWith(side + '.')).map(([, b]) => b[k])));
    if (got.join() !== want.join()) bad('box-score', `side ${side}: totals ${got.join(' ')}, should be ${want.join(' ')}`);
  }
  const pas = S.cells.filter(c => !c.auto).length;
  if ((html.plays.match(/<li class="pa/g) || []).length !== pas) bad('plays', `${pas} trips to the plate, and the plays list another number`);
  return out;
}
// The game from storage, a file or Drive (cleanGame), and from a link (pack), is the game.
async function stored(C, full) {
  const { g } = C, out = [], bad = (key, msg) => out.push({ key, msg });
  const c = M.cleanGame(JSON.parse(JSON.stringify(g)));
  if (!c || canon(c) !== canon(g)) bad('clean', 'cleanGame() changes a game the app made');
  else if (canon(M.cleanGame(JSON.parse(JSON.stringify(c)))) !== canon(c)) bad('clean', 'cleanGame() twice isn’t cleanGame() once');
  const before = JSON.stringify(g);
  if (shown(replay(g)) !== shown(C.S)) bad('replay', 'replay() gives another answer the second time');
  if (JSON.stringify(g) !== before) bad('replay', 'replay() changes the game it reads');
  if (full) {
    const d = M.cleanDoc(JSON.parse(M.canon({ app: 'backwards-k', v: 1, games: { [g.id]: g }, gone: {} })));
    if (!d.games[g.id] || canon(d.games[g.id]) !== canon(g)) bad('clean', 'a backup with the game in it loses or changes it');
    if (canon(await unpack(await pack(g))) !== canon(g)) bad('link', 'the link brings back another game');
  }
  return out;
}

// ---------- playing a list of steps, checking as it goes ----------
const snap = g => JSON.stringify(g);
async function play(setup, steps, { until = '', full = true } = {}) {
  const C = { setup, g: makeGame(setup), redo: [], kept: null, tapped: { e: null, r: '' } };
  save(C);
  const broke = new Map(), past = [], back = [], seen = [];
  const note = (i, list) => { for (const x of list) if (!broke.has(x.key)) broke.set(x.key, { i, msg: x.msg }); };
  for (let i = 0; i < steps.length; i++) {
    const a = steps[i], was = snap(C.g), n = C.g.ev.length;
    let r;
    try { r = run(C, a); } catch (err) { note(i, [{ key: 'throws', msg: `${say(a)}: ${err.stack.split('\n').slice(0, 3).join(' | ')}` }]); return { broke, C, n: i + 1 }; }
    if (!r) return { broke, C, n: i, stuck: true };
    // Undo gives back exactly the game before the step it takes back, and Redo the game after.
    if (a.a === 'undo') { const want = past.pop(); if (want != null && want !== snap(C.g)) note(i, [{ key: 'undo', msg: 'Undo doesn’t give back the game as it was' }]); back.push(was); }
    else if (a.a === 'redo') { const want = back.pop(); if (want != null && want !== snap(C.g)) note(i, [{ key: 'redo', msg: 'Redo doesn’t give back the game' }]); past.push(was); }
    else if (r.fixed != null) { // a fix or a box switched rewrites that play in every game Undo and Redo would give back
      const fix = s => { const o = JSON.parse(s); if (o.ev.length > r.fixed) o.ev[r.fixed] = r.ev; return JSON.stringify(o); };
      past.splice(0, past.length, ...past.map(fix)); back.splice(0, back.length, ...back.map(fix));
      if (a.a === 'fix') back.length = 0; // (and a fix, like a new play, leaves nothing to Redo)
    } else if (r.put) { past.length = 0; back.length = 0; } // (each play put back is its own, with no game before it kept here)
    else { past.push(was); back.length = 0; }
    note(i, rules(C, C.g.ev.length > n || a.a === 'fix'));
    if (full && (i % 4 === 3 || !['p', 'pa'].includes(a.a))) note(i, await stored(C, i % 25 === 24));
    if (full && i % 15 === 14) note(i, pages(C));
    if (full && i % 5 === 0) seen.push([C.g.ev.length, snap(C.g), shown(C.S)]);
    if (until && broke.has(until)) return { broke, C, n: i + 1 };
  }
  if (full) {
    note(steps.length - 1, [...pages(C), ...await stored(C, true)]);
    // Replaying the start of the game gives what was on screen when the game had that many plays (and the same names
    // and settings): what Undo, Fix runners and Put back rely on.
    const now = C.g.ev;
    for (const [n, s, view] of seen) {
      if (canon(JSON.parse(s).ev) !== canon(now.slice(0, n))) continue;
      if (shown(replay(C.g, n)) !== view) { note(steps.length - 1, [{ key: 'prefix', msg: `replaying the first ${n} plays doesn’t give the game as it stood then` }]); break; }
    }
  }
  return { broke, C, n: steps.length };
}

// The fewest steps that still break the same thing (and the shortest game).
async function shrink(setup, steps, key) {
  const fails = async (s, t) => { const r = await play(s, t, { until: key, full: !key.startsWith('rule') }); return r.broke.has(key) && !r.stuck ? r : null; };
  let best = steps, s = setup, budget = 800;
  const r0 = await fails(s, best);
  if (!r0) return { setup, steps };
  best = best.slice(0, r0.n);
  for (const inn of [1, 2, 3]) if (inn < s.innings && await fails({ ...s, innings: inn }, best)) { s = { ...s, innings: inn }; break; }
  for (let n = 2; best.length >= 2 && budget > 0;) {
    const size = Math.ceil(best.length / n);
    let cut = false;
    for (let i = 0; i < best.length && budget-- > 0; i += size) {
      const t = best.slice(0, i).concat(best.slice(i + size)), r = await fails(s, t);
      if (r) { best = t.slice(0, r.n); n = Math.max(n - 1, 2); cut = true; break; }
    }
    if (!cut) { if (n >= best.length) break; n = Math.min(best.length, n * 2); }
  }
  return { setup: s, steps: best };
}
// A step in words.
function say(a) {
  const mv = m => (m ? ` [${m.map(([f, t]) => `${f}>${t}`).join(', ')}]` : '');
  switch (a.a) {
    case 'p': return { b: 'Ball', c: 'Strike looking', s: 'Strike swinging', f: 'Foul' }[a.k];
    case 'pa': return `${a.r}${a.f ? ' ' + a.f.join('-') : ''}${mv(a.m)}${a.said != null ? ` (runs count: ${a.said ? 'yes' : 'no'})` : ''}`;
    case 'fix': return `Fix runners${mv(a.m)}`;
    case 'run': return `runner on ${a.b}: ${a.how}${['WP', 'PB', 'E', 'OA'].includes(a.how) ? ' to ' + a.to + (a.also ? ', the others up one' : '') : ''}`;
    case 'sub': return `${a.back ? 'back in' : a.ty} for ${a.side ? 'home' : 'visitors'} spot ${a.slot + 1}`;
    case 'pitcher': return `new pitcher for ${a.side ? 'home' : 'visitors'}`;
    case 'back': return 'bring back an earlier pitcher';
    case 'add': return `add a batter for ${a.side ? 'home' : 'visitors'}`;
    case 'box': return `box ${a.n} switched to ${a.to}`;
    case 'end': return `End the game${a.why ? ` (${a.why})` : ''}`;
    default: return a.a === 'putback' ? 'Put back' : a.a[0].toUpperCase() + a.a.slice(1);
  }
}

// ---------- the run ----------
const LEAGUE = { ll: { set: 'll', runs: 0, last: false, all: false, mercy: [[3, 15], [4, 10]] } };
LEAGUE.minors = { ...LEAGUE.ll, set: 'minors', runs: 5 };
const t0 = Date.now(), found = new Map();
let taps = 0, events = 0;
for (let n = 0; n < GAMES; n++) {
  const seed = SEED + n, rnd = dice(seed * 7919 + 13);
  const size = weighed(rnd, [[8, 9], [2, 10], [2, 12], [1, 3], [1, 1], [1, 5]]);
  const setup = { seed, innings: weighed(rnd, [[4, 9], [2, 7], [2, 6], [1, 5], [1, 3], [1, 2], [1, 1]]), size: [size, rnd() < 0.8 ? size : pick(rnd, [9, 11, 4])], pitches: rnd() < 0.8 };
  // League rules in some: Little League's mercy rule, the Minors' run limit, and limits of every kind.
  setup.rules = weighed(rnd, [[6, null], [1, LEAGUE.ll], [1, LEAGUE.minors],
    [1, { set: 'custom', runs: 1 + Math.floor(rnd() * 4), last: rnd() < 0.5, all: rnd() < 0.5, mercy: rnd() < 0.5 ? [[1 + Math.floor(rnd() * 3), 2 + Math.floor(rnd() * 5)]] : [] }]]);
  // Extra innings that start with a runner on second in some, now and then from an inning before them.
  setup.tie = weighed(rnd, [[6, 0], [3, setup.innings + 1], [1, Math.max(2, setup.innings - 1)]]);
  // A pitch limit in some (the box score's days of rest, and who can't catch).
  setup.limit = weighed(rnd, [[6, 0], [1, { by: 'll', age: '9-10', max: 75 }], [1, { by: 'ps', age: '15-16', max: 95 }], [1, { by: '', age: '', max: 40 }]]);
  // Make up the game a step at a time, keeping the steps the screen would take.
  const C = { setup, g: makeGame(setup), redo: [], kept: null, tapped: { e: null, r: '' } };
  save(C);
  const steps = [];
  for (let i = 0; i < STEPS; i++) {
    const a = choose(C, rnd);
    if (!a) break;
    // (A step the screen wouldn't take changes nothing.)
    let ok;
    try { ok = run(C, a); } catch { ok = true; }
    if (ok) steps.push(a);
  }
  const res = await play(setup, steps);
  taps += steps.length; events += res.C.g.ev.length;
  for (const [key, x] of res.broke) if (!found.has(key) || x.i < found.get(key).steps.length) found.set(key, { setup, steps: steps.slice(0, x.i + 1), msg: x.msg, count: (found.get(key)?.count || 0) + 1 });
  if (GAMES > 200 && (n + 1) % 250 === 0) console.log(`  ${n + 1} games, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (!found.size) { console.log(`fuzz: ${GAMES} games from seed ${SEED}, ${taps} taps, ${events} plays: everything held (${secs} s)`); process.exit(0); }
console.log(`fuzz: ${GAMES} games from seed ${SEED}, ${found.size} thing(s) broke (${secs} s)\n`);
for (const [key, f] of found) {
  const s = await shrink(f.setup, f.steps, key), r = await play(s.setup, s.steps, { full: false });
  console.log(`== ${key}: ${(r.broke.get(key) || f).msg}`);
  console.log(`   seed ${f.setup.seed}: ${s.setup.innings} inning(s), ${s.setup.size.join('/')} batters, ${s.setup.pitches ? 'counting pitches' : 'no pitch count'}${s.setup.rules ? `, rules ${JSON.stringify(s.setup.rules)}` : ''}${s.setup.tie ? `, a runner on second from the ${s.setup.tie}` : ''}. ${s.steps.length} taps:`);
  console.log('   ' + s.steps.map(say).join(' · '));
  console.log('   Plays: ' + JSON.stringify(r.C.g.ev) + '\n');
}
assert.fail(`${found.size} thing(s) broke`);
