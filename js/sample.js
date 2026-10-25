// A made-up game, played out with seeded dice: the sample on the home screen, the README pictures, and a lot of
// games for the tests to check the rules against.
import { newGame } from './model.js';
import { replay, suggest, runnersOn } from './engine.js';

function dice(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const FOXES = [['Ruiz', 2], ['Okafor', 11], ['Brennan', 24], ['Castillo', 7], ['Lindqvist', 31], ['Marsh', 5], ['Delgado', 18], ['Han', 9], ['Pruitt', 14]];
const COMETS = [['Abernathy', 3], ['Nakamura', 22], ['Velez', 8], ['Quinn', 44], ['Sutton', 12], ['Ibarra', 6], ['Kowalski', 19], ['Ferris', 27], ['Tran', 1]];
const ARMS = [[['Whitlock', 33], ['Moreno', 41], ['Yates', 50]], [['Halvorsen', 21], ['Bishop', 37], ['Achebe', 45]]];

export function sampleGame(seed = 7, { innings = 9 } = {}) {
  const rnd = dice(seed), pick = a => a[Math.floor(rnd() * a.length)];
  const g = newGame({ away: 'Foxes', home: 'Comets', innings });
  g.id = 'gsample' + seed;
  g.place = 'Riverside Park';
  [FOXES, COMETS].forEach((names, s) => {
    g.teams[s].lineup = names.map(([name, num]) => [{ name, num: String(num) }]);
    g.teams[s].pitchers = [{ name: ARMS[s][0][0], num: String(ARMS[s][0][1]) }];
  });
  // Played on a clock of its own: first pitch at 1:05 pm, about 20 seconds a pitch, a little longer for a play, and
  // two minutes between half-innings (at, as the game screen keeps it: see model.js).
  const [y, m, d] = g.date.split('-').map(Number);
  g.start = Date.UTC(y, m - 1, d, 13, 5);
  let at = 0;
  const add = e => {
    const half = S.half;
    e.at = at;
    g.ev.push(e);
    S = replay(g);
    at += (e.t === 'p' ? 21 : e.t === 'pch' ? 140 : 32) + (S.half !== half ? 125 : 0);
  };
  let S = replay(g), guard = 0;
  while (!S.over && guard++ < 4000) {
    const fld = 1 - S.half, P = S.pitching[fld][S.pit[fld]];
    // A tired pitcher comes out between batters.
    if (S.b === 0 && S.s === 0 && P && P.np > 85 + rnd() * 20 && g.teams[fld].pitchers.length < ARMS[fld].length) {
      const [name, num] = ARMS[fld][g.teams[fld].pitchers.length];
      g.teams[fld].pitchers.push({ name, num: String(num) });
      add({ t: 'pch', s: fld, i: g.teams[fld].pitchers.length - 1 });
      continue;
    }
    // Now and then a runner on first tries to steal second.
    if (S.bases[1] && !S.bases[2] && rnd() < 0.05) {
      add(rnd() < 0.72 ? { t: 'r', m: [[1, 2, 'SB']] } : { t: 'r', m: [[1, 0, 'CS', [2, 6]]] });
      continue;
    }
    const x = rnd();
    if (x < 0.36) { add({ t: 'p', k: 'b' }); continue; }
    if (x < 0.53) { add({ t: 'p', k: 'c' }); continue; }
    if (x < 0.63) { add({ t: 'p', k: 's' }); continue; }
    if (x < 0.8) { add({ t: 'p', k: 'f' }); continue; }
    if (x < 0.805) { add({ t: 'pa', r: 'HBP', m: suggest(S, 'HBP') }); continue; }
    add(inPlay(S, rnd, pick));
  }
  return g;
}

function inPlay(S, rnd, pick) {
  const on = runnersOn(S), y = rnd();
  const two = S.outs < 2;
  let r, f;
  if (y < 0.21) r = '1B';
  else if (y < 0.27) r = '2B';
  else if (y < 0.28) r = '3B';
  else if (y < 0.315) r = 'HR';
  else if (y < 0.335) { r = 'E'; f = [pick([4, 5, 6, 6, 3, 9])]; }
  else if (y < 0.6) {
    r = 'GO'; f = pick([[6, 3], [4, 3], [5, 3], [6, 3], [1, 3], [3], [4, 3]]);
    if (S.bases[1] && two && rnd() < 0.4) { r = 'DP'; f = pick([[6, 4, 3], [4, 6, 3], [5, 4, 3]]); }
    else if (S.bases[1] && rnd() < 0.15) { r = 'FC'; f = pick([[6, 4], [4, 6], [5, 4]]); }
  } else if (y < 0.8) {
    r = 'FO'; f = [pick([7, 8, 9, 8])];
    if (S.bases[3] && two && rnd() < 0.6) r = 'SF';
  } else if (y < 0.9) { r = 'LO'; f = [pick([4, 5, 6, 7, 8, 9])]; }
  else { r = 'PU'; f = [pick([2, 3, 4, 5, 6])]; }
  const m = suggest(S, r);
  // A runner on second usually scores on a single.
  if (r === '1B' && on.includes(2) && !on.includes(3) && rnd() < 0.6) for (const mv of m) if (mv[0] === 2) mv[1] = 4;
  const e = { t: 'pa', r, m };
  if (f) e.f = f;
  return e;
}
