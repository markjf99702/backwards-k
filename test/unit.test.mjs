// The rules of scoring, without a browser:  node --test test/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, suggest, check, runsCount, scoredAs, mark, now, columns, halfLabel, RESULTS, runnersOn, pitchDay, pitchStat, pitchWork, pitchCount, winningRun, fits, misfit, official, winner, endNote, regulation, limitState, restDays, restBand, noCatch, sameSoFar, clockOf } from '../js/engine.js';
import { newGame, cleanGame, cleanDoc, parseLineup, parsePaste, takeBack, putBack, starters, newer, merge, seenOf, carried, setField } from '../js/model.js';
import { sampleGame } from '../js/sample.js';
// The card is drawn with ui.js, which looks for the page's sheet as it loads: here there's no page, so no sheet.
globalThis.document ??= { readyState: 'complete', getElementById: () => null };
const { lineHtml, cellSvg, cardHtml, cardName } = await import('../js/card.js');
const { playsHtml, boxHtml, dayOf } = await import('../js/box.js');

const game = (opts = {}) => newGame({ away: 'Foxes', home: 'Comets', ...opts });
// Plays one event after another, filling in the suggested runner moves the way the app does.
function play(g, ...evs) {
  for (const e of evs) {
    if (typeof e === 'string') {
      const [r, ...f] = e.split(' ');
      const S = replay(g), ev = { t: 'pa', r, m: suggest(S, r) };
      if (f.length) ev.f = f.map(Number);
      g.ev.push(ev);
    } else g.ev.push(e);
  }
  return replay(g);
}
const P = k => ({ t: 'p', k });
const threeK = ['K', 'K', 'K'];

test('three strikeouts end the half-inning and the home team comes up', () => {
  const S = play(game(), ...threeK);
  assert.equal(S.half, 1);
  assert.equal(S.inn, 1);
  assert.equal(S.outs, 0);
  assert.deepEqual(S.line[0], [0]);
  assert.equal(S.cells.filter(c => c.outN).map(c => c.outN).join(), '1,2,3');
  assert.equal(S.cells[2].end, true);
  assert.equal(halfLabel(S), 'Bottom 1st');
});

test('four balls walk the batter, and a walk with the bases loaded forces in a run', () => {
  const g = game();
  let S = play(g, P('b'), P('b'), P('b'));
  assert.equal(S.b, 3);
  S = play(g, P('b'));
  assert.ok(S.bases[1], 'the batter walked to first');
  assert.equal(S.cells[0].r, 'BB');
  S = play(g, 'BB', 'BB', 'BB');
  assert.equal(S.R[0], 1);
  assert.equal(S.cells[3].rbi, 1);
  assert.ok(S.bases[1] && S.bases[2] && S.bases[3]);
});

test('three strikes are a strikeout: swinging or looking, and fouls stop at two strikes', () => {
  const g = game();
  let S = play(g, P('f'), P('f'), P('f'), P('f'));
  assert.equal(S.s, 2);
  S = play(g, P('c'));
  assert.equal(S.cells[0].r, 'KL');
  S = play(g, P('s'), P('s'), P('s'));
  assert.equal(S.cells[1].r, 'K');
  assert.equal(S.outs, 2);
  const pit = S.pitching[1][0];
  assert.equal(pit.np, 8);
  assert.equal(pit.k, 2);
});

test('a single moves every runner up one; a home run clears the bases', () => {
  const g = game();
  let S = play(g, '2B', '1B');
  assert.ok(S.bases[1] && S.bases[3] && !S.bases[2]);
  S = play(g, 'HR');
  assert.equal(S.R[0], 3);
  assert.equal(S.cells[2].rbi, 3);
  assert.equal(S.cells[2].scored, true);
  assert.equal(S.H[0], 3);
  assert.ok(!S.bases[1] && !S.bases[2] && !S.bases[3]);
});

test('runners advancing on a hit are marked with the batter’s place in the order', () => {
  const g = game();
  const S = play(g, '1B', '2B');
  assert.equal(S.cells[0].reach, 3);
  assert.equal(S.cells[0].notes[3], '2');
});

test('a double play with a runner on first gets two outs and leaves the bases empty', () => {
  const S = play(game(), '1B', 'DP 6 4 3');
  assert.equal(S.outs, 2);
  assert.ok(!S.bases[1]);
  assert.equal(S.cells[1].mark, '6-4-3 DP');
  assert.equal(S.cells[0].outAt, 2);
});

test('on a double play the runner’s box gets the throws that put him out, and the batter’s the whole play', () => {
  let S = play(game(), '1B', 'DP 6 4 3');
  assert.deepEqual([S.cells[0].outHow, S.cells[1].mark], ['6-4', '6-4-3 DP']);
  S = play(game(), '1B', 'DP 3 6 1');
  assert.equal(S.cells[0].outHow, '3-6');
  // Two fielders (a line drive and a throw to first to double him off) or a fielder's choice: as they were.
  S = play(game(), '1B', { t: 'pa', r: 'DP', f: [6, 3], m: [[0, 0], [1, 0]] });
  assert.equal(S.cells[0].outHow, '6-3');
  S = play(game(), '1B', 'FC 6 4');
  assert.equal(S.cells[0].outHow, '6-4');
  // Two runners out on a triple play: each keeps the whole play.
  S = play(game(), '1B', '1B', { t: 'pa', r: 'TP', f: [5, 4, 3], m: [[0, 0], [1, 0], [2, 0]] });
  assert.deepEqual([S.cells[0].outHow, S.cells[1].outHow], ['5-4-3', '5-4-3']);
});

test('a runner put out on a hit is out where the scorer says: from second, at home; from first, at third', () => {
  // Without a word, at the next base, as before.
  let S = play(game(), '2B', { t: 'pa', r: '1B', m: [[0, 1], [2, 0]] });
  assert.deepEqual([S.cells[0].outAt, S.cells[0].reach], [3, 2]);
  assert.match(S.text.at(-1), /is out at third\./);
  // Thrown out at the plate: third was his on the way, with the batter's number there, and the bar across the way home.
  S = play(game(), '2B', { t: 'pa', r: '1B', m: [[0, 1], [2, 0, '@4']] });
  const c = S.cells[0];
  assert.deepEqual([c.outAt, c.reach, c.notes[3], c.outN], [4, 3, '2', 1]);
  assert.equal(S.text.at(-1), 'Batter 2 singles. Batter 1 is out at home.');
  assert.deepEqual(c.story, ['Out at home on Batter 2’s single.']);
  assert.match(cellSvg(c), /<line class="path" x1="11" y1="32"/, 'the line starts at third');
  // From first, out at third trying to go two; and the batter out at third stretching a single.
  S = play(game(), '1B', { t: 'pa', r: '1B', m: [[0, 1], [1, 0, '@3']] });
  assert.deepEqual([S.cells[0].reach, S.cells[0].outAt], [2, 3]);
  assert.match(S.text.at(-1), /Batter 1 is out at third/);
  S = play(game(), { t: 'pa', r: '1B', m: [[0, 0, '@3']] });
  assert.deepEqual([S.cells[0].reach, S.cells[0].outAt, S.outs], [2, 3, 1]);
  assert.equal(S.text.at(-1), 'Batter 1 singles, but is out trying for third.');
  // A base he can't have been out at (behind him, or one that isn't a base) is the next one.
  S = play(game(), '2B', { t: 'pa', r: '1B', m: [[0, 1], [2, 0, '@2']] }, { t: 'pa', r: '1B', m: [[0, 0, '@9']] });
  assert.deepEqual([S.cells[0].outAt, S.cells[2].outAt], [3, 2]);
  // Kept from a file and a link.
  const g = game();
  play(g, '2B', { t: 'pa', r: '1B', m: [[0, 1], [2, 0, '@4']] });
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))).ev[1].m, [[0, 1], [2, 0, '@4']]);
  assert.equal(newer(g), false);
});

test('an extra base on the throw or on an error: said so, drawn so, and an error is charged and earns no RBI (OBR 9.04, 9.12)', () => {
  // From first to third on a single, on the throw: the batter's number at second, T at third.
  let S = play(game(), '1B', { t: 'pa', r: '1B', m: [[0, 1], [1, 3, 'T']] });
  assert.equal(S.text.at(-1), 'Batter 2 singles. Batter 1 to third on the throw.');
  assert.deepEqual([S.cells[0].notes, S.cells[0].story], [['', '', '2', 'T', ''], ['To third on Batter 2’s single, on the throw.']]);
  assert.equal(S.E[1], 0);
  // From first, home on the right fielder's error: an error, the run, and no RBI for it.
  S = play(game(), '3B', 'BB', { t: 'pa', r: '1B', m: [[0, 1], [1, 4, 'E', [9]], [3, 4]] });
  assert.equal(S.text.at(-1), 'Batter 3 singles. Batter 1 scores. Batter 2 scores on an error by the right fielder (E9). Foxes take the lead, 2–0.');
  assert.deepEqual([S.R[0], S.cells[2].rbi, S.bat['0.2.0'].rbi, S.E[1], S.errs[1], S.eInn[0]], [2, 1, 1, 1, [9], [1]]);
  assert.deepEqual(S.cells[1].notes, ['', '', '3', '', 'E9']);
  // The batter takes second on the throw, or comes all the way home on errors; the fielder needn't be said.
  S = play(game(), { t: 'pa', r: '1B', m: [[0, 2, 'T']] });
  assert.equal(S.text.at(-1), 'Batter 1 singles and takes second on the throw.');
  assert.deepEqual([S.cells[0].reach, S.cells[0].notes[2], S.bases[2].cell.n], [2, 'T', 0]);
  S = play(game(), { t: 'pa', r: '1B', m: [[0, 4, 'E']] });
  assert.equal(S.text.at(-1), 'Batter 1 singles and comes all the way home on an error by the fielder. Foxes take the lead, 1–0.');
  assert.deepEqual([S.R[0], S.cells[0].rbi, S.E[1], S.errs[1]], [1, 0, 1, [0]]);
  // Reached on the shortstop's error, and the runner from second scored on it too: one error. On another fielder's
  // throw after it, two.
  S = play(game(), '2B', { t: 'pa', r: 'E', f: [6], m: [[0, 1], [2, 4, 'E', [6]]] });
  assert.deepEqual([S.E[1], S.errs[1]], [1, [6]]);
  S = play(game(), '2B', { t: 'pa', r: 'E', f: [6], m: [[0, 1], [2, 4, 'E', [2]]] });
  assert.deepEqual([S.E[1], S.errs[1]], [2, [6, 2]]);
  // Only past where the play takes him: a runner who went where a single takes him, or the batter on a double to
  // second, is there on the play, whatever the move says.
  S = play(game(), '1B', { t: 'pa', r: '2B', m: [[0, 2, 'E', [9]], [1, 3, 'T']] });
  assert.equal(S.text.at(-1), 'Batter 2 doubles. Batter 1 to third.');
  assert.equal(S.E[1], 0);
  // Two who scored on the same throw, in one sentence; kept from a file and a link.
  const g = game();
  S = play(g, '1B', '1B', { t: 'pa', r: '1B', m: [[0, 1], [1, 4, 'T'], [2, 4, 'T']] });
  assert.equal(S.text.at(-1), 'Batter 3 singles. Batter 1 and Batter 2 score on the throw. Foxes take the lead, 2–0.');
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))), g);
  g.ev.push({ t: 'pa', r: '1B', m: [[0, 1], [1, 3, 'E', [8]]] });
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))).ev.at(-1).m, [[0, 1], [1, 3, 'E', [8]]]);
});

test('a fielder’s choice puts out the runner from first and leaves the batter on', () => {
  const g = game();
  let S = play(g, '1B');
  assert.deepEqual(suggest(S, 'FC'), [[0, 1], [1, 0]]);
  S = play(g, 'FC 6 4');
  assert.equal(S.outs, 1);
  assert.equal(S.bases[1].cell.n, 1);
});

test('a sacrifice fly scores the runner from third, with an RBI and no at-bat', () => {
  const S = play(game(), '3B', 'SF 8');
  assert.equal(S.R[0], 1);
  assert.equal(S.cells[1].rbi, 1);
  assert.equal(S.bat['0.1.0'].ab, 0);
  assert.equal(S.cells[1].mark, 'SF8');
});

test('caught stealing for the third out: the batter at the plate leads off the next inning', () => {
  const g = game();
  let S = play(g, 'K', 'K', '1B', P('b'));
  assert.equal(S.up[0], 3);
  S = play(g, { t: 'r', m: [[1, 0, 'CS', [2, 6]]] });
  assert.equal(S.half, 1);
  assert.equal(S.b, 0);
  S = play(g, ...threeK);
  assert.equal(now(S).slot, 3, 'the fourth batter leads off the 2nd');
  assert.equal(S.cells[2].outHow, 'CS 2-6');
});

test('stolen bases and wild pitches move runners without a plate appearance', () => {
  const g = game();
  let S = play(g, '1B', { t: 'r', m: [[1, 2, 'SB']] }, { t: 'r', m: [[2, 4, 'WP']] });
  assert.equal(S.R[0], 1);
  assert.equal(S.cells[0].notes[2], 'SB');
  assert.equal(S.cells[0].notes[4], 'WP');
  assert.equal(S.bat['0.0.0'].sb, 1);
  assert.equal(S.cells.length, 1);
});

test('defensive indifference: he takes second, and it isn’t a stolen base (OBR 9.07(g))', () => {
  const g = game();
  const S = play(g, '1B', { t: 'r', m: [[1, 2, 'DI']] });
  assert.equal(S.text.at(-1), 'Batter 1 takes second on defensive indifference.');
  assert.deepEqual([S.cells[0].notes[2], S.cells[0].story, S.bat['0.0.0'].sb, S.plays.at(-1).mark], ['DI', ['Took second on defensive indifference.'], 0, 'DI']);
  assert.match(boxHtml(S), /Left on base/);
  assert.doesNotMatch(boxHtml(S), /Stolen bases/);
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))), g);
  assert.equal(newer(g), false);
});

test('a runner can’t be moved onto a base someone is still on', () => {
  const g = game();
  play(g, 'CI', '2B');
  const S = play(g, { t: 'r', m: [[2, 3, 'E', [6]]] });
  assert.equal(S.bases[2].cell.n, 1, 'the batter who doubled is still on second');
  assert.equal(S.bases[3].cell.n, 0, 'the runner on third is still there');
  assert.equal(S.E[1], 1, 'the catcher’s interference, and no error for the move that couldn’t happen');
  // Two runners moving up together is fine: the one ahead goes first.
  const S2 = play(g, { t: 'r', m: [[3, 4, 'WP'], [2, 3, 'WP']] });
  assert.equal(S2.R[0], 1);
  assert.equal(S2.bases[3].cell.n, 1);
});

test('one error is one error however many runners move up on it, and catcher’s interference is one (OBR 9.12)', () => {
  const g = game();
  let S = play(g, '1B', 'BB', { t: 'r', m: [[2, 3, 'E', [1]], [1, 2, 'E', [1]]] });
  assert.deepEqual(S.E, [0, 1], 'a wild pickoff throw that moves two runners is one error');
  assert.deepEqual(S.eInn, [[1], []]);
  S = play(g, { t: 'r', m: [[3, 4, 'WP'], [2, 3, 'WP']] });
  assert.equal(S.pitching[1][0].wp, 1, 'and a wild pitch that moves two is one wild pitch');
  // With the bases loaded, catcher's interference is an error on the catcher (9.12(c)), and the run forced in is
  // batted in (9.04(a)(2)).
  S = play(g, 'BB', 'BB', 'CI');
  assert.deepEqual(S.E, [0, 2]);
  assert.equal(S.R[0], 2);
  assert.equal(S.cells.at(-1).rbi, 1);
  assert.equal(S.bat['0.4.0'].ab, 0, 'no at-bat');
});

test('the home team wins as soon as it goes ahead in the last inning', () => {
  const g = game({ innings: 1 });
  let S = play(g, ...threeK, '1B');
  assert.equal(S.over, false);
  S = play(g, 'HR');
  assert.equal(S.over, true);
  assert.equal(halfLabel(S), 'Final');
  assert.equal(S.R[1], 2);
});

test('a walk-off’s last box gets the red line under it, like the end of any inning', () => {
  const S = play(game({ innings: 1 }), ...threeK, '1B', 'HR');
  assert.equal(S.over, true);
  assert.equal(S.cells.at(-1).end, true);
  assert.equal(S.cells.at(-2).end, false);
});

test('a hit that wins the game: the winning run is the last to score, and the hit counts for the bases it needed (OBR 9.06(f))', () => {
  // Tied in the bottom of the last with the bases loaded: a double is a single, one run scores, everyone moves up one.
  let S = play(game({ innings: 1 }), ...threeK, '1B', '1B', '1B', '2B');
  const c = S.cells.at(-1);
  assert.equal(S.over, true);
  assert.deepEqual(S.R, [0, 1]);
  assert.deepEqual([c.r, c.mark, c.reach, c.rbi], ['1B', '1B', 1, 1]);
  assert.equal(S.text.at(-1), 'Batter 4 singles. Batter 1 scores the winning run. Batter 2 to third. Batter 3 to second. It went for a double, but counts as a single: the winning run needed only one base.');
  assert.deepEqual([1, 2, 3].map(b => S.bases[b] && S.bases[b].slot), [3, 2, 1]);
  assert.deepEqual(S.lob[1], [3], 'the three still on are left on base');
  assert.equal(Object.values(S.bat).reduce((a, b) => a + b.d, 0), 0, 'no double in the box score');
  assert.doesNotMatch(boxHtml(S), /Doubles/);
  assert.deepEqual(scorersProof(S, 1), [4, 4]);
  // Down one with runners on second and third: a triple brings in the tying run and then the winning one, and counts
  // as a double.
  const g = game({ innings: 1 });
  play(g, 'HR', ...threeK, '2B', { t: 'pa', r: '2B', m: [[2, 3], [0, 2]] });
  S = play(g, '3B');
  assert.deepEqual(S.R, [1, 2]);
  assert.equal(S.cells.at(-1).r, '2B');
  assert.equal(S.text.at(-1), 'Batter 3 doubles. Batter 1 scores, and Batter 2 scores the winning run. It went for a triple, but counts as a double: the winning run needed only two bases.');
  // A home run: everyone scores (9.06(g)).
  S = play(game({ innings: 1 }), ...threeK, '1B', '1B', '1B', 'HR');
  assert.deepEqual(S.R, [0, 4]);
  assert.equal(S.cells.at(-1).r, 'HR');
  // A walk with the bases loaded forces in one run, and a single the batter came all the way home on is still a single.
  S = play(game({ innings: 1 }), ...threeK, '1B', '1B', '1B', 'BB');
  assert.deepEqual([S.R[1], S.text.at(-1)], [1, 'Batter 4 walks. Batter 1 scores the winning run. Batter 2 to third. Batter 3 to second.']);
  S = play(game({ innings: 1 }), ...threeK, { t: 'pa', r: '1B', m: [[0, 4]] });
  assert.deepEqual([S.R[1], S.cells.at(-1).r, S.text.at(-1)], [1, '1B', 'Batter 1 singles and comes all the way home with the winning run.']);
  // Runners moving up without a hit: the winning run scores, and the one behind it stops a base on.
  S = play(game({ innings: 1 }), ...threeK, '2B', '1B', { t: 'r', m: [[3, 4, 'WP'], [1, 3, 'WP']] });
  assert.deepEqual(S.R, [0, 1]);
  assert.equal(S.text.at(-1), 'Batter 1 scores the winning run on a wild pitch. Batter 2 moves to second on a wild pitch.');
  assert.equal(S.bases[2].slot, 1);
  S = play(game({ innings: 1 }), ...threeK, '3B', { t: 'r', m: [[3, 4, 'SB']] });
  assert.equal(S.text.at(-1), 'Batter 1 steals home with the winning run.');
  // Before the last inning, or after Keep playing past a final, everyone scores as before.
  S = play(game({ innings: 2 }), ...threeK, '1B', '1B', '1B', '2B');
  assert.deepEqual(S.R, [0, 2]);
  assert.equal(S.cells.at(-1).r, '2B');
  S = play(game({ innings: 1 }), ...threeK, 'HR', { t: 'on' }, '1B', '1B', '2B');
  assert.deepEqual([S.R, S.cells.at(-1).r], [[0, 2], '2B']);
  // Play went on after the play that won it (Keep playing, for a league that plays the inning out, or plays scored
  // after it in a game an older version saved): every run on it counts, and the double is a double, as it was.
  const on = game({ innings: 1 });
  play(on, ...threeK, '1B', '1B', '1B', '2B');
  S = play(on, { t: 'on' }, ...threeK);
  assert.deepEqual([S.R, S.cells.at(-4).r, S.text[on.ev.length - 5]], [[0, 2], '2B', 'Batter 4 doubles. Batter 1 and Batter 2 score. Batter 3 to third.']);
  assert.deepEqual([S.over, scorersProof(S, 1)], [true, [7, 7]]);
  assert.deepEqual(replay(on, on.ev.length - 4).R, [0, 1], 'before Keep playing, the final as it was');
  S = play(game({ innings: 1 }), ...threeK, '2B', '1B', { t: 'r', m: [[3, 4, 'WP'], [1, 3, 'WP']] }, { t: 'pa', r: 'K', m: [[3, 3], [0, 0]] });
  assert.deepEqual([S.R, S.bases[3] && S.bases[3].slot], [[0, 1], 1], 'a wild pitch, then a play from an older version');
});

test('the runners sheet knows a hit that wins it: how many bases the winning run took', () => {
  const S = play(game({ innings: 1 }), ...threeK, '1B', '1B', '1B');
  assert.equal(winningRun(S, '2B', suggest(S, '2B')), 1);
  assert.equal(winningRun(S, 'HR', suggest(S, 'HR')), 0, 'a home run');
  assert.equal(winningRun(S, '2B', suggest(S, '2B'), 1), 0, 'runs that don’t count');
  assert.equal(winningRun(S, 'GO', suggest(S, 'GO')), 1, 'a run forced in on a ground out');
  assert.equal(winningRun(play(game({ innings: 2 }), ...threeK, '1B'), '2B', [[1, 4], [0, 2]]), 0, 'not the last inning');
});

test('the marks in a box don’t print over each other', () => {
  const at = (svg, word) => [...svg.matchAll(/<text class="(\w+)" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)</g)].filter(m => m[4] === word).map(m => m[2] + ',' + m[3]);
  // Stole second and was picked off there: the PO goes inside the diamond, not on the SB.
  let S = play(game(), '1B', { t: 'r', m: [[1, 2, 'SB']] }, { t: 'r', m: [[2, 0, 'PO', [2, 6]]] });
  let svg = cellSvg(S.cells[0]);
  assert.equal(at(svg, 'SB').length, 1);
  assert.equal(at(svg, 'PO').length, 1);
  assert.notDeepEqual(at(svg, 'PO'), at(svg, 'SB'));
  // Walked and picked off first: the PO is clear of the BB in the corner.
  S = play(game(), 'BB', { t: 'r', m: [[1, 0, 'PO', [1, 3]]] });
  svg = cellSvg(S.cells[0]);
  assert.notDeepEqual(at(svg, 'PO'), at(svg, 'BB'));
  // A note at third sits below the circled out number, not under it.
  S = play(game(), '2B', { t: 'r', m: [[2, 3, 'SB']] }, 'K', 'K', 'K');
  const y = +at(cellSvg(S.cells[0]), 'SB')[0].split(',')[1];
  assert.ok(y - 7 > 7.5 + 5.6, 'the SB at third (capitals about 7 high) clears the circle in the corner');
  // A long mark in the corner is drawn smaller, clear of home plate.
  S = play(game(), '1B', 'FC 6 4');
  assert.match(cellSvg(S.cells[1]), /class="mk sm"[^>]*>FC 6-4</);
  assert.match(cellSvg(S.cells[0]), /class="mk"[^>]*>1B</);
});

test('the bottom of the last inning isn’t played when the home team is already ahead', () => {
  const g = game({ innings: 2 });
  let S = play(g, ...threeK, 'HR', ...threeK, ...threeK);
  assert.equal(S.over, true);
  assert.equal(S.line[1].length, 1, 'no bottom of the 2nd');
  S = play(g, { t: 'on' });
  assert.equal(S.over, false);
  assert.equal(S.half, 1);
  assert.equal(S.inn, 2);
});

test('Keep playing after the final finishes that half-inning, and then the game is over', () => {
  // The home team leads after the top of the 2nd: Final, with an X. Keep playing, and the bottom half is played.
  const g = game({ innings: 2 });
  let S = play(g, ...threeK, 'HR', ...threeK, ...threeK, { t: 'on' }, '1B', 'HR');
  assert.equal(S.over, false, 'no walk-off while finishing the half');
  assert.equal(S.R[1], 3);
  S = play(g, ...threeK);
  assert.equal(S.over, true);
  assert.equal(halfLabel(S), 'Final');
  assert.deepEqual(S.line, [[0, 0], [1, 2]]);
  // A walk-off, then Keep playing: the rest of the half, then it's over.
  const w = game({ innings: 1 });
  S = play(w, ...threeK, '1B', 'HR', { t: 'on' }, 'HR', 'K', 'K');
  assert.equal(S.over, false);
  S = play(w, 'K');
  assert.equal(S.over, true);
  assert.equal(S.inn, 1);
  assert.equal(S.R[1], 3);
});

test('Keep playing after a walk-off, then End the game here and Keep playing again: the half is still played out', () => {
  const g = game({ innings: 1 });
  let S = play(g, ...threeK, '1B', 'HR', { t: 'on' }, { t: 'end', why: 'time' }, { t: 'on' });
  assert.deepEqual([S.over, S.R], [false, [0, 2]]);
  S = play(g, 'HR');
  assert.deepEqual([S.over, S.R[1]], [false, 3], 'the home team ahead doesn’t end it again mid-half');
  S = play(g, 'K', 'K', 'K');
  assert.deepEqual([S.over, halfLabel(S)], [true, 'Final']);
});

test('a called game that picks up again ends the usual way', () => {
  const g = game({ innings: 1 });
  let S = play(g, ...threeK, { t: 'end' });
  assert.equal(halfLabel(S), 'Called');
  S = play(g, { t: 'on' }, 'K', 'HR');
  assert.equal(S.over, true, 'a walk-off home run');
  assert.equal(halfLabel(S), 'Final');
  assert.equal(S.R[1], 1);
});

test('a delay stops play and the game waits: Delayed, top 5th, until Resume or the next play', async () => {
  const g = game();
  let S = play(g, ...Array(24).fill('K'), '1B', P('b'), { t: 'delay' });
  assert.deepEqual([S.over, S.delayed, halfLabel(S)], [false, true, 'Delayed, top 5th']);
  assert.equal(S.text.at(-1), 'Play stops for a delay.');
  assert.deepEqual([S.b, !!S.bases[1], S.outs], [1, true, 0], 'the count, the runner and the outs wait with it');
  const { summary } = await import('../js/share.js');
  assert.match(summary(g), /^Foxes 0, Comets 0 \(Delayed, top 5th\)/);
  S = play(g, { t: 'on' });
  assert.deepEqual([S.delayed, halfLabel(S), S.text.at(-1), S.b], [false, 'Top 5th', 'Play resumes.', 1]);
  // A play during a delay means play went on; and a delay can end in the game ending.
  S = play(g, { t: 'delay' }, P('b'));
  assert.deepEqual([S.delayed, S.b], [false, 2]);
  S = play(g, { t: 'delay' }, { t: 'end' });
  assert.deepEqual([S.over, S.delayed, halfLabel(S)], [true, false, 'Called']);
  // Between half-innings: the delay is before the next half.
  S = play(game(), ...threeK, { t: 'delay' });
  assert.equal(halfLabel(S), 'Delayed, bottom 1st');
});

test('a game over on a run rule or a time limit is Final, and says why after the score', async () => {
  const { summary } = await import('../js/share.js');
  const g = game({ innings: 6 });
  let S = play(g, 'HR', 'HR', 'HR', 'HR', 'HR', 'HR', 'HR', 'HR', 'HR', 'HR', 'HR', ...threeK, ...threeK, ...threeK, ...threeK, ...threeK, ...threeK, { t: 'end', why: 'rule' });
  assert.deepEqual([S.over, halfLabel(S), endNote(S), winner(S)], [true, 'Final', 'run rule', 0]);
  assert.equal(S.text.at(-1), 'The game is over on the run rule.');
  assert.match(summary(g), /^Foxes 11, Comets 0 \(Final, run rule\)\n/);
  // Keep playing picks it up where it stopped.
  S = play(g, { t: 'on' });
  assert.deepEqual([S.over, halfLabel(S), endNote(S)], [false, 'Top 4th', '']);
  S = play(g, { t: 'end', why: 'time' });
  assert.deepEqual([halfLabel(S), endNote(S), S.text.at(-1)], ['Final', 'time limit', 'The game is over on the time limit.']);
  assert.match(summary(g), /\(Final, time limit\)/);
  // Saved and read back, the reasons are kept; one from a newer version is kept too, reads as called, and makes the
  // game look-only; one that isn't a word is left out.
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(c, g);
  assert.equal(newer(c), false);
  g.ev.push({ t: 'on' }, { t: 'end', why: 'forfeit' });
  assert.deepEqual([halfLabel(replay(g)), newer(cleanGame(g)), cleanGame(g).ev.at(-1)], ['Called', true, { t: 'end', why: 'forfeit' }]);
  g.ev.push({ t: 'on' }, { t: 'end', why: { a: 1 } }, { t: 'delay', x: 1 });
  assert.deepEqual(cleanGame(g).ev.slice(-2), [{ t: 'end' }, { t: 'delay', x: 1 }]);
});

test('a called game before it is official has no winner: the team in front is ahead (OBR 7.01(c))', async () => {
  const { summary } = await import('../js/share.js');
  // Nine innings: called in the top of the 5th, the Foxes ahead 1-0. Not official.
  let g = game();
  let S = play(g, 'HR', ...Array(26).fill('K'), { t: 'end' });
  assert.deepEqual([halfLabel(S), official(S), winner(S), endNote(S)], ['Called', false, null, 'before it was official']);
  assert.match(summary(g), /^Foxes 1, Comets 0 \(Called, before it was official\)/);
  // After five innings it counts: the Foxes win.
  g = game();
  S = play(g, 'HR', ...Array(30).fill('K'), { t: 'end' });
  assert.deepEqual([S.inn, S.half, official(S), winner(S), endNote(S)], [5, 1, true, 0, '']);
  assert.match(summary(g), /^Foxes 1, Comets 0 \(Called\)/);
  // Four and a half, with the home team ahead, counts too (OBR 7.01(c)(2)); with the visitors ahead, it doesn't.
  S = play(game(), ...threeK, 'HR', ...Array(24).fill('K'), { t: 'end' });
  assert.deepEqual([S.inn, S.half, official(S), winner(S)], [5, 0, true, 1]);
  S = play(game(), 'HR', ...Array(27).fill('K'), { t: 'end' });
  assert.deepEqual([S.inn, S.half, official(S), winner(S)], [5, 0, false, null]);
  // Six innings (Little League 4.10(c)): four count.
  S = play(game({ innings: 6 }), 'HR', ...Array(24).fill('K'), { t: 'end' });
  assert.deepEqual([official(S), winner(S)], [true, 0]);
  assert.deepEqual([3, 4, 5, 6, 7, 9].map(regulation), [2, 3, 4, 4, 5, 5]);
});

// The cells of one team's row in the line score, as text.
const lineRow = (S, side) => [...lineHtml(S).split('<tbody>')[1].split('</tr>')[side].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1]);

test('a game ended between half-innings stops after the last half played (a mercy rule, rain)', () => {
  // A 3-inning game called right after the bottom of the 1st: the visitors never batted in the 2nd.
  const g = game({ innings: 3 });
  let S = play(g, '1B', ...threeK, ...threeK, { t: 'end' });
  assert.equal(halfLabel(S), 'Called');
  assert.deepEqual(S.line, [[0], [0]]);
  assert.deepEqual(S.hInn, [[1], [0]]);
  assert.deepEqual(S.eInn, [[0], [0]]);
  assert.deepEqual(S.lob, [[1], [0]], 'no runners left on base in a half nobody batted in');
  assert.deepEqual([S.inn, S.half], [1, 1]);
  const called = S.plays.at(-1);
  assert.equal(called.text, 'The game is called.');
  assert.deepEqual([called.inn, called.half], [1, 1], 'filed under the bottom of the 1st');
  assert.deepEqual(lineRow(S, 0), ['0', '', '', '0', '1', '0']);
  // Keep playing starts the top of the 2nd, and its runs go there.
  S = play(g, { t: 'on' }, 'HR');
  assert.deepEqual([S.inn, S.half], [2, 0]);
  assert.deepEqual(S.line, [[0, 1], [0]]);
  // Ended in the middle of a half: that half stays, with its runners left on.
  const m = game({ innings: 3 });
  S = play(m, ...threeK, '1B', { t: 'end' });
  assert.deepEqual(S.line, [[0], [0]]);
  assert.deepEqual(S.lob, [[0], [1]]);
  assert.deepEqual([S.inn, S.half], [1, 1]);
});

test('a run limit ends the half early, and a game called there with the home team ahead shows X', () => {
  // Six innings; the Comets lead 1-0 after the top of the 4th, which ended on the run limit (here, with no runs).
  const g = game({ innings: 6 });
  let S = play(g, ...threeK, 'HR', ...threeK, ...threeK, ...threeK, ...threeK, ...threeK, 'K', { t: 'eoh' });
  assert.equal(S.text[g.ev.length - 1], 'Ended the top of the 4th early.');
  assert.equal(S.plays.at(-1).text, 'End of the top of the 4th, ended early: Foxes 0, Comets 1.');
  S = play(g, { t: 'pch', s: 0, i: 0 }, { t: 'end' });
  assert.deepEqual(S.line, [[0, 0, 0, 0], [1, 0, 0]]);
  assert.deepEqual(lineRow(S, 1), ['1', '0', '0', 'X', '', '', '1', '1', '0']);
  assert.deepEqual(lineRow(S, 0).slice(0, 6), ['0', '0', '0', '0', '', '']);
  assert.ok(S.plays.slice(-2).every(p => p.inn === 4 && p.half === 0), 'the pitching change and the call are in the top of the 4th');
  // Called in the middle of the top of the 4th instead: the Comets didn't get their turn, so no X.
  g.ev.splice(g.ev.findIndex(e => e.t === 'eoh'));
  S = play(g, { t: 'end' });
  assert.deepEqual(lineRow(S, 1).slice(0, 4), ['1', '0', '0', '']);
});

test('plays saved after what is now the final (fewer innings set since) stay with the team that was batting', () => {
  const g = game();
  play(g, 'HR', ...threeK, ...threeK, ...threeK, ...threeK, '1B', ...threeK, '1B', ...threeK);
  g.innings = 1;
  const S = replay(g);
  const count = (side, inn) => S.cells.filter(c => c.side === side && (!inn || c.inn === inn)).length;
  assert.deepEqual([count(0), count(1)], [11, 10]);
  assert.deepEqual([count(0, 3), count(1, 3)], [4, 4]);
  assert.deepEqual(S.line, [[1, 0, 0], [0, 0, 0]]);
  assert.equal(S.over, true);
});

test('a tie after the last inning goes to extra innings', () => {
  const g = game({ innings: 1 });
  const S = play(g, ...threeK, ...threeK);
  assert.equal(S.over, false);
  assert.equal(S.inn, 2);
  assert.equal(columns(S, 0).length, 2);
});

test('a game that went to extra innings is Final/10, as box scores put it', () => {
  const g = game();
  let S = play(g, ...Array(54).fill('K'), 'HR', ...threeK);
  assert.equal(halfLabel(S), 'Bottom 10th');
  S = play(g, ...threeK);
  assert.deepEqual([S.over, halfLabel(S)], [true, 'Final/10']);
  // Nine innings is just Final, and a game called in extra innings is still Called.
  assert.equal(halfLabel(play(game(), ...threeK, 'HR', ...Array(48).fill('K'))), 'Final');
  assert.equal(halfLabel(play(game(), ...Array(54).fill('K'), { t: 'end' })), 'Called');
});

test('a team that bats around gets another column for that inning', () => {
  const g = game();
  const S = play(g, ...Array(10).fill('1B'));
  assert.equal(S.cells[9].k, 1);
  assert.equal(S.cells[9].slot, 0);
  assert.equal(columns(S, 0).filter(c => c.inn === 1).length, 2);
});

test('check() catches moves that couldn’t happen', () => {
  const g = game();
  const S = play(g, '1B', '1B');
  assert.equal(check(S, [[0, 1], [1, 2], [2, 3]]), '');
  assert.match(check(S, [[0, 1], [1, 1], [2, 3]]), /both be on first/);
  assert.match(check(S, [[0, 1], [1, 4], [2, 3]]), /pass/);
  assert.match(check(S, [[0, 1], [1, 2]]), /runner on second/);
  assert.match(check(S, [[0, 1], [1, 2], [2, 1]]), /back/);
});

test('runs on a play that makes the third out on a force don’t count', () => {
  const g = game();
  let S = play(g, 'K', 'K', '1B', '1B', '1B');
  const m = [[0, 1], [1, 2], [2, 3], [3, 4]];
  assert.equal(runsCount(S, 'FC', [[0, 1], [1, 0], [2, 3], [3, 4]]), false);
  assert.equal(runsCount(S, 'GO', [[0, 0], [1, 2], [2, 3], [3, 4]]), false, 'batter out before reaching first');
  assert.equal(runsCount(S, '1B', [[0, 1], [1, 2], [2, 0], [3, 4]]), true, 'a runner thrown out after the run scored');
  assert.equal(runsCount(S, '1B', m), true);
  g.ev.push({ t: 'pa', r: 'FC', m: [[0, 1], [1, 0], [2, 3], [3, 4]], x: 1 });
  S = replay(g);
  assert.equal(S.R[0], 0);
  assert.equal(S.half, 1);
});

test('a batter thrown out stretching a hit for the third out: a run that crossed first counts (a time play)', () => {
  const g = game();
  const S = play(g, '2B', 'K', 'K');
  assert.equal(runsCount(S, '1B', [[0, 0], [2, 4]]), true);
  assert.equal(runsCount(S, 'E', [[0, 0], [2, 4]]), true);
  assert.equal(runsCount(S, 'GO', [[0, 0], [2, 4]]), false, 'out at first: no run can score');
});

test('a runner who crosses the plate on the third out but doesn’t count is left on base', () => {
  const g = game();
  play(g, 'K', 'K', '1B', '1B', '1B');
  const S = play(g, { t: 'pa', r: 'FC', f: [6, 4], m: [[0, 1], [1, 0], [2, 3], [3, 4]], x: 1 });
  assert.equal(S.R[0], 0);
  assert.equal(S.lob[0][0], 3, 'the batter, the runner on third and the runner whose run didn’t count');
  assert.deepEqual(proof(S, 0, 1), [6, 6]);
  assert.equal(S.cells[2].scored, false);
  assert.match(S.cells[2].story.join(' '), /Crossed the plate, but the run doesn’t count\./);
  assert.match(S.text[g.ev.length - 1], /Batter 3 crosses the plate, but the run doesn’t count\./);
});

const sum = a => a.reduce((x, y) => x + y, 0);
// The scorer's proof of a team's box score (OBR 9.03(c)): at-bats, walks, hit batters, sacrifices and catcher's
// interference on one side; runs, runners left on base and the other team's putouts on the other.
function scorersProof(S, side) {
  const lines = Object.entries(S.bat).filter(([k]) => k.startsWith(side + '.')).map(([, b]) => b);
  const cells = S.cells.filter(c => c.side === side), n = r => cells.filter(c => c.r === r).length;
  return [
    sum(lines.map(b => b.ab + b.bb + b.hbp)) + n('SAC') + n('SF') + n('CI'),
    S.R[side] + sum(S.lob[side].map(x => x || 0)) + sum(S.pitching[1 - side].map(p => p ? p.outs : 0)),
  ];
}

// Every trip to the plate in a half-inning ends as a run, a runner left on base or an out (OBR 9.03(c)).
function proof(S, side, inn) {
  const cells = S.cells.filter(c => c.side === side && c.inn === inn);
  return [cells.length, (S.line[side][inn - 1] || 0) + (S.lob[side][inn - 1] || 0) + cells.filter(c => c.outN).length];
}

// League rules: Little League's mercy rule (4.10(e)), and the Minors' five runs a half-inning, not in the last inning.
const LL = { set: 'll', runs: 0, last: false, all: false, mercy: [[3, 15], [4, 10]] };
const MINORS = { ...LL, set: 'minors', runs: 5 };

test('league rules: the mercy rule ends the game, Final, with the reason (Little League 4.10(e))', async () => {
  const { summary } = await import('../js/share.js');
  // The visitors ten ahead after four innings.
  const g = game({ innings: 6, rules: LL });
  let S = play(g, ...Array(10).fill('HR'), ...threeK, ...Array(20).fill('K'));
  assert.deepEqual([S.over, S.inn, S.half], [false, 4, 1], 'ten ahead after three and a half: the home team bats');
  S = play(g, 'K');
  assert.deepEqual([S.over, halfLabel(S), winner(S), endNote(S)], [true, 'Final', 0, '10-run rule, 4 innings']);
  assert.match(S.text.at(-1), / That’s the game on the 10-run rule: the Foxes lead 10–0 after 4 innings\.$/);
  assert.equal(S.plays.at(-1).text, 'That’s the game on the 10-run rule: the Foxes lead 10–0 after 4 innings.');
  assert.match(summary(g), /^Foxes 10, Comets 0 \(Final, 10-run rule, 4 innings\)\n/);
  // The home team ten ahead after the top of the 4th doesn't need its turn: three and a half, with an X.
  const h = game({ innings: 6, rules: LL });
  S = play(h, ...threeK, ...Array(10).fill('HR'), ...threeK, ...Array(15).fill('K'));
  assert.deepEqual([S.over, endNote(S), lineRow(S, 1).slice(0, 5)], [true, '10-run rule, 3½ innings', ['10', '0', '0', 'X', '']]);
  // Fifteen ahead after three.
  S = play(game({ innings: 6, rules: LL }), ...Array(15).fill('HR'), ...Array(18).fill('K'));
  assert.deepEqual([S.over, S.inn, endNote(S)], [true, 3, '15-run rule, 3 innings']);
  // Without league rules the game goes on, as before.
  S = play(game({ innings: 6 }), ...Array(15).fill('HR'), ...Array(18).fill('K'));
  assert.deepEqual([S.over, S.inn, S.half], [false, 4, 0]);
});

test('league rules: the home team getting ten ahead in its half ends it there, and Keep playing finishes the half', () => {
  const g = game({ innings: 6, rules: LL });
  let S = play(g, ...threeK, ...Array(9).fill('HR'), ...threeK, ...Array(15).fill('K'), 'BB', 'HR');
  assert.deepEqual([S.over, S.between, S.R, endNote(S)], [true, false, [0, 11], '10-run rule, 4 innings']);
  assert.equal(S.text.at(-1), 'Batter 2 hits a two-run home run. Batter 1 scores. That’s the game on the 10-run rule: the Comets lead 11–0 after 4 innings.');
  // Keep playing: the rest of the half is played out (no mercy in the middle of it), and then it's over again.
  S = play(g, { t: 'on' }, 'HR', 'K', 'K');
  assert.deepEqual([S.over, S.R[1]], [false, 12]);
  S = play(g, 'K');
  assert.deepEqual([S.over, S.inn, S.half, halfLabel(S)], [true, 4, 1, 'Final']);
  // The visitors that far ahead in the middle of the bottom half don't end it: the home team bats.
  S = play(game({ innings: 6, rules: LL }), ...Array(10).fill('HR'), ...Array(21).fill('K'), 'K', 'K');
  assert.equal(S.over, false);
});

test('league rules: five runs a half-inning, not in the last inning, and a run past the limit doesn’t count', async () => {
  const g = game({ innings: 6, rules: MINORS });
  let S = play(g, 'HR', 'HR', 'HR', 'HR', 'BB', 'BB', 'BB', '2B');
  assert.equal(S.text.at(-1), 'Batter 8 doubles. Batter 5 scores. Batter 6 crosses the plate too, but the 5-run limit was reached, so the run doesn’t count. Batter 7 to third. That’s 5 runs: the half-inning is over.');
  assert.deepEqual([S.R, S.inn, S.half, S.lob[0]], [[5, 0], 1, 1, [3]]);
  assert.deepEqual(proof(S, 0, 1), [8, 8]);
  assert.equal(S.plays.findLast(p => p.kind === 'end').text, 'End of the top of the 1st, on the 5-run limit: Foxes 5, Comets 0.');
  assert.deepEqual([S.cells[5].scored, S.cells[5].reach], [false, 4], 'the way round, without the run');
  assert.match(S.cells[5].story.join(' '), /after the 5-run limit was reached: the run doesn’t count/);
  // On a wild pitch too.
  S = play(game({ innings: 6, rules: MINORS }), 'HR', 'HR', 'HR', 'HR', 'BB', 'BB', { t: 'r', m: [[2, 3, 'SB'], [1, 2, 'SB']] }, { t: 'r', m: [[3, 4, 'WP'], [2, 4, 'WP']] });
  assert.deepEqual([S.R[0], S.half, S.lob[0]], [5, 1, [1]]);
  assert.equal(S.text.at(-1), 'Batter 5 scores on a wild pitch. Batter 6 crosses the plate too, but the 5-run limit was reached, so the run doesn’t count. That’s 5 runs: the half-inning is over.');
  // In the last inning there's no limit.
  S = play(game({ innings: 1, rules: MINORS }), ...Array(7).fill('HR'));
  assert.deepEqual([S.R[0], S.half], [7, 0]);
  // A league where every run on the play that reaches the limit counts.
  S = play(game({ innings: 6, rules: { ...MINORS, set: 'custom', all: true } }), 'HR', 'HR', 'HR', 'HR', 'BB', 'BB', 'BB', '2B');
  assert.deepEqual([S.R[0], S.half], [6, 1]);
  assert.match(S.text.at(-1), /Batter 5 and Batter 6 score\. Batter 7 to third\. That’s 6 runs, past the 5-run limit: the half-inning is over\.$/);
  // And one where it holds in the last inning too.
  S = play(game({ innings: 1, rules: { ...MINORS, set: 'custom', last: true } }), ...Array(5).fill('HR'));
  assert.deepEqual([S.R[0], S.half], [5, 1]);
});

test('rules set partway through a game can’t change plays already scored: only from the last play on', () => {
  const ok = (g, change) => sameSoFar(g, { ...g, ...change });
  // A half-inning ended by hand at five runs, then the Minors: the limit would end it, and the hand would end the next.
  const g = game({ innings: 6 });
  play(g, ...Array(5).fill('HR'), { t: 'eoh' }, ...threeK);
  assert.equal(ok(g, { rules: MINORS }), false);
  // A half-inning that went to six: a limit of 5 or 6 would move the plays after it; 7, or none, wouldn't.
  const h = game({ innings: 6 });
  play(h, ...Array(6).fill('HR'), ...threeK);
  assert.deepEqual([5, 6, 7, 0].map(runs => ok(h, { rules: { ...MINORS, set: 'custom', runs } })), [false, false, true, true]);
  assert.equal(ok(h, { rules: LL }), true, 'a mercy rule nobody reached');
  // The fifth run is the last play (then a delay and a new pitcher): the Minors can come in now, and end the half.
  const k = game({ innings: 6 });
  play(k, ...Array(5).fill('HR'), { t: 'delay' }, { t: 'pch', s: 1, i: 0 });
  assert.equal(ok(k, { rules: MINORS }), true);
  assert.deepEqual([replay({ ...k, rules: MINORS }).half, replay(k).half], [1, 0]);
  // Past the mercy rule: ten ahead after the top of the 4th, and a play after it.
  const m = game({ innings: 6 });
  play(m, ...threeK, ...Array(10).fill('HR'), ...threeK, ...Array(15).fill('K'));
  assert.equal(ok(m, { rules: LL }), true, 'the play that reached it is the last');
  play(m, 'K');
  assert.equal(ok(m, { rules: LL }), false);
  // A runner on second from an inning already played, or taken off one, would change it; from the next, or at the
  // start of one nothing has happened in yet (a new pitcher aside), wouldn't.
  const t = game({ innings: 1 });
  play(t, ...threeK, ...threeK, { t: 'pch', s: 1, i: 0 });
  assert.deepEqual([ok(t, { tie: 2 }), ok(t, { tie: 3 })], [true, true]);
  play(t, 'BB');
  assert.deepEqual([ok(t, { tie: 2 }), ok(t, { tie: 3 }), ok({ ...t, tie: 2 }, { tie: 0 })], [false, true, false]);
  assert.equal(ok(sampleGame(3), {}), true);
});

test('league rules are kept from a file, a link and Drive, and the copy changed last has the say', () => {
  const g = game({ rules: MINORS });
  play(g, 'HR');
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))), g);
  assert.equal(newer(g), false);
  assert.deepEqual(game().rules, null);
  const t = (rules) => cleanGame({ ...g, rules }).rules;
  assert.deepEqual(t({ runs: 'x', mercy: [[4], [4, 10], 'a', [0, 5], [5.5, 3]] }), { set: 'custom', runs: 0, last: false, all: false, mercy: [[4, 10]] });
  assert.equal(t(5), null);
  assert.equal(t([1]), null);
  // Something a newer version adds to the rules is kept, and the game opens look-only.
  const later = cleanGame({ ...g, rules: { ...MINORS, pitchesAt: 3 } });
  assert.deepEqual([later.rules.pitchesAt, newer(later)], [3, true]);
  const a = JSON.parse(JSON.stringify(g)), b = JSON.parse(JSON.stringify(g));
  a.updated = 1000; b.updated = 2000; b.rules = LL;
  play(a, 'K');
  assert.deepEqual(merge(a, b).game.rules, LL);
});

test('extra innings that start with a runner on second: the batter before the leadoff man, in a box of his own (OBR 7.01(b))', () => {
  const g = game({ innings: 1, tie: 2 });
  let S = play(g, ...threeK, ...threeK);
  const r = S.bases[2], c = S.cells.at(-1);
  assert.deepEqual([S.inn, S.half, r.slot, now(S).name], [2, 0, 2, 'Batter 4']);
  assert.deepEqual([c.r, c.mark, c.auto, c.reach, c.from, c.text], ['AR', 'AR', true, 2, 2, 'Batter 3 starts the 2nd on second.']);
  assert.deepEqual(S.plays.at(-1), { i: 5, inn: 2, half: 0, text: 'Extra innings: Batter 3 starts on second.', kind: 'run', runs: 0, mark: 'AR', auto: true });
  assert.match(cellSvg(c), /class="start"/);
  // He scores on a double: his run, unearned for the pitcher, and the batter's RBI. Nobody gets a trip to the plate.
  S = play(g, '2B');
  assert.deepEqual([S.R, S.pitching[1][0].r, S.pitching[1][0].ur, S.cells.at(-1).rbi], [[1, 0], 1, 1, 1]);
  assert.deepEqual([S.bat['0.2.0'].r, S.bat['0.2.0'].pa, S.pitching[1][0].bf], [1, 1, 4]);
  assert.match(pitchDay(S.pitching[1][0], false), /1 run \(unearned\)/);
  assert.equal(S.pitching[1][0].er, 0);
  assert.match(cellSvg(S.cells.at(-2)), /<polyline class="path" points="30,13 11,32 30,51"\/>/, 'from second, home');
  S = play(g, ...threeK);
  assert.equal(S.bases[2].slot, 2, 'the home team’s too');
  assert.equal(S.cells.at(-1).side, 1);
  S = play(g, ...threeK);
  assert.deepEqual([S.over, halfLabel(S)], [true, 'Final/2']);
  // Each half-inning still proves: every trip to the plate, and the runner, ends as a run, left on base or out.
  assert.deepEqual([proof(S, 0, 2), proof(S, 1, 2)], [[5, 5], [4, 4]]);
  assert.match(boxHtml(S), /Unearned runs, from the runner put on second:<\/b> Pitcher\./);
  assert.deepEqual(dayOf(S, 0, 2, 0).trips.map(t => t.words), ['strikeout swinging', 'on second to start the inning']);
  assert.equal(columns(S, 0).length, 2, 'no extra column for him');
  // Called before anyone bats in it: no runner, and Keep playing puts him back.
  const h = game({ innings: 1, tie: 2 });
  S = play(h, ...threeK, ...threeK, { t: 'end' });
  assert.deepEqual([S.cells.some(x => x.auto), S.plays.some(p => p.auto), !!S.bases[2], S.inn, S.half], [false, false, false, 1, 1]);
  S = play(h, { t: 'on' });
  assert.equal(S.bases[2].cell.auto, true);
  // Off, as before; and saved and read back as it was.
  assert.equal(play(game({ innings: 1 }), ...threeK, ...threeK).bases[2], null);
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))), g);
  assert.deepEqual([game().tie, cleanGame({ ...g, tie: 'x' }).tie, cleanGame({ ...g, tie: 99 }).tie], [0, 0, 30]);
});

test('a reliever who starts the extra inning is charged with the runner put on second, not the pitcher who left', () => {
  const g = game({ innings: 1, tie: 2 });
  g.teams[1].pitchers.push({ name: 'Reliever', num: '' });
  // The home team brings in a reliever for the top of the 2nd, after the runner is on second.
  let S = play(g, ...threeK, ...threeK, { t: 'pch', s: 1, i: 1 });
  assert.deepEqual([S.bases[2].pi, S.cells.at(-1).pi], [1, 1]);
  S = play(g, '2B');
  assert.deepEqual([pitchStat(S, 1, 0).r, pitchStat(S, 1, 1).r, pitchStat(S, 1, 1).ur], [0, 1, 1]);
  // A pitcher who comes in once the inning is under way leaves the runner to the one who started it (OBR 9.16(g)).
  const h = game({ innings: 1, tie: 2 });
  h.teams[1].pitchers.push({ name: 'Reliever', num: '' });
  S = play(h, ...threeK, ...threeK, 'K', { t: 'pch', s: 1, i: 1 }, '2B');
  assert.deepEqual([pitchStat(S, 1, 0).r, pitchStat(S, 1, 0).ur, pitchStat(S, 1, 1).r], [1, 1, 0]);
});

test('pitch limits: amber five before, red at it with a batter to finish, and the rest each pitcher needs (Little League Regulation VI)', () => {
  const L = { by: 'll', age: '11-12', max: 85 };
  const g = game({ limit: L });
  let S = play(g, P('c'), P('c'), ...Array(77).fill(P('f')));
  assert.deepEqual([S.pitching[1][0].np, limitState(S)], [79, '']);
  S = play(g, P('f'));
  assert.equal(limitState(S), 'near', 'five from it');
  S = play(g, P('f'), P('f'), P('f'), P('f'));
  assert.deepEqual([S.pitching[1][0].np, limitState(S)], [84, 'near']);
  S = play(g, P('f'));
  assert.equal(limitState(S), 'finish', 'at it, during the at-bat that reached it');
  S = play(g, P('s'));
  assert.deepEqual([S.pitching[1][0].np, limitState(S)], [86, 'over'], 'that batter done, a new one up');
  assert.deepEqual([restDays(L, 86), restBand(L, 86), noCatch(L, 86), noCatch(L, 40)], [4, '66 or more pitches', true, false]);
  const box = boxHtml(S);
  assert.match(box, /Days of rest \(Little League, 11–12\):<\/b> Pitcher 4 days\./);
  assert.match(box, /Can’t catch today \(41 or more pitches\):<\/b> Pitcher\./);
  assert.equal((box.match(/Days of rest/g) || []).length, 1, 'only the team whose pitcher threw');
  // The rest by Regulation VI(d): 14 and under, and 15 to 18; Pitch Smart's 19-22 has a fifth day.
  assert.deepEqual([1, 20, 21, 35, 36, 50, 51, 65, 66].map(n => restDays(L, n)), [0, 0, 1, 1, 2, 2, 3, 3, 4]);
  const old = { by: 'll', age: '15-16', max: 95 };
  assert.deepEqual([30, 31, 45, 46, 60, 61, 75, 76].map(n => restDays(old, n)), [0, 1, 1, 2, 2, 3, 3, 4]);
  assert.deepEqual([105, 106].map(n => restDays({ by: 'ps', age: '19-22', max: 120 }, n)), [4, 5]);
  assert.equal(noCatch({ by: 'ps', age: '11-12', max: 85 }, 60), false, 'the catching rule is Little League’s');
  // A number of the scorer's own: the colours, but no table of rest; and nothing without a limit or a pitch count.
  const n = game({ limit: { by: '', age: '', max: 10 } });
  S = play(n, ...Array(5).fill(P('b')), P('c'), P('c'));
  assert.deepEqual([limitState(S), restDays(n.limit, 7)], ['near', null]);
  assert.doesNotMatch(boxHtml(S), /Days of rest/);
  assert.equal(limitState(play(game(), ...Array(4).fill(P('f')))), '');
  const off = game({ limit: L, pitches: false });
  assert.equal(limitState(play(off, ...Array(30).fill('K'))), '');
});

test('a pitch limit is kept from a file, a link and Drive', () => {
  const L = { by: 'ps', age: '13-14', max: 95 };
  const g = game({ limit: L });
  play(g, P('b'));
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))), g);
  assert.deepEqual([game().limit, newer(g)], [0, false]);
  const t = limit => cleanGame({ ...g, limit }).limit;
  assert.deepEqual([t(null), t(85), t({ max: 0 }), t({ by: '', age: '9-10', max: '70' }), t({ by: 7, age: '9-10', max: 500 }), t({ by: 'll', age: '<b>', max: 85 })],
    [0, 0, 0, { by: '', age: '', max: 70 }, { by: '', age: '', max: 300 }, { by: 'll', age: '', max: 85 }]);
  const later = cleanGame({ ...g, limit: { ...L, warnAt: 3 } });
  assert.deepEqual([later.limit.warnAt, newer(later)], [3, true]);
  // A kind of limit or a league age from a newer version is kept as it came, and the game opens look-only.
  for (const limit of [{ by: 'nfhs', age: '9-10', max: 75 }, { by: 'll', age: '5-6', max: 40 }]) {
    const h = cleanGame({ ...g, limit });
    assert.deepEqual([h.limit, newer(h)], [limit, true]);
  }
});

test('the next new game starts with the last one’s league rules and pitch limit, without what a newer version added', () => {
  const g = game({ rules: { ...MINORS, pitchesAt: 3 }, limit: { by: 'll', age: '9-10', max: 75, warnAt: 70 } });
  assert.equal(newer(g), true);
  const c = carried(g), h = game(c);
  assert.deepEqual(c, { rules: MINORS, limit: { by: 'll', age: '9-10', max: 75 } });
  assert.equal(newer(h), false, 'the new game is a game this version can score');
  assert.deepEqual(carried(game({ limit: { by: 'nfhs', age: '9-10', max: 75 } })).limit, 0, 'a kind of limit it doesn’t know isn’t carried');
  assert.deepEqual(carried(game({ limit: { by: '', age: '', max: 60 } })).limit, { by: '', age: '', max: 60 });
  assert.deepEqual(carried(undefined), { rules: null, limit: 0 });
  c.rules.mercy[0][1] = 99;
  assert.equal(MINORS.mercy[0][1], 15, 'a copy');
});

test('a play that makes the third out leaves the other runners where they were', () => {
  const marks = S => S.cells.slice(0, 3).map(c => c.notes.join('')).join('|');
  // Bases loaded, two out, a ground out: nobody moves up and nobody scores.
  let g = game();
  let S = play(g, 'BB', 'BB', 'BB', 'K', 'K');
  const before = marks(S);
  assert.deepEqual(suggest(S, 'GO'), [[0, 0], [3, 3], [2, 2], [1, 1]]);
  S = play(g, 'GO 6 3');
  assert.equal(S.R[0], 0);
  assert.equal(S.lob[0][0], 3);
  assert.equal(marks(S), before, 'no notes on the runners’ boxes for the ground out');
  assert.doesNotMatch(S.text[g.ev.length - 1], /crosses the plate|scores|to (second|third)/);
  assert.deepEqual(proof(S, 0, 1), [6, 6]);
  // A fielder's choice for the third out: the batter is on first, the others stay put.
  g = game();
  S = play(g, 'BB', 'BB', 'BB', 'K', 'K', 'FC 6 4');
  assert.equal(S.R[0], 0);
  assert.equal(S.lob[0][0], 3);
  assert.equal(marks(S), before, 'the runners on second and third didn’t move up');
  assert.deepEqual(proof(S, 0, 1), [6, 6]);
  // A double play with one out and the bases loaded: no run, two left on.
  g = game();
  S = play(g, 'BB', 'BB', 'BB', 'K', 'DP 6 4 3');
  assert.equal(S.R[0], 0);
  assert.equal(S.lob[0][0], 2);
  assert.equal(marks(S), '23|3|', 'the runners on second and third didn’t move up');
  assert.deepEqual(proof(S, 0, 1), [5, 5]);
});

test('sacrifices are scored from where everyone ended up (OBR 9.08)', () => {
  const g = game();
  let S = play(g, '3B');
  // A fly ball or line drive to the outfield that brings the run in with fewer than two out: a sacrifice fly.
  assert.equal(scoredAs(S, 'FO', [8], [[0, 0], [3, 4]]), 'SF');
  assert.equal(scoredAs(S, 'LO', [9], [[0, 0], [3, 4]]), 'SF');
  assert.equal(scoredAs(S, 'PU', null, [[0, 0], [3, 4]]), 'SF', 'no fielders: it may have gone to the outfield');
  assert.equal(scoredAs(S, 'LO', [6], [[0, 0], [3, 4]]), 'LO', 'a line drive caught by the shortstop');
  assert.equal(scoredAs(S, 'PU', [5], [[0, 0], [3, 4]]), 'PU');
  // A sacrifice fly where the runner held is a fly out.
  assert.equal(scoredAs(S, 'SF', [8], [[0, 0], [3, 3]]), 'FO');
  assert.equal(scoredAs(S, 'SF', [8], [[0, 0], [3, 4]]), 'SF');
  S = play(g, 'K', 'K');
  assert.equal(scoredAs(S, 'LO', [9], [[0, 0], [3, 4]]), 'LO', 'two out');
  // A bunt that gets the lead runner but not the batter is a fielder’s choice, not a sacrifice.
  S = play(game(), '1B');
  assert.equal(scoredAs(S, 'SAC', [1, 6], [[0, 1], [1, 0]]), 'FC');
  assert.equal(scoredAs(S, 'SAC', [1, 3], [[0, 0], [1, 2]]), 'SAC');
  assert.equal(scoredAs(S, 'SAC', [1], [[0, 1], [1, 2]]), 'SAC', 'everyone safe on a throw to second is still a sacrifice');
});

test('a double or triple play with fewer outs, an out with the batter safe: scored from where everyone ended up', () => {
  // A runner on first, nobody out.
  let S = play(game(), '1B');
  assert.equal(scoredAs(S, 'DP', [6, 4, 3], [[0, 0], [1, 0]]), 'DP');
  assert.equal(scoredAs(S, 'DP', [6, 4, 3], [[0, 0], [1, 2]]), 'GO', 'only the batter out: a ground out');
  assert.equal(scoredAs(S, 'DP', [6, 4], [[0, 1], [1, 0]]), 'FC', 'only the runner out: a fielder’s choice');
  assert.equal(scoredAs(S, 'DP', [6, 4, 3], [[0, 1], [1, 2]]), 'FC', 'nobody out');
  assert.equal(scoredAs(S, 'GO', [6, 4], [[0, 1], [1, 0]]), 'FC', 'a ground ball the batter was safe on');
  assert.equal(scoredAs(S, 'GO', [6, 3], [[0, 0], [1, 2]]), 'GO');
  // A strikeout the batter reached on is a dropped third strike, when first base was open or there were two out.
  assert.equal(scoredAs(S, 'K', null, [[0, 1], [1, 2]]), 'K', 'first base taken: he can’t be safe (check() refuses it)');
  assert.match(check(S, [[0, 1], [1, 2]], 'K'), /^No dropped third strike with a runner on first and fewer than two out\.$/);
  assert.match(check(S, [[0, 1], [1, 2]], 'KL'), /No dropped third strike/);
  assert.equal(check(S, [[0, 0], [1, 2]], 'K'), '');
  // A caught fly is an out.
  for (const code of ['FO', 'LO', 'PU', 'SF']) assert.equal(check(S, [[0, 1], [1, 2]], code), 'A caught fly ball is an out. If it was dropped, that’s an error: Cancel and tap E.', code);
  assert.equal(check(S, [[0, 1], [1, 2]], 'SAC'), '', 'a sacrifice with everyone safe on an error (OBR 9.08(b))');
  assert.equal(check(S, [[0, 1], [1, 2]]), '', 'without a code, only the bases are checked');
  // Two runners on, nobody out: a triple play that got two is a double play; one that got one, as a double play would be.
  S = play(game(), '1B', '1B');
  assert.equal(scoredAs(S, 'TP', [5, 4, 3], [[0, 0], [1, 0], [2, 0]]), 'TP');
  assert.equal(scoredAs(S, 'TP', [5, 4, 3], [[0, 0], [1, 0], [2, 3]]), 'DP');
  assert.equal(scoredAs(S, 'TP', [5, 4, 3], [[0, 0], [1, 2], [2, 3]]), 'GO');
  assert.equal(scoredAs(S, 'TP', [5, 4], [[0, 1], [1, 0], [2, 3]]), 'FC');
  assert.equal(scoredAs(S, 'DP', [5, 4, 3], [[0, 0], [1, 0], [2, 0]]), 'TP', 'a double play that got three is a triple play');
  // With two out, or first base open, a strikeout the batter reached on is a dropped third strike.
  S = play(game(), '2B');
  assert.equal(scoredAs(S, 'KL', null, [[0, 1], [2, 3]]), 'KD');
  assert.equal(check(S, [[0, 1], [2, 3]], 'KL'), '');
  S = play(game(), 'K', 'K', '1B');
  assert.equal(scoredAs(S, 'K', null, [[0, 1], [1, 2]]), 'KD');
  assert.equal(check(S, [[0, 1], [1, 2]], 'K'), '');
  // Saved as scored, a run on a one-out "double play" earns the batter an RBI (OBR 9.04(a)(2)).
  const g = game();
  S = play(g, '1B', '1B');
  const m = [[0, 0], [1, 2], [2, 4]];
  S = play(g, { t: 'pa', r: scoredAs(S, 'DP', [6, 4, 3], m), f: [6, 4, 3], m });
  assert.equal(S.text.at(-1), 'Batter 3 grounds out, short to first (6-4-3). Batter 1 scores. Batter 2 to second. Foxes take the lead, 1–0.');
  assert.deepEqual([S.outs, S.R[0], S.cells[2].rbi], [1, 1, 1]);
});

test('a pitching change starts a new pitch count; runs go to the pitcher who let the runner on', () => {
  const g = game();
  g.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  let S = play(g, P('b'), '1B', { t: 'pch', s: 1, i: 1 }, P('s'), 'HR');
  assert.equal(S.pitching[1][0].np, 2);
  assert.equal(S.pitching[1][1].np, 2);
  assert.equal(S.pitching[1][0].r, 1);
  assert.equal(S.pitching[1][1].r, 1);
  assert.equal(now(S).pitcherName, 'Bishop');
});

test('a runner who reaches on a fielder’s choice that retires an inherited runner is the old pitcher’s (OBR 9.16(g))', () => {
  // A walk and a single off the starter; the reliever's first batter forces the runner from first, and a double
  // scores the runner from second and the batter who replaced the one forced out: both runs are the starter's.
  const g = game();
  g.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  let S = play(g, 'BB', '1B', { t: 'pch', s: 1, i: 1 },
    { t: 'pa', r: 'FC', f: [6, 4], m: [[0, 1], [1, 0], [2, 3]] }, { t: 'pa', r: '2B', m: [[0, 2], [1, 4], [3, 4]] });
  assert.equal(S.R[0], 2);
  assert.deepEqual([S.pitching[1][0].r, S.pitching[1][1].r], [2, 0]);
  // A runner on first, a new pitcher, a force at second and a home run: one run each.
  const h = game();
  h.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  S = play(h, '1B', { t: 'pch', s: 1, i: 1 }, 'FC 6 4', 'HR');
  assert.deepEqual([S.pitching[1][0].r, S.pitching[1][1].r], [1, 1]);
  // A runner put out on a hit doesn't hand anything over: the batter who singled is the new pitcher's.
  const k = game();
  k.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  S = play(k, '1B', { t: 'pch', s: 1, i: 1 }, { t: 'pa', r: '1B', m: [[0, 1], [1, 0]] }, 'HR');
  assert.deepEqual([S.pitching[1][0].r, S.pitching[1][1].r], [0, 2]);
});

test('a walk after a pitching change with the batter ahead in the count is the old pitcher’s (OBR 9.16(h))', () => {
  const g = game();
  g.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  let S = play(g, P('b'), P('b'), P('b'), { t: 'pch', s: 1, i: 1 }, P('b'));
  const [a, b] = S.pitching[1];
  assert.deepEqual([a.bf, a.bb, a.np], [1, 1, 3], 'the starter: the batter, the walk and the three balls he threw');
  assert.deepEqual([b.bf, b.bb, b.np], [0, 0, 1], 'the reliever threw ball four');
  S = play(g, 'HR');
  assert.deepEqual([S.pitching[1][0].r, S.pitching[1][1].r], [1, 1], 'the runner who walked is the starter’s');
  // 3-2 counts too, and so does an intentional walk.
  const f = game();
  f.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  S = play(f, P('b'), P('s'), P('b'), P('s'), P('b'), { t: 'pch', s: 1, i: 1 }, 'IBB');
  assert.deepEqual([S.pitching[1][0].bb, S.pitching[1][1].bb], [1, 0]);
  // 1-1 isn't ahead: the walk is the reliever's. And a hit after a 3-0 change is the reliever's (9.16(h)(2)).
  const o = game();
  o.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  S = play(o, P('b'), P('s'), { t: 'pch', s: 1, i: 1 }, P('b'), P('b'), P('b'));
  assert.deepEqual([S.pitching[1][0].bb, S.pitching[1][1].bb], [0, 1]);
  const t = game();
  t.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  S = play(t, P('b'), P('b'), P('b'), { t: 'pch', s: 1, i: 1 }, '1B', 'BB');
  assert.deepEqual([S.pitching[1][0].bf, S.pitching[1][1].bf], [0, 2]);
  assert.deepEqual([S.pitching[1][0].bb, S.pitching[1][1].bb], [0, 1], 'the next batter’s walk is the reliever’s');
});

test('a pinch hitter who finishes a strikeout with two strikes already on: the strikeout is the first batter’s (OBR 9.15(b))', () => {
  const g = game();
  g.teams[0].lineup[0].push({ name: 'Diaz', num: '' });
  let S = play(g, P('c'), P('c'), { t: 'sub', s: 0, slot: 0, i: 1, ty: 'ph' }, P('s'));
  assert.deepEqual([S.bat['0.0.0'].pa, S.bat['0.0.0'].ab, S.bat['0.0.0'].k], [1, 1, 1]);
  assert.equal(S.bat['0.0.1'], undefined);
  assert.equal(S.cells[0].p, 1, 'the box on the card is the pinch hitter’s');
  // With one strike, or with any other ending, the at-bat is the pinch hitter's.
  const o = game();
  o.teams[0].lineup[0].push({ name: 'Diaz', num: '' });
  o.teams[0].lineup[1].push({ name: 'Ruiz', num: '' });
  S = play(o, P('c'), { t: 'sub', s: 0, slot: 0, i: 1, ty: 'ph' }, P('s'), P('s'), P('s'), P('s'), { t: 'sub', s: 0, slot: 1, i: 1, ty: 'ph' }, P('b'), P('b'), P('b'), P('b'));
  assert.equal(S.bat['0.0.0'], undefined);
  assert.deepEqual([S.bat['0.0.1'].ab, S.bat['0.0.1'].k], [1, 1]);
  assert.equal(S.bat['0.1.0'], undefined);
  assert.deepEqual([S.bat['0.1.1'].pa, S.bat['0.1.1'].bb], [1, 1]);
});

test('a pinch runner who scores gets the run', () => {
  const g = game();
  g.teams[0].lineup[0].push({ name: 'Speedy', num: '0' });
  const S = play(g, '1B', { t: 'sub', s: 0, slot: 0, i: 1, ty: 'pr' }, 'HR');
  assert.equal(S.bat['0.0.1'].r, 1);
  assert.equal(S.bat['0.0.0'].r || 0, 0);
  assert.match(S.plays.find(p => p.kind === 'sub').text, /Speedy pinch-runs for Batter 1/);
});

test('a substitute made from Lineups for a player on base runs for him, and gets the run', () => {
  const g = game();
  g.teams[0].lineup[0].push({ name: 'Speedy', num: '' });
  let S = play(g, '2B', { t: 'sub', s: 0, slot: 0, i: 1, ty: 'def' });
  assert.equal(S.bases[2].p, 1, 'Speedy is on second');
  S = play(g, { t: 'pa', r: '1B', m: [[0, 1], [2, 4]] });
  assert.equal(S.text.at(-1), 'Batter 2 singles. Speedy scores. Foxes take the lead, 1–0.');
  assert.equal(S.bat['0.0.1'].r, 1);
  assert.equal(S.bat['0.0.0'].r, 0, 'the batter who doubled left the game');
  assert.equal(S.cells[0].scored, true, 'the run is still drawn in the double’s box');
  // A change for someone in the field, on the other team, leaves the runners alone.
  const h = game();
  h.teams[1].lineup[0].push({ name: 'Glove', num: '' });
  S = play(h, '2B', { t: 'sub', s: 1, slot: 0, i: 1, ty: 'def' });
  assert.equal(S.bases[2].p, 0);
});

test('a home run with the batter called out says so', () => {
  const g = game();
  const S = play(g, 'E', { t: 'pa', r: 'HR', m: [[0, 0], [1, 4]] });
  assert.equal(S.text[1], 'Batter 2 hits a home run, but is called out on the bases. Batter 1 scores. Foxes take the lead, 1–0.');
  assert.equal(S.cells[1].reach, 4, 'the whole way round');
  assert.equal(S.cells[1].outAt, 4);
  assert.equal(S.cells[1].outN, 1);
});

test('a home run says its size: a two-run or three-run home run, or a grand slam, by the runs that counted on it', () => {
  const g = game();
  const said = () => replay(g).text.at(-1);
  play(g, 'HR');
  assert.equal(said(), 'Batter 1 hits a home run. Foxes take the lead, 1–0.');
  play(g, '1B', 'HR');
  assert.equal(said(), 'Batter 3 hits a two-run home run. Batter 2 scores.');
  play(g, 'K', '1B', '1B', 'HR 8');
  assert.equal(said(), 'Batter 7 hits a three-run home run to center. Batter 5 and Batter 6 score.');
  play(g, '1B', '1B', '1B', 'HR');
  assert.equal(said(), 'Batter 2 hits a grand slam. Batter 8, Batter 9 and Batter 1 score.');
  // Past a league's run limit, only the runs that count: two, and the rest cross the plate too.
  const h = game({ rules: { set: 'custom', runs: 2, last: false, all: false, mercy: [] } });
  play(h, '1B', 'BB', 'BB', 'HR');
  assert.match(replay(h).text.at(-1), /^Batter 4 hits a two-run home run\. Batter 1 and Batter 2 score\. Batter 3 and Batter 4 cross the plate too/);
});

test('a play that ties the game or puts the batting team ahead says so, and the one that wins it doesn’t need to', () => {
  const g = game({ innings: 2 });
  const said = () => replay(g).text.at(-1);
  play(g, 'HR');
  assert.equal(said(), 'Batter 1 hits a home run. Foxes take the lead, 1–0.');
  play(g, 'HR');
  assert.equal(said(), 'Batter 2 hits a home run.', 'already ahead');
  play(g, ...threeK, '1B', { t: 'r', m: [[1, 3, 'WP']] }, { t: 'r', m: [[3, 4, 'PB']] });
  assert.equal(said(), 'Batter 1 scores on a passed ball.');
  play(g, '1B');
  play(g, { t: 'r', m: [[1, 4, 'E', [8]]] });
  assert.equal(said(), 'Batter 2 scores on an error by the center fielder (E8). That ties it, 2–2.');
  // A run that doesn't count changes nothing.
  play(g, 'K', 'K', '1B', { t: 'pa', r: 'GO', f: [6, 3], m: [[0, 0], [1, 2]] });
  play(g, 'K', 'K', 'BB', '1B', { t: 'pa', r: 'GO', f: [5, 3], m: [[0, 0], [2, 4], [1, 2]], x: 1 });
  assert.equal(said(), 'Batter 1 grounds out, third to first (5-3). Batter 8 crosses the plate, but the run doesn’t count. Batter 9 to second.');
  // The home team ahead in the last inning: the play says the winning run, and the game is over.
  play(g, 'K', 'K', '2B', { t: 'pa', r: '1B', m: [[0, 1], [2, 4]] });
  assert.deepEqual([replay(g).over, said()], [true, 'Batter 1 singles. Batter 9 scores the winning run.']);
});

test('shorthand marks', () => {
  assert.equal(mark('GO', [6, 3]), '6-3');
  assert.equal(mark('GO', [3]), '3U');
  assert.equal(mark('GO'), 'G');
  assert.equal(mark('FO', [8]), 'F8');
  assert.equal(mark('E', [6]), 'E6');
  assert.equal(mark('SAC', [1, 3]), 'SAC 1-3');
});

test('play-by-play reads like a person wrote it', () => {
  const g = game();
  g.teams[0].lineup[0][0].name = 'Ruiz';
  g.teams[0].lineup[1][0].name = 'Okafor';
  const S = play(g, '1B', 'GO 6 3');
  assert.equal(S.plays[0].text, 'Ruiz singles.');
  assert.equal(S.plays[1].text, 'Okafor grounds out, short to first (6-3). Ruiz to second.');
});

test('everyone who scores on a play is in one sentence, so a grand slam fits the line under the field', () => {
  const g = game();
  ['Mackenzie', 'Alejandro', 'Christopher', 'Josephine'].forEach((name, i) => { g.teams[0].lineup[i][0].name = name; });
  let S = play(g, 'BB', 'BB', 'BB', 'HR');
  assert.equal(S.text.at(-1), 'Josephine hits a grand slam. Mackenzie, Alejandro and Christopher score. Foxes take the lead, 4–0.');
  // Each box keeps its own story.
  assert.deepEqual(S.cells.slice(0, 3).map(c => c.story.at(-1)), Array(3).fill('Scored on Josephine’s home run.'));
  // Two who score, and one who moves up.
  S = play(g, 'BB', 'BB', 'BB', { t: 'pa', r: '2B', m: [[0, 2], [3, 4], [2, 4], [1, 3]] });
  assert.equal(S.text.at(-1), 'Batter 8 doubles. Batter 5 and Batter 6 score. Batter 7 to third.');
  // A wild pitch that scores one and moves another up.
  S = play(g, { t: 'r', m: [[3, 4, 'WP'], [2, 3, 'WP']] });
  assert.equal(S.text.at(-1), 'Batter 7 scores on a wild pitch. Batter 8 moves to third on a wild pitch.');
  // Two who score on one wild pitch, or on one wild throw.
  S = play(game(), '1B', '1B', { t: 'r', m: [[2, 4, 'WP'], [1, 4, 'WP']] });
  assert.equal(S.text.at(-1), 'Batter 1 and Batter 2 score on a wild pitch. Foxes take the lead, 2–0.');
  S = play(game(), '1B', '1B', { t: 'r', m: [[2, 4, 'E', [2]], [1, 4, 'E', [2]]] });
  assert.equal(S.text.at(-1), 'Batter 1 and Batter 2 score on an error by the catcher (E2). Foxes take the lead, 2–0.');
  // Runs that cross the plate on the third out but don't count.
  S = play(game(), '1B', '1B', '1B', 'K', 'K', { t: 'pa', r: 'GO', f: [6, 3], m: [[0, 0], [3, 4], [2, 4], [1, 3]], x: 1 });
  assert.equal(S.text.at(-1), 'Batter 6 grounds out, short to first (6-3). Batter 1 and Batter 2 cross the plate, but the runs don’t count. Batter 3 to third.');
  assert.equal(S.R[0], 0);
});

test('a pitching change says who comes in, or comes back in', () => {
  const g = game();
  g.teams[1].pitchers[0].name = 'Halvorsen';
  g.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  const S = play(g, { t: 'pch', s: 1, i: 1 }, { t: 'pch', s: 1, i: 0 }, { t: 'pch', s: 1, i: 1 });
  assert.deepEqual(S.text, ['Comets bring in Bishop to pitch.', 'Comets bring Halvorsen back in to pitch.', 'Comets bring Bishop back in to pitch.']);
});

test('the card marks where a new pitcher took over and where a substitute first batted', () => {
  const g = game();
  g.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  g.teams[0].lineup[2].push({ name: 'Diaz', num: '' });
  g.teams[0].lineup[0].push({ name: 'Speedy', num: '' });
  const S = play(g, '1B', 'K', { t: 'pch', s: 1, i: 1 }, P('b'), { t: 'sub', s: 0, slot: 2, i: 1, ty: 'ph' }, '2B',
    { t: 'sub', s: 0, slot: 0, i: 1, ty: 'pr' }, 'K', 'K', ...threeK, 'GO 6 3', '1B', '1B', '1B', 'K');
  const h = cardHtml(S, 0);
  const td = n => h.match(new RegExp(`<td([^>]*)><button type="button" class="box" data-cell="${n}" aria-label="([^"]*)"`)).slice(1);
  assert.deepEqual(td(2), [' class="pch sub" title="Bishop pitching from here"', '1st inning. Diaz doubles. Batter 1 to third. Count: 1 ball, 0 strikes. Bishop pitching from here.']);
  assert.deepEqual(td(1), ['', '1st inning. Batter 2 strikes out swinging. 1st out. Count: 0 balls, 0 strikes.']);
  assert.match(td(12)[0], /class="sub/, 'the pinch runner’s first time up, in the 2nd');
  assert.match(h, /<i>PH 1st<\/i> Diaz/);
  assert.match(h, /<i>PR 1st<\/i> Speedy/);
  // The home team's card: no change of pitcher for them to face.
  assert.doesNotMatch(cardHtml(S, 1), /class="[^"]*pch/);
});

test('the notes under each team’s box score', () => {
  const g = game();
  g.teams[0].lineup.forEach((s, i) => { s[0].name = ['Ruiz', 'Okafor', 'Brennan', 'Castillo', 'Han', 'Marsh', 'Pruitt', 'Lindqvist', 'Delgado'][i]; });
  g.teams[0].pitchers[0].name = 'Whitlock';
  g.teams[1].pitchers[0].name = 'Halvorsen';
  g.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  const S = play(g, '2B', '2B', 'HBP', { t: 'r', m: [[2, 3, 'WP'], [1, 2, 'WP']] }, 'SF 8', { t: 'pch', s: 1, i: 1 }, 'CI',
    { t: 'r', m: [[2, 3, 'SB']] }, { t: 'r', m: [[1, 0, 'CS', [2, 6]]] }, { t: 'pa', r: 'E', f: [5], m: [[0, 1], [3, 4]] },
    { t: 'r', m: [[1, 2, 'BK']] }, 'HR', 'K', '3B', 'SAC 1 3', '1B', 'K', 'K');
  assert.deepEqual(S.R, [5, 1]);
  const notes = side => boxHtml(S).split('<div class="extras">')[side + 1].split('</div>')[0].replace(/<\/?b>/g, '').split(/<\/p><p[^>]*>|<\/?p[^>]*>/).filter(Boolean);
  // Last, the scorer's proof (OBR 9.03(c)): every trip to the plate a run, a runner left on or an out; so far, while
  // the game goes on.
  assert.deepEqual(notes(0), [
    'Doubles: Ruiz, Okafor.', 'Home runs: Pruitt.', 'Sacrifice flies: Castillo.', 'Hit by a pitch: Brennan.',
    'Stolen bases: Brennan.', 'Caught stealing: Han.', 'Left on base: 0.', 'Proof so far: 8 trips to the plate = 5 runs + 0 left on base + 3 outs.',
  ]);
  assert.deepEqual(notes(1), [
    'Triples: Batter 1.', 'Sacrifice bunts: Batter 2.', 'Left on base: 1.', 'Errors: catcher’s interference, third baseman.',
    'Wild pitches: Halvorsen.', 'Hit batters: Halvorsen (Brennan).', 'Balks: Bishop.',
    'Proof so far: 5 trips to the plate = 1 run + 1 left on base + 3 outs.',
  ]);
  const proofs = S => [...boxHtml(S).matchAll(/<p class="proof">(.*?)<\/p>/g)].map(m => m[1]);
  // The half-inning going on, with its runner still on; a team that hasn't batted has none.
  assert.deepEqual(proofs(play(game(), '1B')), ['Proof so far: 1 trip to the plate = 0 runs + 0 left on base + 1 on base now + 0 outs.']);
  // Over, with the runner put on second to start an extra inning.
  const x = game({ innings: 1, tie: 2 });
  assert.deepEqual(proofs(play(x, ...threeK, ...threeK, '2B', ...threeK, ...threeK)), [
    'Proof: 7 trips to the plate and 1 runner put on second = 1 run + 1 left on base + 6 outs.',
    'Proof: 6 trips to the plate and 1 runner put on second = 0 runs + 1 left on base + 6 outs.',
  ]);
  // Earned runs, batters faced, home runs, and pitches and strikes are columns of the pitching lines: IP H R ER BB K HR
  // BF P-S.
  const line = who => boxHtml(S).match(new RegExp(`<th scope="row">${who}</th>((?:<td>[^<]*</td>)+)`))[1].match(/<td>([^<]*)<\/td>/g).map(x => x.slice(4, -5));
  assert.deepEqual(line('Halvorsen').slice(6, 8), ['0', '4']);
  assert.deepEqual(line('Bishop').slice(6, 8), ['1', '4']);
  assert.match(line('Bishop')[8], /^\d+-\d+$/);
});

test('the plays: the count and pitches for each at-bat, a line for each half-inning, and a finished game in order', () => {
  const g = game({ innings: 1 });
  let S = play(g, P('b'), P('c'), P('f'), P('b'), '1B', 'BB', P('s'), 'K', 'GO 6 3', 'FO 8');
  const end = S.plays.find(p => p.kind === 'end');
  assert.equal(end.sum, '0 runs, 1 hit, no errors, 2 left on base.');
  let h = playsHtml(S);
  assert.match(h, /Batter 1 singles\.<small class="pc" title="Ball, called strike, foul, ball, in play">2-2 · 5 pitches<\/small>/);
  assert.match(h, /Batter 2 walks\. Batter 1 to second\.<small class="pc" title="Ball">0-0 · 1 pitch<\/small>/, 'a walk tapped straight away');
  assert.match(h, /End of the top of the 1st: Foxes 0, Comets 0\.<small>0 runs, 1 hit, no errors, 2 left on base\.<\/small>/);
  // During the game the latest is on top.
  assert.ok(h.indexOf('Bottom of the 1st') < 0 && h.indexOf('flies out') < h.indexOf('singles'));
  S = play(g, { t: 'pa', r: 'E', f: [6], m: [[0, 1]] }, 'HR');
  assert.equal(S.over, true);
  // A finished game reads from the first pitch to the last; the latest few on the score screen are still the latest.
  h = playsHtml(S);
  assert.ok(h.indexOf('Top of the 1st') < h.indexOf('Bottom of the 1st'));
  assert.ok(h.indexOf('singles') < h.indexOf('flies out') && h.indexOf('reaches on an error') < h.indexOf('home run'));
  assert.ok(playsHtml(S, { limit: 2 }).indexOf('home run') < playsHtml(S, { limit: 2 }).indexOf('reaches on an error'));
  // Not counting pitches: no pitch line.
  g.pitches = false;
  assert.doesNotMatch(playsHtml(replay(g)), /class="pc"/);
});

test('the plays: each play led by its mark on the card, and a runner’s play by its first runner’s', () => {
  const g = game({ innings: 1 });
  const S = play(g, '1B', { t: 'r', m: [[1, 2, 'SB']] }, { t: 'pa', r: 'SAC', f: [1, 3], m: [[2, 3], [0, 0]] }, { t: 'r', m: [[3, 4, 'WP']] },
    'BB', { t: 'r', m: [[1, 2, 'OA']] }, { t: 'pa', r: 'DP', f: [6, 4, 3], m: [[2, 0], [0, 0]] },
    P('c'), P('c'), P('c'), '1B', { t: 'sub', s: 1, slot: 1, i: 1, ty: 'ph' }, { t: 'r', m: [[1, 0, 'CS', [2, 6]]] }, 'E 6', { t: 'r', m: [[1, 2, 'BK']] });
  // In order from the first play: a mark for each plate appearance and runner's play (none for Adv, nor for a pinch
  // hitter or the end of the half), never broken inside "SAC 1-3", and a backwards K drawn as one.
  const h = playsHtml({ ...S, over: true });
  const marks = [...h.matchAll(/<li class="(\w+)[^"]*">(?:<b class="pm" aria-hidden="true">(.*?)<\/b>)?/g)].map(([, kind, m]) => `${kind}:${m ?? '-'}`);
  assert.deepEqual(marks, [
    'pa:<span>1B</span>', 'run:<span>SB</span>', 'pa:<span>SAC</span> <span>1-3</span>', 'run:<span>WP</span>', 'pa:<span>BB</span>', 'run:', 'pa:<span>6-4-3</span> <span>DP</span>', 'end:-',
    'pa:<i class="kl" aria-label="backwards K">K</i>', 'pa:<span>1B</span>', 'sub:-', 'run:<span>CS</span> <span>2-6</span>', 'pa:<span>E6</span>', 'run:<span>BK</span>',
  ]);
  assert.match(h, /<span class="pw">Batter 1 singles\.<small class="pc"/, 'the words, then the count, beside the mark');
});

test('a game survives being tidied (from a file or a link) unchanged', () => {
  const g = sampleGame(3);
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(c, g);
  assert.deepEqual(replay(c).R, replay(g).R);
  assert.equal(cleanGame({ nope: 1 }), null);
  assert.deepEqual(Object.keys(cleanDoc({ games: { x: g } }).games), [g.id]);
});

// Games from elsewhere (a file someone edited, another app): odd ones read back sensibly, and the same every time.
test('a game from a file with a long number, someone listed twice in a play, or four outs on one play', () => {
  // A number written as a number is cut to its field like one written as text, so tidying it again changes nothing.
  const g = game();
  g.teams[0].lineup[0][0] = { name: 12345, num: 1000000000 };
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(c.teams[0].lineup[0][0], { name: '12345', num: '1000' });
  assert.deepEqual(cleanGame(c), c);
  // The batter listed twice: he goes to first, once, and the runs and the boxes agree.
  let S = play(game(), '3B', { t: 'pa', r: '1B', m: [[0, 1], [3, 4], [0, 2]] });
  assert.deepEqual([S.R[0], S.cells.filter(c => c.scored).length, S.bases.map(Boolean)], [1, 1, [false, true, false, false]]);
  assert.equal(S.text.at(-1), 'Batter 2 singles. Batter 1 scores. Foxes take the lead, 1–0.');
  // A runner listed twice in a steal moves once; and nothing happens on a play after its third out.
  S = play(game(), '1B', { t: 'r', m: [[1, 2, 'SB'], [1, 2, 'SB']] });
  assert.deepEqual([S.bat['0.0.0'].sb, S.bases.map(Boolean)], [1, [false, false, true, false]]);
  S = play(game(), '3B', 'BB', 'K', 'K', { t: 'r', m: [[3, 0, 'CS', [2, 5]], [1, 0, 'PO', [1, 3]]] });
  assert.deepEqual([S.half, S.outs, S.lob[0][0]], [1, 0, 1], 'one out, the third; the runner on first is left on');
  assert.equal(S.plays.findLast(p => p.kind === 'end').text, 'End of the top of the 1st: Foxes 0, Comets 0.');
  assert.deepEqual(proof(S, 0, 1), [4, 4]);
});

// A game with every kind of event the game screen makes, each the way it makes it: pitches, plays (with and without
// fielders, and a run that doesn't count), runners moving (a steal, several on one wild pitch, a balk, an error by a
// fielder, caught stealing with the throw, a pickoff, a passed ball, moved up, out on the bases), a pinch runner, a
// pinch hitter, a change in the field and a starter back in, a new pitcher and the starter back, a batter added, a
// half-inning ended early, and the game called and taken up again.
function everyKind() {
  const g = game({ innings: 3 });
  g.place = 'Riverside Park';
  g.teams[0].lineup[0][0] = { name: 'Ruiz', num: '2' };
  g.teams[1].pitchers[0] = { name: 'Halvorsen', num: '21' };
  // Whoever comes in is added to the game as they come in, as the game screen does it.
  const sub = (s, slot, who, ty) => { g.teams[s].lineup[slot].push(who); return { t: 'sub', s, slot, i: g.teams[s].lineup[slot].length - 1, ty }; };
  const reliever = (s, who) => { g.teams[s].pitchers.push(who); return { t: 'pch', s, i: g.teams[s].pitchers.length - 1 }; };
  const add = s => { g.teams[s].lineup.push([{ name: '', num: '' }]); return { t: 'add', s }; };
  play(g, P('b'), P('c'), P('f'), P('s'), '1B', { t: 'r', m: [[1, 2, 'SB']] }, 'BB', { t: 'r', m: [[2, 3, 'WP'], [1, 2, 'WP']] });
  play(g, sub(0, 1, { name: 'Speedy', num: '0' }, 'pr'), { t: 'r', m: [[3, 4, 'BK'], [2, 3, 'BK']] }, { t: 'r', m: [[3, 4, 'E', [2]]] }, 'GO 6 3');
  play(g, reliever(1, { name: 'Bishop', num: '37' }));
  play(g, sub(0, 4, { name: 'Diaz', num: '' }, 'ph'), 'FO 8');
  play(g, '1B', { t: 'r', m: [[1, 0, 'CS', [2, 6]]] }, '2B', { t: 'r', m: [[2, 3, 'PB']] }, 'SF 9', 'HBP', { t: 'r', m: [[1, 0, 'PO', [1, 3]]] });
  play(g, sub(1, 0, { name: 'Glove', num: '' }, 'def'), { t: 'pch', s: 1, i: 0 });
  play(g, add(0));
  play(g, 'E 6', '1B', '1B', 'K', 'KL', { t: 'pa', r: 'FC', f: [6, 4], m: [[0, 1], [1, 0], [2, 3], [3, 4]], x: 1 });
  play(g, 'PU 2', 'KD', { t: 'r', m: [[1, 2, 'OA']] }, { t: 'r', m: [[2, 0, 'OB']] }, { t: 'eoh' });
  play(g, { t: 'sub', s: 0, slot: 1, i: 0, ty: 'def' }, 'IBB', 'CI', 'SAC 1 3', '3B', { t: 'end' }, { t: 'on' }, 'LO 6', { t: 'delay' }, { t: 'on' }, '1B');
  play(g, { t: 'end', why: 'rule' }, { t: 'on' }, 'DP 6 4 3');
  play(g, { t: 'gone', s: 1, slot: 4 }, { t: 'back', s: 1, slot: 4 });
  // Each scored at a time, as the game screen does it: seconds since the first pitch, at 7:10 pm Eastern.
  g.start = Date.UTC(2026, 9, 24, 23, 10); g.tz = -240;
  g.ev.forEach((e, i) => { e.at = i * 25; });
  return g;
}

test('a game with every kind of event comes back the same from a file, Drive, storage and a link', async () => {
  const g = everyKind(), S = replay(g);
  assert.deepEqual(new Set(g.ev.map(e => e.t)), new Set(['p', 'pa', 'r', 'sub', 'pch', 'add', 'eoh', 'end', 'delay', 'on', 'gone', 'back']));
  assert.deepEqual(g.ev.filter(e => e.t === 'end').map(e => e.why), [undefined, 'rule']);
  assert.deepEqual([S.R, S.inn, S.half], [[5, 1], 3, 1]);
  for (const t of S.text) assert.doesNotMatch(t, /undefined|NaN/);
  const json = JSON.parse(JSON.stringify(g));
  assert.deepEqual(cleanGame(json), g);
  assert.deepEqual(cleanGame(cleanGame(json)), g, 'tidying again changes nothing');
  assert.deepEqual(cleanDoc({ app: 'backwards-k', v: 1, games: { [g.id]: json }, gone: {} }).games, { [g.id]: g });
  const { pack, unpack } = await import('../js/share.js');
  const link = await pack(g);
  assert.equal(link[0], 'c');
  assert.deepEqual(await unpack(link), json);
  assert.deepEqual(cleanGame(await unpack(link)), g);
  // A link made where the browser can't compress: the game as plain JSON, with its checksum.
  const zip = globalThis.CompressionStream;
  delete globalThis.CompressionStream;
  try {
    const plain = await pack(g);
    assert.equal(plain[0], 'p');
    assert.deepEqual(cleanGame(await unpack(plain)), g);
  } finally { globalThis.CompressionStream = zip; }
  // Links made before there was a checksum: compressed, and plain JSON, in base64url.
  const { deflateRawSync } = await import('node:zlib');
  for (const old of ['z' + deflateRawSync(JSON.stringify(g)).toString('base64url'), 'j' + Buffer.from(JSON.stringify(g)).toString('base64url')]) {
    assert.deepEqual(cleanGame(await unpack(old)), g, old[0]);
    assert.deepEqual(replay(cleanGame(await unpack(old))).text, S.text);
  }
});

test('the clock: each half-inning from its first play, each at-bat from its first pitch, and the time of the game without delays', () => {
  const g = game({ innings: 1 });
  g.start = Date.UTC(2026, 9, 24, 23, 10); g.tz = -240; // 7:10 pm Eastern
  const at = (e, t) => ({ ...(typeof e === 'string' ? { t: 'pa', r: e } : e), at: t });
  // A substitution before the first pitch has no time; the first pitch is at 0.
  let S = play(g, { t: 'sub', s: 0, slot: 0, i: 0, ty: 'def' }, at(P('b'), 0), at(P('c'), 20), at('1B', 45), at('K', 90), at({ t: 'delay' }, 100));
  assert.deepEqual(S.cells.map(c => c.at), [0, 90], 'the single’s at-bat began with its first pitch; the strikeout had none counted');
  assert.deepEqual(clockOf(S), { time: null, delays: 0 }, 'the game goes on, and the delay with it');
  S = play(g, at({ t: 'on' }, 100 + 40 * 60), at('HR', 2510), at('K', 2540), at('K', 2570), at(P('s'), 2700), at('K', 2720), at('K', 2750), at('K', 2790));
  assert.deepEqual(S.starts, { '1.0': 0, '1.1': 2700 });
  assert.deepEqual(S.cells.map(c => c.at), [0, 90, 2510, 2540, 2570, 2700, 2750, 2790]);
  assert.equal(S.over, true);
  assert.deepEqual(clockOf(S), { time: 2790 - 2400, delays: 2400 });
  const box = boxHtml(S);
  assert.match(box, /<p class="clock">First pitch 7:10 pm · <abbr[^>]*>Time<\/abbr> 0:07 · Delay 0:40<\/p>/);
  assert.match(playsHtml(S), /Bottom of the 1st <span>Comets batting · 7:55 pm<\/span>/);
  // Keep playing: the game isn't over, and has no time yet.
  g.ev.push({ t: 'on', at: 3000 });
  assert.equal(clockOf(replay(g)).time, null);
  // No clock at all before the first pitch, and nothing said.
  const fresh = game();
  assert.equal(clockOf(replay(fresh)), null);
  assert.doesNotMatch(boxHtml(replay(fresh)) + playsHtml(play(fresh, 'K')), /First pitch|· \d+:\d\d [ap]m/);
  // Picked up partway through: when the scoring started, and no time of the game.
  const j = game({ innings: 2 });
  j.start = g.start; j.tz = g.tz;
  const SJ = play(j, { t: 'join', inn: 2, half: 0, r: [1, 0], up: 0 }, at('K', 0), at('K', 30), at('K', 60), at('K', 200), at('K', 230), at('K', 260));
  assert.equal(SJ.over, true);
  assert.match(boxHtml(SJ), /<p class="clock">Scored from 7:10 pm<\/p>/);
});

test('an automatic ball or strike (the pitch clock) moves the count, but isn’t a pitch', () => {
  const A = k => ({ t: 'p', k, v: 1 });
  const g = game();
  let S = play(g, P('b'), A('b'), A('c'), P('f'));
  assert.deepEqual([S.b, S.s], [2, 2]);
  assert.deepEqual(S.text, ['Ball (1-0)', 'Automatic ball (2-0)', 'Automatic strike (2-1)', 'Foul (2-2)']);
  assert.deepEqual(pitchStat(S, 1, 0), { ...pitchStat(S, 1, 0), np: 2, balls: 1, str: 1 });
  // Ball four on an automatic ball is a walk; strike three on an automatic strike, a strikeout looking.
  S = play(g, A('b'), A('b'), A('c'), A('c'), A('c'));
  assert.deepEqual(S.cells.map(c => c.r), ['BB', 'KL']);
  assert.equal(S.cells[0].seq, 'bBCfBB');
  assert.equal(pitchStat(S, 1, 0).np, 2, 'none of the automatic ones are pitches');
  assert.equal(S.plays.length, 2);
  assert.match(playsHtml(S), /3-2 · 2 pitches/);
  assert.match(playsHtml(S), /title="Ball, automatic ball, automatic strike, foul, automatic ball, automatic ball"/);
  assert.match(playsHtml(S), /0-2 · 0 pitches/);
  // Kept as it is by a file, a link, Drive or storage, and nothing newer.
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(c, g);
  assert.equal(newer(c), false);
  // A kind of automatic call from a newer version is kept, makes the game look-only, and is passed over.
  const later = cleanGame({ ...JSON.parse(JSON.stringify(g)), ev: [...g.ev, { t: 'p', k: 'b', v: 'balk' }] });
  assert.equal(later.ev.at(-1).v, 'balk');
  assert.equal(newer(later), true);
  assert.deepEqual([replay(later).b, replay(later).s], [0, 0]);
});

test('the fielder picker has each fielder where he stands: the third baseman by third, the shortstop between second and third', async () => {
  const { fieldSvg } = await import('../js/field.js');
  const svg = fieldSvg(), at = n => new RegExp(`translate\\((\\d+) (\\d+)\\)" data-pos="${n}"`).exec(svg).slice(1).map(Number);
  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), home = [160, 248], first = [230, 178], second = [160, 108], third = [90, 178];
  assert.ok(far(at(5), third) < far(at(6), third), 'the third baseman is nearer third base than the shortstop');
  assert.ok(far(at(3), first) < far(at(4), first), 'the first baseman is nearer first base than the second baseman');
  assert.ok(at(6)[0] < second[0] && at(4)[0] > second[0], 'short and second either side of second base');
  assert.ok(at(5)[0] < home[0] && at(7)[0] < home[0] && at(3)[0] > home[0] && at(9)[0] > home[0], 'the left side on the left');
});

test('a hit says where it went, when the scorer said: singles to left, and the card’s mark is still 1B', () => {
  const g = game();
  const S = play(g, '1B 7', '2B 8', 'HR 9', '1B 6', '1B 1', '3B');
  assert.deepEqual(S.cells.map(c => c.text.split('.')[0]), ['Batter 1 singles to left', 'Batter 2 doubles to center', 'Batter 3 hits a three-run home run to right',
    'Batter 4 singles to short', 'Batter 5 singles to the pitcher', 'Batter 6 triples']);
  assert.deepEqual(S.cells.map(c => c.mark), ['1B', '2B', 'HR', '1B', '1B', '3B']);
  assert.deepEqual(dayOf(S, 0, 0, 0).trips.map(t => t.words), ['single to left']);
  assert.deepEqual(dayOf(S, 0, 5, 0).trips.map(t => t.words), ['triple']);
  // A walk-off double that counts as a single still went where it went.
  const w = game({ innings: 1 });
  play(w, 'K', 'K', 'K', '3B');
  const W = play(w, { t: 'pa', r: '2B', f: [9], m: [[0, 2], [3, 4]] });
  assert.match(W.cells.at(-1).text, /^Batter 2 singles to right\. .*It went for a double, but counts as a single/);
});

test('a hit that says where it went has a pencil line in its box, from home toward the fielder', () => {
  const g = game();
  const S = play(g, '1B 7', '2B 9', 'HR 8', '1B 6', '1B', 'FO 7');
  const line = c => { const m = /<line class="hit" x1="30" y1="51" x2="([\d.]+)" y2="([\d.]+)"/.exec(cellSvg(c)); return m && [+m[1], +m[2]]; };
  const [lf, rf, cf, ss, none, out] = S.cells.map(line);
  assert.ok(lf[0] < 30 && rf[0] > 30 && cf[0] === 30, 'left to the left, right to the right, center straight out');
  assert.ok(cf[1] < 13 && lf[1] < 30, 'an outfielder past the bases');
  assert.ok(Math.hypot(ss[0] - 30, ss[1] - 51) < Math.hypot(lf[0] - 30, lf[1] - 51), 'the shortstop nearer than left field');
  assert.equal(none, null, 'a hit nobody said where');
  assert.equal(out, null, 'a fly out has its F7, not a line');
  assert.match(cardHtml(S, 0), /class="hit"/);
});

test('spray charts: where a team’s and a batter’s balls went, once the game says where its hits went', async () => {
  const { spray } = await import('../js/box.js');
  const g = game();
  // An out with its fielders, but no hit says where it went: no chart, with the setting off.
  let S = play(g, 'GO 6 3', '1B');
  assert.equal(spray(S, c => c.side === 0, 'Where the Foxes hit it'), '');
  assert.doesNotMatch(boxHtml(S), /class="spray"/);
  // With it on, the out is there before any hit is.
  assert.match(spray(replay({ ...g, spray: true }), c => c.side === 0, 'x'), /class="spray"/);
  S = play(g, '1B 7', 'HR 8', 'K', 'E 5', '2B 7');
  const h = spray(S, c => c.side === 0, 'Where the Foxes hit it');
  assert.match(h, /<figcaption>Where the Foxes hit it<\/figcaption>/);
  // A dot for each ball placed: the 6-3, the hits to left (two) and center, the error at third. Not the single
  // nobody placed, nor the strikeout.
  assert.equal((h.match(/class="ball/g) || []).length, 5);
  assert.equal((h.match(/class="ball hit/g) || []).length, 3);
  assert.match(h, /<title>Batter 3, 1st: single to left<\/title>/);
  assert.match(h, /<title>Batter 1, 1st: ground out, 6-3<\/title>/);
  assert.match(h, /Hits: 2 to left, 1 to center\. 2 other balls in play\./);
  // Only hits, two of them to one fielder: no "0 other balls".
  assert.match(spray(S, c => c.side === 0 && RESULTS[c.r].kind === 'hit', 'x'), /<p class="spray-words">Hits: 2 to left, 1 to center\.<\/p>/);
  // The home run is over the fence, straight out to center.
  const hr = /class="ball hit" transform="translate\(([\d.]+) ([\d.]+)\)"><title>Batter 4/.exec(h);
  assert.ok(+hr[1] === 160 && +hr[2] < 36, `the home run at ${hr[1]}, ${hr[2]}`);
  // One batter's, with the box picked out.
  const mine = S.cells.filter(c => c.side === 0 && c.slot === 2);
  const one = spray(S, c => c.side === 0 && c.slot === 2, 'Where Batter 3 hit it today', { now: mine[0] });
  assert.equal((one.match(/class="ball/g) || []).length, 1);
  assert.match(one, /class="ball hit now"/);
  assert.match(boxHtml(S), /Where the Foxes hit it/);
  assert.doesNotMatch(boxHtml(S), /Where the Comets hit it/, 'the home team hasn’t batted');
  // Room in the drawing for a second home run to center, picked out, and five pop-ups to the catcher.
  const { sprayField } = await import('../js/field.js');
  const svg = sprayField([{ n: 8, hit: true, hr: true }, { n: 8, hit: true, hr: true, now: true }, ...Array(5).fill({ n: 2, hit: false })]);
  const [, top, , height] = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg).slice(1).map(Number);
  // (A dot reaches 7 from its middle, with its outline, and the ring round the one picked out 11.)
  for (const [, now, x, y] of svg.matchAll(/class="ball[^"]*?( now)?" transform="translate\(([-\d.]+) ([-\d.]+)\)/g)) {
    const r = now ? 11 : 7;
    assert.ok(+y - r >= top && +y + r <= top + height, `a ball at ${x}, ${y} is inside ${top} to ${top + height}`);
  }
});

test('Ask where hits went is a setting of the game: off to start with, kept, and taken from the copy changed last', () => {
  assert.equal(newGame().spray, false);
  const g = game({ spray: true });
  play(g, '1B 7');
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(c, g);
  assert.equal(c.spray, true);
  assert.deepEqual(c.ev[0].f, [7]);
  assert.equal(newer(c), false);
  assert.equal(cleanGame({ ...JSON.parse(JSON.stringify(g)), spray: 'yes' }).spray, false, 'only true turns it on');
  // Two copies made one: the settings of the one changed last, this one among them.
  const later = { ...structuredClone(g), spray: false, updated: g.updated + 5 };
  later.ev.push({ t: 'pa', r: 'K', m: [[0, 0], [1, 1]] });
  assert.equal(merge(g, later).game.spray, false);
});

test('a link changed on its way, or cut short, doesn’t open as another game', async () => {
  const { pack, unpack } = await import('../js/share.js');
  const g = sampleGame(7), json = JSON.stringify(g), link = await pack(g);
  // Each letter changed in turn: the link won't open, or (a letter whose last bits base64 leaves unused) is the game.
  let caught = 0;
  for (let i = 0; i < link.length; i++) {
    const x = link.slice(0, i) + (link[i] === 'A' ? 'B' : 'A') + link.slice(i + 1);
    let got = null;
    try { got = JSON.stringify(await unpack(x)); } catch { caught++; continue; }
    assert.equal(got, json, `letter ${i} changed opens another game`);
  }
  assert.ok(caught >= link.length - 1, `${caught} of ${link.length} changed letters caught`);
  // Cut short anywhere, or with a letter left out.
  for (const n of [5, 9, Math.floor(link.length / 2), link.length - 2]) {
    await assert.rejects(unpack(link.slice(0, n)), `cut at ${n}`);
    await assert.rejects(unpack(link.slice(0, n) + link.slice(n + 1)), `letter ${n} left out`);
  }
});

test('a game this version makes holds nothing newer', () => {
  for (const g of [everyKind(), sampleGame(3), sampleGame(7), newGame()]) {
    assert.equal(newer(g), false);
    assert.equal(newer(cleanGame(JSON.parse(JSON.stringify(g)))), false);
  }
});

// What a newer Backwards K might save: a new kind of event, pitch, play and substitution, and new values on the game,
// a team, a player and today's events.
const LATER = {
  ev: [{ t: 'xr', b: 2, who: { slot: 3, note: 'last out' } }, { t: 'p', k: 'v' }, { t: 'pa', r: 'OBS', m: [[0, 1]] }, { t: 'sub', s: 0, slot: 2, i: 0, ty: 'cr' }],
  pa: { loc: [120, 80], hard: true }, end: { why: 'rain' },
  game: { limits: { pitches: 85, rest: [1, 2, 4] } }, team: { coach: 'Ann' }, player: { bats: 'L', throws: 'R' },
};
function laterGame() {
  const g = everyKind();
  g.ev.splice(3, 0, LATER.ev[0], LATER.ev[1]);
  g.ev.push(LATER.ev[2], LATER.ev[3]);
  Object.assign(g.ev.find(e => e.t === 'pa'), LATER.pa);
  Object.assign(g.ev.find(e => e.t === 'end'), LATER.end);
  Object.assign(g, LATER.game);
  Object.assign(g.teams[1], LATER.team);
  Object.assign(g.teams[0].lineup[0][0], LATER.player);
  return g;
}

test('what a newer Backwards K saved is kept, from a file, Drive, storage or a link, and makes the game look-only', async () => {
  const g = laterGame(), json = JSON.parse(JSON.stringify(g)), c = cleanGame(json);
  assert.deepEqual(c, g, 'kept as it came');
  assert.deepEqual(cleanGame(c), c, 'tidying again changes nothing');
  assert.deepEqual(cleanDoc({ app: 'backwards-k', v: 1, games: { [g.id]: json }, gone: {} }).games[g.id], g);
  const { pack, unpack } = await import('../js/share.js');
  assert.deepEqual(cleanGame(await unpack(await pack(g))), g);
  assert.equal(newer(c), true);
  // Any one of them is enough.
  const one = [
    ...LATER.ev.map(e => g0 => g0.ev.push(e)),
    g0 => Object.assign(g0.ev.find(e => e.t === 'pa'), LATER.pa), g0 => Object.assign(g0.ev.find(e => e.t === 'end'), LATER.end),
    g0 => Object.assign(g0, LATER.game), g0 => Object.assign(g0.teams[1], LATER.team), g0 => Object.assign(g0.teams[1].pitchers[0], LATER.player),
  ];
  for (const f of one) { const g0 = everyKind(); f(g0); assert.equal(newer(cleanGame(JSON.parse(JSON.stringify(g0)))), true, String(f)); }
  // This version passes over what it doesn't know: the score, the count and the plays are what they were.
  const S = replay(c), was = replay(everyKind());
  assert.deepEqual([S.R, S.H, S.E, S.inn, S.half, S.outs], [was.R, was.H, was.E, was.inn, was.half, was.outs]);
  assert.deepEqual(S.plays.map(p => p.text), was.plays.map(p => p.text).concat(S.plays.slice(was.plays.length).map(p => p.text)));
  assert.equal(S.cells.length, was.cells.length);
  for (const t of S.text) if (t) assert.doesNotMatch(t, /undefined|NaN/);
});

test('what a newer version saved is kept only while it is small and plain', () => {
  const g = everyKind(), big = 'x'.repeat(5000);
  const deep = { a: { b: { c: { d: { e: 1 } } } } };
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['k' + i, i]));
  g.ev.push({ t: 'xr', note: big, deep, many, list: Array.from({ length: 80 }, (_, i) => i) });
  g.ev.push({ t: 'xr', pad: Array.from({ length: 50 }, () => 'y'.repeat(30)) }); // more than 1,000 characters
  g.ev.push({ t: 'no such kind!' }, { t: 'constructor' }, { t: 'toString', a: 1 }, { t: 42 }, ['xr'], null);
  g.limits = { pad: Array.from({ length: 50 }, () => 'z'.repeat(60)) }; // more than 2,000 characters
  g.teams[0].lineup[0][0].bats = big;
  const raw = JSON.parse(JSON.stringify(g).replace('"deep":', '"__proto__":{"polluted":1},"deep":'));
  const c = cleanGame(raw), [x, ...rest] = c.ev.slice(everyKind().ev.length);
  assert.equal(x.note.length, 200);
  assert.deepEqual(x.deep, { a: { b: {} } }, 'four deep, counting the event');
  assert.equal(Object.keys(x.many).length, 20);
  assert.equal(x.list.length, 50);
  assert.equal(Object.getOwnPropertyNames(x).includes('__proto__'), false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(rest, [{ t: 'constructor' }, { t: 'toString', a: 1 }], 'the one too long and the ones that aren\u2019t events are left out');
  assert.equal('limits' in c, false);
  assert.equal(c.teams[0].lineup[0][0].bats.length, 200);
  assert.deepEqual(cleanGame(c), c);
  assert.equal(newer(c), true);
  replay(c);
});

test('a value that isn’t plain JSON is left out', () => {
  const g = everyKind();
  g.ev.push({ t: 'xr', f: () => 1, n: Infinity, u: undefined, d: new Date(0), ok: [1, NaN, 'a'] });
  assert.deepEqual(cleanGame(g).ev.at(-1), { t: 'xr', d: {}, ok: [1, null, 'a'] });
});

// Two copies of one game: the start of it, then each changed on its own (later: changed after).
function copies() {
  const base = game();
  play(base, '1B', 'K', '2B');
  base.updated = 1000;
  const a = JSON.parse(JSON.stringify(base)), b = JSON.parse(JSON.stringify(base));
  return { base, a, b };
}
const later = (g, t) => { g.updated = t; return g; };

test('two copies of a game: one whose plays are the start of the other’s gets the rest, with the newest names', () => {
  // The phone scored on; the tablet, with the copy from before, renamed a batter after that.
  const { a, b } = copies();
  play(a, 'HR', 'GO 6 3', 'BB');
  later(a, 2000);
  b.teams[0].lineup[0][0].name = 'Ruiz';
  b.place = 'Riverside Park';
  later(b, 3000);
  for (const [x, y] of [[a, b], [b, a]]) {
    const { game, second } = merge(x, y);
    assert.equal(second, null);
    assert.deepEqual(game.ev, a.ev, 'every play');
    assert.equal(game.teams[0].lineup[0][0].name, 'Ruiz');
    assert.equal(game.place, 'Riverside Park');
    assert.ok(game.updated > 3000, 'changed after both');
    assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(game))), game);
  }
  // The copy with every play, changed last too, is the answer itself.
  later(a, 4000);
  b.teams[0].lineup[0][0].name = '';
  b.place = '';
  assert.equal(merge(b, a).game, a);
  // The same plays: the copy changed last wins, as before.
  const { a: c, b: d } = copies();
  d.teams[1].name = 'Bears';
  later(d, 5000);
  assert.equal(merge(c, d).game, d);
  assert.equal(merge(d, c).game, d);
});

test('a play taken back with Undo stays taken back, when Drive saw the longer list last', () => {
  const { base, a, b } = copies();
  takeBack(a);
  later(a, 2000);
  b.teams[1].name = 'Bears';
  later(b, 3000);
  const seen = seenOf(base);
  for (const [x, y] of [[a, b], [b, a]]) {
    const { game } = merge(x, y, seen);
    assert.deepEqual(game.ev, a.ev, 'the play stays taken back');
    assert.equal(game.teams[1].name, 'Bears', 'and the new name stays');
  }
  // Without that, or when the longer list has plays Drive never saw, the plays stay.
  assert.deepEqual(merge(a, b).game.ev, base.ev);
  play(b, 'K');
  assert.deepEqual(merge(a, b, seen).game.ev, b.ev);
});

test('two copies with names changed on each: every name from the copy that changed it, the latest when both did', () => {
  // The tablet fixed a team's name, a batter's number, the place and the innings; the phone scored on after it, and
  // fixed another batter's number and the innings too.
  const { base, a, b } = copies();
  const seen = JSON.parse(JSON.stringify(seenOf(base))); // (as Drive's note of it comes back from the browser's storage)
  base.teams[1].lineup[0][0].pos = 'SS'; // (and a position both copies had)
  a.teams[1].lineup[0][0].pos = b.teams[1].lineup[0][0].pos = 'SS';
  const was = seenOf(base);
  b.teams[0].name = 'Red Foxes'; b.teams[1].lineup[2][0].num = '12'; b.place = 'Riverside Park'; b.innings = 7;
  delete b.teams[1].lineup[0][0].pos;
  later(b, 2000);
  play(a, 'HR', 'K');
  a.teams[0].lineup[0][0].num = '7'; a.innings = 6;
  later(a, 3000);
  for (const [x, y] of [[a, b], [b, a]]) {
    const { game, second } = merge(x, y, was);
    assert.equal(second, null);
    assert.deepEqual(game.ev, a.ev, 'every play');
    assert.deepEqual([game.teams[0].name, game.teams[1].lineup[2][0].num, game.place], ['Red Foxes', '12', 'Riverside Park'], 'the tablet’s');
    assert.equal(game.teams[0].lineup[0][0].num, '7', 'the phone’s');
    assert.equal(game.teams[1].lineup[0][0].pos, undefined, 'a position taken off stays off');
    assert.equal(game.innings, 6, 'both changed it: the one changed last');
    assert.ok(game.updated > 3000);
    assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(game))), game);
  }
  // With nothing to compare with (a shared link, or a note of the plays alone), the names of the copy changed last.
  for (const s of [null, { n: seen.n, h: seen.h }]) assert.deepEqual([merge(a, b, s).game.teams[0].name, merge(a, b, s).game.place], ['Foxes', '']);
  assert.equal(merge(b, a, seen).game.teams[0].name, 'Red Foxes', 'from the note as stored');
  // The same plays, a name changed on each: both stay.
  const { base: c0, a: c, b: d } = copies();
  c.teams[0].name = 'Owls'; later(c, 2000);
  d.teams[1].name = 'Bears'; later(d, 3000);
  assert.deepEqual(merge(c, d, seenOf(c0)).game.teams.map(t => t.name), ['Owls', 'Bears']);
  assert.equal(merge(c, d).game, d, 'with nothing to compare with, the copy changed last, as before');
  // Nothing changed on the copy changed last since: that copy is the answer itself.
  const { base: e0, a: e, b: f } = copies();
  play(f, 'K'); later(f, 2000);
  assert.equal(merge(e, f, seenOf(e0)).game, f);
});

test('a setting from one copy that would change the plays the other scored isn’t taken, as Game settings wouldn’t take it', () => {
  // The tablet put in Little League Minors (5 runs a half), 6 innings and a runner on second from the 7th, with nobody
  // in yet; the phone, with the copy from before, scored on to 7 runs in the top of the 1st, and is the copy changed
  // last.
  const { base, a, b } = copies();
  const seen = JSON.parse(JSON.stringify(seenOf(base))), MINORS = { set: 'minors', runs: 5, last: false, all: false, mercy: [[3, 15], [4, 10]] };
  b.rules = MINORS; b.innings = 6; b.tie = 7; b.teams[1].name = 'Bears';
  assert.equal(sameSoFar(base, { ...base, rules: MINORS }), true, 'the tablet could');
  later(b, 2000);
  play(a, 'HR', 'HR', 'HR', 'HR');
  later(a, 3000);
  const runs = replay(a).R;
  assert.ok(runs[0] > 5);
  for (const [x, y] of [[a, b], [b, a]]) {
    const { game } = merge(x, y, seen);
    assert.deepEqual(game.ev, a.ev);
    // The run limit would end the half at 5 and move the last plays to the home team: it stays off. The rest is taken.
    assert.deepEqual([game.rules, game.innings, game.tie, game.teams[1].name], [null, 6, 7, 'Bears']);
    assert.deepEqual(replay(game).R, runs);
  }
  // Before the plays went past it, it's taken.
  const { base: c0, a: c, b: d } = copies();
  d.rules = MINORS; later(d, 2000);
  play(c, 'HR'); later(c, 3000);
  assert.deepEqual(merge(c, d, seenOf(c0)).game.rules, MINORS);
  // A shared link, with nothing to compare with, that set it last: the same.
  assert.equal(merge(a, later(b, 4000)).game.rules, null);
});

test('two copies that each have plays the other lacks are both kept, the second marked', () => {
  const { a, b } = copies();
  play(a, 'HR');
  later(a, 2000);
  play(b, 'K', 'K');
  b.place = 'Riverside Park';
  later(b, 3000);
  const { game, second } = merge(a, b);
  assert.deepEqual(game.ev, a.ev);
  assert.equal(game.id, a.id);
  assert.ok(game.updated > 3000, 'changed after both, so it replaces b where b was');
  assert.deepEqual(second.ev, b.ev);
  assert.notEqual(second.id, a.id);
  assert.equal(second.place, 'Riverside Park (second copy)');
  assert.equal(merge(a, second).second.place, 'Riverside Park (second copy)', 'marked once');
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(second))), second);
  // The copy that keeps the game, changed last, is kept as it is.
  later(a, 9000);
  assert.equal(merge(a, b).game, a);
});

test('a play made here and the same play read back from Drive or a link are the same play, whatever order its values are in', () => {
  // A ground out 6-3 the way the game screen makes it ({ t, r, m }, then f), here; Drive's copy has it as cleanGame
  // reads it back ({ t, r, f, m }), renamed on another device since.
  const here = () => { const g = game(); play(g, 'GO 6 3', P('b')); return later(g, 1000); };
  const a = here(), seen = seenOf(a), drive = later(cleanGame(JSON.parse(JSON.stringify(a))), 3000);
  drive.teams[0].name = 'Red Foxes';
  assert.notEqual(JSON.stringify(drive.ev), JSON.stringify(a.ev));
  assert.deepEqual([seenOf(drive).n, seenOf(drive).h], [seen.n, seen.h], 'the same plays, to Drive’s note');
  // The same plays: one game, not a second copy.
  assert.equal(merge(drive, a, seen).game, drive);
  assert.equal(merge(a, drive).second, null);
  // A pitch here since: one game, with it.
  a.ev.push({ t: 'p', k: 's' });
  later(a, 2000);
  for (const [x, y] of [[drive, a], [a, drive]]) {
    const { game, second } = merge(x, y, seen);
    assert.equal(second, null);
    assert.equal(game.ev.length, 3);
    assert.equal(game.teams[0].name, 'Red Foxes');
  }
  // Undo here instead: the play stays taken back.
  const b = here();
  takeBack(b);
  later(b, 2000);
  const { game: undone, second } = merge(drive, b, seen);
  assert.equal(second, null);
  assert.deepEqual(undone.ev.map(e => e.r || e.k), ['GO']);
});

// The browser's storage, pretend: localStorage and the window store.js listens to.
function pretendStorage(start = {}) {
  const m = new Map(Object.entries(start));
  globalThis.localStorage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } };
  globalThis.window ??= { addEventListener() {} };
  return m;
}

test('saving one game writes the others as they were saved, not made into JSON again', async () => {
  const m = pretendStorage();
  const { store } = await import('../js/store.js?' + Math.random());
  const [a, b] = [sampleGame(3), sampleGame(5)];
  b.id = 'gsampleb';
  store.save(a);
  store.save(b);
  assert.equal(m.get('backwards-k.v1'), JSON.stringify(store.doc()), 'the same as the whole thing made into JSON');
  // b changed without being saved (as a name being typed is, until a pause): saving a writes b as it was saved.
  const was = m.get('backwards-k.v1');
  b.place = 'Not saved yet';
  play(a, 'K');
  store.save(a);
  const now = JSON.parse(m.get('backwards-k.v1'));
  assert.equal(now.games[b.id].place, JSON.parse(was).games[b.id].place);
  assert.deepEqual(now.games[a.id], JSON.parse(JSON.stringify(a)));
  store.save(b);
  assert.equal(m.get('backwards-k.v1'), JSON.stringify(store.doc()));
  store.remove(a.id);
  assert.equal(m.get('backwards-k.v1'), JSON.stringify(store.doc()));
});

test('a date from another year says which year', async () => {
  const { fmtDate } = await import('../js/ui.js');
  const y = new Date().getFullYear();
  assert.doesNotMatch(fmtDate(`${y}-03-04`), new RegExp(String(y)));
  assert.match(fmtDate(`${y - 1}-03-04`), new RegExp(String(y - 1)));
  assert.match(fmtDate('2019-12-31'), /2019/);
  assert.match(fmtDate(`${y}-03-04`, true), new RegExp(String(y)), 'the long date always has it');
});

test('a game can have up to 30 innings', () => {
  assert.equal(cleanGame({ ...game(), innings: 25 }).innings, 25);
  assert.equal(cleanGame({ ...game(), innings: 99 }).innings, 30);
  assert.equal(cleanGame({ ...game(), innings: 0 }).innings, 1);
  const g = game({ innings: 20 });
  for (let i = 0; i < 19 * 6; i++) play(g, 'K');
  assert.deepEqual([replay(g).inn, replay(g).over], [20, false]);
});

test('each box on the card says its inning, what came after, the out and the count', () => {
  const g = game();
  play(g, P('b'), '2B', P('s'), P('s'), { t: 'pa', r: 'GO', f: [6, 3], m: [[0, 0], [2, 3]] }, 'K');
  const h = cardHtml(replay(g), 0);
  assert.match(h, /aria-label="1st inning\. Batter 1 doubles\. To third on Batter 2’s ground out\. Count: 1 ball, 0 strikes\."/);
  assert.match(h, /aria-label="1st inning\. Batter 2 grounds out, short to first \(6-3\)\. Batter 1 to third\. 1st out\. Count: 0 balls, 2 strikes\."/);
  assert.match(h, /<span class="sr">Inning <\/span>1</);
  assert.match(h, /<span class="sr">Batter 4 is up<\/span>/);
  assert.match(h, /<span class="sr">, at bat<\/span>/);
  assert.match(boxHtml(replay(g)), /<abbr title="At bats">AB<\/abbr>/);
});

// What the runner sheet saves when one wild throw or wild pitch moves several runners: one play with every move.
test('one throw or wild pitch that moved two runners keeps both moves in a file and a link', async () => {
  const g = game();
  play(g, '1B', 'BB', { t: 'r', m: [[2, 3, 'E', [2]], [1, 2, 'E', [2]]] }, { t: 'r', m: [[3, 4, 'WP'], [2, 3, 'WP']] });
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(c.ev, g.ev);
  const { pack, unpack } = await import('../js/share.js');
  assert.deepEqual(cleanGame(await unpack(await pack(g))).ev, g.ev);
  const S = replay(c);
  assert.deepEqual([S.E[1], S.pitching[1][0].wp, S.R[0], S.bases.map(Boolean)], [1, 1, 1, [false, false, false, true]]);
});

// Hundreds of simulated games: the totals always agree with each other.
test('simulated games add up', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const g = sampleGame(seed, { innings: seed % 3 ? 9 : 6 });
    const S = replay(g);
    assert.equal(S.over, true, `seed ${seed} finished`);
    for (const side of [0, 1]) {
      const byInning = S.line[side].reduce((a, b) => a + b, 0);
      assert.equal(byInning, S.R[side], `seed ${seed}: runs by inning`);
      const batted = Object.entries(S.bat).filter(([k]) => k.startsWith(side + '.')).reduce((a, [, b]) => a + b.r, 0);
      assert.equal(batted, S.R[side], `seed ${seed}: runs by batter`);
      const charged = S.pitching[1 - side].reduce((a, p) => a + (p ? p.r : 0), 0);
      assert.equal(charged, S.R[side], `seed ${seed}: runs by pitcher`);
      const hits = S.cells.filter(c => c.side === side && RESULTS[c.r].kind === 'hit').length;
      assert.equal(hits, S.H[side], `seed ${seed}: hits`);
      const scoredCells = S.cells.filter(c => c.side === side && c.scored).length;
      assert.equal(scoredCells, S.R[side], `seed ${seed}: scored boxes`);
      const [bats, ends] = scorersProof(S, side);
      assert.equal(bats, ends, `seed ${seed}: AB + BB + HBP + SH + SF + CI = R + LOB + putouts (OBR 9.03(c))`);
      const pas = S.cells.filter(c => c.side === side).length;
      assert.equal(sum(Object.entries(S.bat).filter(([k]) => k.startsWith(side + '.')).map(([, b]) => b.pa)), pas, `seed ${seed}: batters’ PA`);
      assert.equal(sum(S.pitching[1 - side].map(p => p ? p.bf : 0)), pas, `seed ${seed}: batters faced`);
    }
    // No run counts on a play whose third out is the batter put out before reaching first (OBR 5.08(a)).
    for (const p of S.plays) {
      const c = p.kind === 'pa' && S.cells[p.cell];
      if (c && c.outN === 3 && !c.reach) assert.equal(p.runs, 0, `seed ${seed}: ${p.text}`);
    }
    // The box-score proof, every half-inning: each trip to the plate ends as a run, a runner left on or an out.
    for (const side of [0, 1]) for (let inn = 1; inn <= S.line[side].length; inn++) {
      const [pa, ends] = proof(S, side, inn);
      assert.equal(pa, ends, `seed ${seed}: ${side ? 'bottom' : 'top'} ${inn}, PA = R + LOB + outs`);
    }
    for (const t of [...S.text, ...S.plays.map(p => p.text), ...S.cells.flatMap(c => [c.text, ...c.story])]) {
      assert.doesNotMatch(t, /undefined|NaN/, `seed ${seed}: words`);
    }
    assert.notEqual(S.R[0], S.R[1], `seed ${seed}: no ties`);
    // Every half-inning but a walk-off's ends with three outs.
    const ends = S.plays.filter(p => p.kind === 'end').length;
    assert.ok(ends >= (g.innings * 2 - 2), `seed ${seed}: enough innings`);
  }
});

// A three-inning game scored by hand, with the box score worked out on paper: walks, a sacrifice bunt and fly, a
// dropped third strike, a pickoff, a pinch runner, catcher's interference, a passed ball and a balk, a double play
// with a run scoring, a line drive doubled off, caught stealing, a hit batter, an error by the catcher, and the
// three changes mid-play from OBR 9.15(b), 9.16(g) and 9.16(h).
test('a game scored by hand: every batting and pitching line', () => {
  const g = game({ innings: 3 });
  g.teams[1].lineup[0].push({ name: 'Runner', num: '' });
  g.teams[1].lineup[2].push({ name: 'Pinch', num: '' });
  g.teams[0].pitchers.push({ name: 'Relief', num: '' });
  g.teams[1].pitchers.push({ name: 'Relief', num: '' });
  const pa = (r, m, f) => ({ t: 'pa', r, m, ...(f ? { f } : {}) });
  const S = play(g,
    // Top 1: a new pitcher at 3-0 walks the leadoff man; he scores on the sacrifice fly.
    P('b'), P('b'), P('b'), { t: 'pch', s: 1, i: 1 }, P('b'),
    pa('SAC', [[0, 0], [1, 2]], [1, 3]), pa('IBB', [[0, 1], [2, 2]]), { t: 'r', m: [[2, 3, 'WP'], [1, 2, 'WP']] },
    pa('SF', [[0, 0], [3, 4], [2, 2]], [8]), pa('KD', [[0, 1], [2, 2]]), { t: 'r', m: [[1, 0, 'PO', [1, 3]]] },
    // Bottom 1: a pinch runner steals and scores on a double play; catcher's interference, and an error brings in a run.
    pa('1B', [[0, 1]]), { t: 'sub', s: 1, slot: 0, i: 1, ty: 'pr' }, { t: 'r', m: [[1, 2, 'SB']] },
    pa('CI', [[0, 1], [2, 2]]), { t: 'r', m: [[2, 3, 'PB'], [1, 2, 'PB']] }, pa('BB', [[0, 1], [2, 2], [3, 3]]),
    pa('DP', [[0, 0], [1, 0], [2, 3], [3, 4]], [6, 4, 3]), pa('E', [[0, 1], [3, 4]], [6]), { t: 'r', m: [[1, 2, 'BK']] },
    P('s'), P('s'), P('s'),
    // Top 2: a home run, a line drive doubled off, a triple, a single that drives it in, and caught stealing.
    pa('HR', [[0, 4]]), pa('1B', [[0, 1]]), pa('LO', [[0, 0], [1, 0]], [4, 3]), pa('3B', [[0, 3]]),
    pa('1B', [[0, 1], [3, 4]]), { t: 'r', m: [[1, 0, 'CS', [2, 6]]] },
    // Bottom 2: a hit batter, a new pitcher, a force at second, a double; a pinch hitter at 0-2 strikes out.
    pa('HBP', [[0, 1]]), { t: 'pch', s: 0, i: 1 }, pa('FC', [[0, 1], [1, 0]], [6, 4]), pa('2B', [[0, 2], [1, 4]]),
    pa('GO', [[0, 0], [2, 3]], [4, 3]), pa('1B', [[0, 1], [3, 4]]), P('c'), P('s'),
    { t: 'sub', s: 1, slot: 2, i: 1, ty: 'ph' }, P('s'),
    // Top 3: a walk, a throwing error by the catcher, and two outs that leave him on third. The Comets win 4-3.
    pa('K', [[0, 0]]), pa('BB', [[0, 1]]), { t: 'r', m: [[1, 2, 'E', [2]]] }, pa('GO', [[0, 0], [2, 3]], [6, 3]),
    pa('PU', [[0, 0], [3, 3]], [5]),
  );
  assert.equal(halfLabel(S), 'Final');
  assert.deepEqual([S.line, S.R, S.H, S.E, S.lob], [[[1, 2, 0], [2, 2]], [3, 4], [4, 3], [2, 1], [[1, 0, 1], [1, 1]]]);
  assert.deepEqual(lineRow(S, 1).slice(0, 3), ['2', '2', 'X']);
  // PA AB R H RBI BB K HBP SB CS, then doubles, triples and home runs.
  const bat = k => { const b = S.bat[k]; return b && [b.pa, b.ab, b.r, b.h, b.rbi, b.bb, b.k, b.hbp, b.sb, b.cs, b.d, b.t, b.hr].join(' '); };
  assert.deepEqual(Object.keys(S.bat).sort().map(k => k + ': ' + bat(k)), [
    '0.0.0: 2 1 1 1 1 1 0 0 0 1 0 0 0', // BB (the starter's), 1B with an RBI, caught stealing
    '0.1.0: 2 1 0 0 0 0 1 0 0 0 0 0 0', // SAC, K
    '0.2.0: 2 0 0 0 0 2 0 0 0 0 0 0 0', // IBB, BB
    '0.3.0: 2 1 0 0 1 0 0 0 0 0 0 0 0', // SF8, 6-3
    '0.4.0: 2 2 0 0 0 0 1 0 0 0 0 0 0', // dropped third strike, P5
    '0.5.0: 1 1 1 1 1 0 0 0 0 0 0 0 1', // HR
    '0.6.0: 1 1 0 1 0 0 0 0 0 0 0 0 0', // 1B, doubled off
    '0.7.0: 1 1 0 0 0 0 0 0 0 0 0 0 0', // L4 double play
    '0.8.0: 1 1 1 1 0 0 0 0 0 0 0 1 0', // 3B
    '1.0.0: 1 1 0 1 0 0 0 0 0 0 0 0 0', // 1B, then a pinch runner
    '1.0.1: 1 1 1 0 0 0 0 0 1 0 0 0 0', // the pinch runner: SB, scored, then 4-3
    '1.1.0: 2 1 1 1 1 0 0 0 0 0 0 0 0', // CI, scored; 1B with an RBI
    '1.2.0: 2 1 0 0 0 1 1 0 0 0 0 0 0', // BB; the strikeout his pinch hitter finished (9.15(b))
    '1.3.0: 1 1 0 0 0 0 0 0 0 0 0 0 0', // 6-4-3 DP: a run scores, no RBI (9.04(b)(1))
    '1.4.0: 1 1 0 0 0 0 0 0 0 0 0 0 0', // E6: a run scores, no RBI
    '1.5.0: 1 1 0 0 0 0 1 0 0 0 0 0 0', // K
    '1.6.0: 1 0 0 0 0 0 0 1 0 0 0 0 0', // HBP, forced at second
    '1.7.0: 1 1 1 0 0 0 0 0 0 0 0 0 0', // FC 6-4, scored
    '1.8.0: 1 1 1 1 1 0 0 0 0 0 1 0 0', // 2B with an RBI, scored
  ]);
  // Outs BF H R BB K HR HBP WP BK, pitches and strikes.
  const pit = p => [p.outs, p.bf, p.h, p.r, p.bb, p.k, p.hr, p.hbp, p.wp, p.bk, p.np, p.str].join(' ');
  assert.deepEqual(S.pitching.map(t => t.map(pit)), [
    [
      '3 7 1 3 1 1 0 1 0 1 9 7', // the visitors' starter: the runner forced at second was his, so the run is too (9.16(g))
      '3 5 2 1 0 1 0 0 0 0 7 7',
    ],
    [
      '0 1 0 1 1 0 0 0 0 0 3 0', // the home starter: three balls, and the walk and the run that came of it (9.16(h))
      '9 13 4 2 2 2 1 0 1 0 13 11',
    ],
  ]);
  assert.deepEqual([scorersProof(S, 0), scorersProof(S, 1)], [[14, 14], [12, 12]]);
  assert.equal(S.cells.find(c => c.side === 1 && c.slot === 2 && c.inn === 1).outHow, '6-4');
  // The E under each card is the other team's errors, which the line score lists against them.
  assert.match(cardHtml(S, 1), /title="Errors by the other team while these batters were up">E<\/th><td colspan="1">2<\/td><td colspan="1">0<\/td>/);
});

// Everything replay() works out, written out to compare: the score, the count and outs, who's where, each box, the
// batting and pitching lines, the plays and the line score.
const state = S => JSON.stringify({
  R: S.R, H: S.H, E: S.E, outs: S.outs, inn: S.inn, half: S.half, b: S.b, s: S.s, up: S.up, pit: S.pit, size: S.size,
  pl: S.pl.map((a, s) => a.slice(0, S.size[s])), // who's in each spot of the order
  over: S.over, ended: S.ended, hold: S.hold, line: S.line, lob: S.lob, errs: S.errs,
  bases: S.bases.map(r => r && [r.side, r.slot, r.p, r.pi, r.cell.n]), cells: S.cells, bat: S.bat, pitching: S.pitching,
  text: S.text, plays: S.plays,
});
// A game built up one tap at a time, the way the game screen builds it: each new player, pitcher and batting slot is
// added to the teams when the event that brings them in is, and the game is replayed after every tap. The state after
// each tap, from none to all of them.
function tapByTap(g) {
  const adds = [0, 1].map(s => g.ev.filter(e => e.t === 'add' && e.s === s).length);
  const live = {
    ...g, ev: [],
    teams: g.teams.map((t, s) => ({ ...t, lineup: t.lineup.slice(0, t.lineup.length - adds[s]).map(slot => [slot[0]]), pitchers: [t.pitchers[0]] })),
  };
  const seen = [state(replay(live))];
  for (const e of g.ev) {
    const t = live.teams[e.s];
    if (e.t === 'sub' && e.i === t.lineup[e.slot].length) t.lineup[e.slot].push(g.teams[e.s].lineup[e.slot][e.i]);
    if (e.t === 'pch' && e.i === t.pitchers.length) t.pitchers.push(g.teams[e.s].pitchers[e.i]);
    if (e.t === 'add') t.lineup.push([g.teams[e.s].lineup[t.lineup.length][0]]);
    live.ev.push(structuredClone(e));
    seen.push(state(replay(live)));
  }
  return seen;
}

// Undo is dropping the last event (and whoever it brought in), so after any number of Undos the game is exactly as
// it was before those taps, and Redo brings it back exactly.
test('undo is exact: replaying the first plays gives the game as it stood, tap by tap, and redo puts it all back', () => {
  for (const [name, g] of [...Array.from({ length: 20 }, (_, i) => [`seed ${i + 1}`, sampleGame(i + 1)]), ['every kind', everyKind()]]) {
    const seen = tapByTap(g), n = g.ev.length;
    // Replaying the first k events of the whole game.
    for (let k = 0; k <= n; k++) assert.equal(state(replay(g, k)), seen[k], `${name}: the first ${k} events`);
    // Undo, all the way back, then Redo, all the way forward.
    const copy = structuredClone(g), taken = [];
    assert.equal(state(replay(copy)), seen[n], `${name}: all of it`);
    for (let k = n - 1; k >= 0; k--) {
      taken.push(takeBack(copy));
      assert.equal(state(replay(copy)), seen[k], `${name}: undone back to ${k}`);
    }
    assert.deepEqual(copy.teams.map(t => [t.lineup.length, t.lineup.map(s => s.length).join(), t.pitchers.length]), [[9, '1,1,1,1,1,1,1,1,1', 1], [9, '1,1,1,1,1,1,1,1,1', 1]], `${name}: everyone brought in has gone`);
    for (let k = 1; k <= n; k++) {
      putBack(copy, taken.pop());
      assert.equal(state(replay(copy)), seen[k], `${name}: redone to ${k}`);
    }
    assert.deepEqual(copy, g, `${name}: the game is as it was`);
  }
});

test('replaying the start of a game leaves out a batter added later', () => {
  const g = game();
  play(g, 'KL');
  g.teams[0].lineup.push([{ name: 'Newman', num: '' }]);
  play(g, { t: 'add', s: 0 }, '1B');
  assert.deepEqual([replay(g, 1).size, replay(g, 2).size], [[9, 9], [10, 9]]);
  assert.equal(now(replay(g, 1)).deckName, 'Batter 3');
  // Added after the order came round: the new batter is up next.
  const h = game({ innings: 3 });
  play(h, ...Array(9).fill('1B'));
  h.teams[0].lineup.push([{ name: 'Newman', num: '' }]);
  const S = play(h, { t: 'add', s: 0 });
  assert.equal(now(S).name, 'Newman');
  assert.equal(now(replay(h, 9)).name, 'Batter 1', 'before he was added, the top of the order was up');
});

test('every suggested set of runner moves passes check()', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const g = sampleGame(seed);
    const part = { ...g, ev: [] };
    for (const e of g.ev) {
      if (e.t === 'pa') {
        const S = replay(part);
        assert.equal(check(S, e.m), '', `seed ${seed}, event ${part.ev.length}: ${JSON.stringify(e)}`);
        // And what the pad suggests for every button it allows here passes for that play, and is scored as tapped.
        const on = runnersOn(S).length;
        const can = { SF: S.bases[3] && S.outs < 2, SAC: on && S.outs < 2, DP: on && S.outs < 2, FC: on, TP: on >= 2 && S.outs === 0, KD: !(S.bases[1] && S.outs < 2) };
        for (const code of Object.keys(RESULTS).filter(k => !(k in can) || can[k])) {
          const m = suggest(S, code);
          assert.equal(check(S, m, code), '', `seed ${seed}, event ${part.ev.length}: ${code}`);
          assert.equal(scoredAs(S, code, null, m), code, `seed ${seed}, event ${part.ev.length}: ${code}`);
        }
      }
      part.ev.push(e);
    }
  }
});

test('pasting a lineup: jersey numbers, or a batting order copied from a game preview', () => {
  const names = list => list.map(p => p.num ? `${p.name} #${p.num}` : p.name);
  assert.deepEqual(names(parseLineup('12 Ruiz\nOkafor #11\nCastillo, 7\nBrennan')), ['Ruiz #12', 'Okafor #11', 'Castillo #7', 'Brennan']);
  // Numbered 1 to 9 down the side: that's the order, not jersey numbers; positions, handedness and the heading go.
  const preview = 'Visitors lineup\n1 Shohei Ohtani DH\n2 Mookie Betts (R) SS\n3 Freddie Freeman 1B\n4 Will Smith C\n5 Teoscar Hernández RF\n6 Max Muncy 3B\n7 Tommy Edman CF\n8 Andy Pages LF\n9 Kiké Hernández 2B';
  const got = parseLineup(preview);
  assert.equal(got.length, 9);
  assert.deepEqual(got.slice(0, 3), [{ name: 'Shohei Ohtani', num: '', pos: 'DH' }, { name: 'Mookie Betts', num: '', pos: 'SS' }, { name: 'Freddie Freeman', num: '', pos: '1B' }]);
  assert.equal(got[4].name, 'Teoscar Hernández');
  assert.deepEqual(parseLineup('1. 17 Ohtani DH\n2. 50 Betts SS'), [{ name: 'Ohtani', num: '17', pos: 'DH' }, { name: 'Betts', num: '50', pos: 'SS' }]);
  assert.deepEqual(parseLineup('1) Judge #99 RF\n2) Soto LF'), [{ name: 'Judge', num: '99', pos: 'RF' }, { name: 'Soto', num: '', pos: 'LF' }]);
  // Numbers that aren't 1, 2, 3 in order are jersey numbers.
  assert.deepEqual(parseLineup('22 Kershaw\n35 Bellinger'), [{ name: 'Kershaw', num: '22' }, { name: 'Bellinger', num: '35' }]);
});

test('pasting a lineup from a group text: commas, bullets, headings, dashes and the pitcher', () => {
  const names = list => list.map(p => (p.num ? `${p.name} #${p.num}` : p.name));
  const kids = ['Emma', 'Liam', 'Noah', 'Olivia', 'Ava', 'Mia', 'Lucas', 'Zoe', 'Eli', 'Ruby', 'Finn'];
  assert.deepEqual(names(parseLineup(kids.join(', '))), kids);
  assert.deepEqual(names(parseLineup('Lineup today: Emma, Liam, Ava, Noah')), ['Emma', 'Liam', 'Ava', 'Noah']);
  assert.deepEqual(names(parseLineup('Lineup today:\nEmma, Liam, Ava')), ['Emma', 'Liam', 'Ava']);
  assert.deepEqual(parsePaste('Lineup today: Emma, Liam, Ava\nPitcher: Olivia #22'), { batters: ['Emma', 'Liam', 'Ava'].map(name => ({ name, num: '' })), pitcher: { name: 'Olivia', num: '22' } });
  assert.deepEqual(names(parseLineup('Ruiz 2; Okafor 11; Brennan')), ['Ruiz #2', 'Okafor #11', 'Brennan']);
  // Bullets, emoji, a heading, a position after a dash or in brackets; the pitcher bats too, with no DH.
  const text = parsePaste('Saturday lineup 🧢\n- Emma 4\n- Liam 12\n- Noah (C)\n- Olivia - P\n• Ava');
  assert.deepEqual(names(text.batters), ['Emma #4', 'Liam #12', 'Noah', 'Olivia', 'Ava']);
  assert.deepEqual(text.pitcher, { name: 'Olivia', num: '' });
  // First names and initials: a final P or C is someone's initial.
  assert.deepEqual(parsePaste('Emma P\nLiam O\nNoah C\nAva K'), { batters: ['Emma P', 'Liam O', 'Noah C', 'Ava K'].map(name => ({ name, num: '' })), pitcher: null });
});

test('pasting a lineup from a game preview: the heading, the starting pitcher, one line, positions first, stats', () => {
  const nine = ['Ohtani', 'Betts', 'Freeman', 'Hernández', 'Smith', 'Muncy', 'Edman', 'Pages', 'Conforto'];
  const pos = ['DH', 'SS', '1B', 'RF', 'C', '3B', '2B', 'CF', 'LF'];
  const just = list => list.map(p => p.name);
  // A beat writer's list: the heading isn't batter 1, and the starter isn't batter 10.
  const beat = parsePaste(`Dodgers lineup vs. LHP Blake Snell:\n${nine.map((n, i) => `${n} ${pos[i]}`).join('\n')}\nYamamoto SP`);
  assert.deepEqual(just(beat.batters), nine);
  assert.deepEqual(beat.pitcher, { name: 'Yamamoto', num: '' });
  const numbered = parsePaste(`Dodgers lineup vs. LHP Snell:\n${nine.map((n, i) => `${i + 1}. ${n} ${pos[i]}`).join('\n')}\nSP: Yoshinobu Yamamoto`);
  assert.deepEqual(just(numbered.batters), nine);
  assert.equal(numbered.pitcher.name, 'Yoshinobu Yamamoto');
  // With a DH in the order, a pitcher marked P doesn't bat.
  assert.deepEqual(just(parsePaste('Ohtani DH\nBetts SS\nGlasnow P').batters), ['Ohtani', 'Betts']);
  assert.deepEqual(parsePaste('Pitcher: Okafor #11\nRuiz\nBrennan').pitcher, { name: 'Okafor', num: '11' });
  // All on one line, with commas or numbered.
  assert.deepEqual(just(parseLineup(nine.map((n, i) => `${n} ${pos[i]}`).join(', '))), nine);
  assert.deepEqual(just(parseLineup('1. Ohtani DH 2. Betts SS 3. Freeman 1B')), ['Ohtani', 'Betts', 'Freeman']);
  assert.deepEqual(parseLineup('1. 17 Ohtani DH 2. 50 Betts SS'), [{ name: 'Ohtani', num: '17', pos: 'DH' }, { name: 'Betts', num: '50', pos: 'SS' }]);
  // The position first, after a dash, or a batting average at the end.
  assert.deepEqual(just(parseLineup('SS M. Betts\nDH S. Ohtani\nC W. Smith')), ['M. Betts', 'S. Ohtani', 'W. Smith']);
  assert.deepEqual(just(parseLineup('Shohei Ohtani - DH\nMookie Betts – SS\nFreddie Freeman — 1B')), ['Shohei Ohtani', 'Mookie Betts', 'Freddie Freeman']);
  assert.deepEqual(just(parseLineup('1 Ohtani DH .282\n2 Betts SS .289 12 HR')), ['Ohtani', 'Betts']);
  assert.deepEqual(parseLineup('1\tShohei Ohtani\tDH\n2\t#50 Mookie Betts\tSS'), [{ name: 'Shohei Ohtani', num: '', pos: 'DH' }, { name: 'Mookie Betts', num: '50', pos: 'SS' }]);
});

// Morris singles, Diaz runs for him, and after the inning Morris comes back in: a sub that points at him again.
function reentry() {
  const g = game();
  g.teams[0].lineup[0] = [{ name: 'Morris', num: '21' }, { name: 'Diaz', num: '4' }];
  play(g, '1B', { t: 'sub', s: 0, slot: 0, i: 1, ty: 'pr' }, '2B', ...threeK, { t: 'sub', s: 0, slot: 0, i: 0, ty: 'def' });
  return g;
}

test('a player who was in the spot before comes back in as himself: one box-score row each, and the card says back', () => {
  const g = reentry(), S = replay(g);
  assert.equal(S.text[S.text.length - 1], 'Morris comes back in for Diaz.');
  assert.equal(S.pl[0][0], 0);
  const box = boxHtml(S);
  assert.equal(box.match(/<th scope="row">[^]*?<\/th>/g).filter(th => /Morris/.test(th)).length, 1, 'one row for Morris');
  assert.match(box, /<b>Pinch runners:<\/b> Diaz ran for Morris in the 1st\./);
  assert.doesNotMatch(box, /Morris ran for|Pinch hitters/, 'coming back in isn’t pinch-running');
  assert.match(box, /<tr class="sub"><th scope="row"><abbr class="how" title="Pinch runner">PR<\/abbr> Diaz<\/th>/);
  const card = cardHtml(S, 0), row = card.split('<tr')[2];
  assert.match(row, /<i>PR 1st<\/i> Diaz <small>#4<\/small><\/span><span class="pl" title="Morris #21"><i>back 1st<\/i> Morris <small>#21<\/small>/);
  // His single counts once in the card's totals: AB 1, R 0, H 1.
  assert.deepEqual(row.match(/<td class="tot">(\d+)<\/td>/g).map(x => +x.match(/\d+/)[0]), [1, 0, 1, 0]);
  // Back in, he bats as himself.
  const T = play(g, ...threeK, 'K', '1B', '1B', 'K', '2B');
  assert.deepEqual([T.bat['0.0.0'].pa, T.bat['0.0.0'].h, T.bat['0.0.1']], [2, 2, undefined]);
  assert.match(T.text[T.text.length - 1], /^Morris doubles/);
});

test('a team from before starts its next game with its starters, not the pinch hitters and runners who finished', () => {
  const g = game();
  g.teams[0].lineup[0] = [{ name: 'Morris', num: '21' }, { name: 'Diaz', num: '4', pos: 'SS' }];
  g.teams[0].lineup[1] = [{ name: 'Ruiz', num: '2' }, { name: 'Okafor', num: '11' }];
  play(g, '1B', { t: 'sub', s: 0, slot: 0, i: 1, ty: 'pr' }, { t: 'sub', s: 0, slot: 1, i: 1, ty: 'ph' }, 'K');
  assert.deepEqual(replay(g).pl[0].slice(0, 2), [1, 1], 'Diaz and Okafor finished');
  assert.deepEqual(starters(g.teams[0]).slice(0, 3), [{ name: 'Morris', num: '21' }, { name: 'Ruiz', num: '2' }, { name: '', num: '' }]);
});

test('a player brought back in is kept in a file or a link', () => {
  const g = reentry();
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(c.ev, g.ev);
  assert.deepEqual(c.ev.filter(e => e.t === 'sub').map(e => e.i), [1, 0]);
});

test('undoing someone brought back in keeps the player an earlier change still points at; redo puts it back', () => {
  const g = reentry();
  g.ev.push({ t: 'sub', s: 0, slot: 0, i: 1, ty: 'pr' }); // Diaz back in too: the last one listed, again
  const r = takeBack(g);
  assert.equal(r.player, undefined);
  assert.deepEqual(g.teams[0].lineup[0].map(p => p.name), ['Morris', 'Diaz']);
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))).ev.filter(e => e.t === 'sub').map(e => e.i), [1, 0], 'the first change survives');
  putBack(g, r);
  assert.deepEqual(g.ev.filter(e => e.t === 'sub').map(e => e.i), [1, 0, 1]);
  // Someone new goes when his change is undone, and comes back with Redo.
  g.teams[0].lineup[0].push({ name: 'Kim', num: '' });
  g.ev.push({ t: 'sub', s: 0, slot: 0, i: 2, ty: 'def' });
  const r2 = takeBack(g);
  assert.equal(r2.player.name, 'Kim');
  assert.equal(g.teams[0].lineup[0].length, 2);
  putBack(g, r2);
  assert.deepEqual(g.teams[0].lineup[0].map(p => p.name), ['Morris', 'Diaz', 'Kim']);
});

test('a play Undo took back fits back in after a forgotten one only where it still could have happened', () => {
  const at = S => ({ half: S.half, inn: S.inn, outs: S.outs, over: S.over });
  // Scored: a single, a ball, a single that moved the runner to second. Forgotten: he stole second first.
  const g = game();
  let S = play(g, '1B', P('b'));
  const was = at(S), single = { t: 'pa', r: '1B', m: [[1, 2], [0, 1]] };
  assert.equal(fits(S, single, was), '');
  S = play(g, { t: 'r', m: [[1, 2, 'SB']] });
  assert.equal(fits(S, P('b'), was), '', 'a pitch goes back as it was');
  assert.equal(fits(S, single, was), 'runners', 'the single moved a runner from first, and he’s on second now');
  assert.equal(fits(S, { t: 'pa', r: '1B', m: [[2, 3], [0, 1]] }, was), '');
  assert.equal(fits(S, { t: 'r', m: [[1, 2, 'SB']] }, was), 'runners', 'nobody on first to steal second');
  assert.equal(fits(S, { t: 'r', m: [[2, 3, 'SB']] }, was), '');
  // A runner's move can't pass the runner ahead or share his base.
  S = play(g, 'BB');
  assert.equal(fits(S, { t: 'r', m: [[1, 2, 'SB']] }, at(S)), 'runners');
  assert.equal(fits(S, { t: 'r', m: [[2, 3, 'WP'], [1, 2, 'WP']] }, at(S)), '');
  // Nothing goes into another half-inning, or after the final.
  const h = play(game(), 'K', 'K');
  S = play(game(), 'K', 'K', 'K');
  assert.equal(fits(S, P('b'), at(h)), 'over');
  // The third out with a run crossing: only with the same outs (whether it counted was answered for those).
  const one = play(game(), '3B', 'K'), two = play(game(), '3B', 'K', 'K');
  const third = { t: 'pa', r: 'GO', m: [[3, 4], [0, 0]], x: 1 }, early = { t: 'pa', r: 'GO', m: [[3, 4], [0, 0]] };
  assert.equal(fits(two, third, at(two)), '');
  assert.equal(fits(one, third, at(two)), 'runners', 'not the third out now: the run would count');
  assert.equal(fits(two, early, at(one)), 'runners', 'the third out now: did the run cross before it?');
  assert.equal(fits(play(game(), '3B'), early, at(one)), '', 'still not the third out');
  // A substitution needs its spot in the order.
  assert.equal(fits(S, { t: 'sub', s: 0, slot: 9, i: 1, ty: 'ph' }, at(S)), 'gone');
  // And a play needs a result that could happen now: no triple play once someone's out, no double play with nobody on.
  const on2 = play(game(), '1B', '1B');
  const tp = { t: 'pa', r: 'TP', m: suggest(on2, 'TP') };
  assert.equal(fits(on2, tp, at(on2)), '');
  assert.equal(fits(play(game(), '1B', '1B', { t: 'r', m: [[2, 3, 'SB']] }, 'K'), tp, at(on2)), 'result');
  assert.equal(fits(play(game(), 'HR'), { t: 'pa', r: 'DP', m: [[0, 0], [1, 0]] }, at(play(game(), '1B'))), 'result');
});

test('a box changed after the fact: the plays after it are checked against the game played back with the change', () => {
  const changed = (g, k, e2) => { const g2 = { ...g, ev: g.ev.map((x, i) => (i === k ? e2 : x)) }; return { g2, miss: misfit(g, g2, k) }; };
  // A single that was really a double, with a strikeout after it: the strikeout still fits, the runner staying on
  // second now (in the changed copy; the game itself is left alone).
  let g = game();
  play(g, '1B', 'K', 'K');
  let r = changed(g, 0, { t: 'pa', r: '2B', m: [[0, 2]] });
  assert.equal(r.miss, null);
  assert.deepEqual(r.g2.ev[1].m, [[0, 0], [2, 2]]);
  assert.deepEqual(g.ev[1].m, [[0, 0], [1, 1]], 'the game as scored is untouched');
  assert.deepEqual(replay(r.g2).bases.map(Boolean), [false, false, true, false]);
  // The next batter's single moved the runner from first: with him on second now, it doesn't fit.
  g = game();
  play(g, '1B', '1B', 'K');
  r = changed(g, 0, { t: 'pa', r: '2B', m: [[0, 2]] });
  assert.equal(r.miss.i, 1);
  assert.equal(r.miss.why, 'runners');
  assert.deepEqual(r.miss.now.bases.map(Boolean), [false, false, true, false], 'how the changed game stands then');
  assert.equal(r.miss.was.bases[1].slot, 0, 'and how the game as scored stood');
  // A walk that forced the runner from first to second: with him on second now, he'd stay. Staying put fits only a
  // play where nobody moved.
  g = game();
  play(g, '1B', 'BB');
  assert.equal(changed(g, 0, { t: 'pa', r: '2B', m: [[0, 2]] }).miss.why, 'runners');
  // A different result with the same runners changes nothing after it.
  g = game();
  play(g, '1B', '1B');
  assert.equal(changed(g, 0, { t: 'pa', r: 'BB', m: [[0, 1]] }).miss, null);
  // The third out that wasn't: the next pitch would be in the top of the 1st, not the bottom.
  g = game();
  play(g, 'K', 'K', 'K', P('b'));
  r = changed(g, 2, { t: 'pa', r: 'BB', m: [[0, 1]] });
  assert.deepEqual([r.miss.i, r.miss.why, r.miss.now.half, r.miss.was.half], [3, 'over', 0, 1]);
  // A walk-off that comes sooner: what was played after it comes after the game was over.
  g = game({ innings: 1 });
  play(g, 'K', 'K', 'K', '1B', 'K', '1B');
  r = changed(g, 4, { t: 'pa', r: 'HR', m: [[1, 4], [0, 4]] });
  assert.deepEqual([r.miss.i, r.miss.why, r.miss.now.over, r.miss.was.over], [5, 'over', true, false]);
  // A play that can't happen any more: a sacrifice fly with nobody left on third.
  g = game();
  play(g, '3B', { t: 'pa', r: 'SF', f: [8], m: [[3, 4], [0, 0]] });
  assert.equal(changed(g, 0, { t: 'pa', r: 'HR', m: [[0, 4]] }).miss.why, 'result');
});

test('undoing a starter brought back never takes the starter off the team, even with nobody else listed', () => {
  // The relief pitcher's change was left out by Put back (its half-inning went), and the starter's return wasn't: only
  // the starter is listed. Undo takes back his return, and he stays, his name with him.
  const g = game();
  g.teams[0].pitchers = [{ name: 'Okafor', num: '11' }];
  g.ev.push({ t: 'pch', s: 0, i: 0 });
  const r = takeBack(g);
  assert.equal(r.player, undefined);
  assert.deepEqual(g.teams[0].pitchers.map(p => p.name), ['Okafor']);
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))).teams[0].pitchers.map(p => p.name), ['Okafor']);
  putBack(g, r);
  assert.deepEqual(g.ev.at(-1), { t: 'pch', s: 0, i: 0 });
  // The same for a batter's spot: the starter back in, and undone.
  g.ev.push({ t: 'sub', s: 1, slot: 2, i: 0, ty: 'def' });
  takeBack(g);
  assert.equal(g.teams[1].lineup[2].length, 1);
});

test('a player brought in by a play put back after other changes goes at the end of the list, and the play points at him', () => {
  const g = game();
  g.teams[0].lineup[0].push({ name: 'Kim', num: '' });
  g.ev.push({ t: 'sub', s: 0, slot: 0, i: 1, ty: 'ph' });
  const r = takeBack(g);
  // Meanwhile someone else came in for the same spot.
  g.teams[0].lineup[0].push({ name: 'Lee', num: '' });
  g.ev.push({ t: 'sub', s: 0, slot: 0, i: 1, ty: 'def' });
  assert.deepEqual(putBack(g, r), { t: 'sub', s: 0, slot: 0, i: 2, ty: 'ph' });
  assert.deepEqual(g.teams[0].lineup[0].map(p => p.name || 'Batter 1'), ['Batter 1', 'Lee', 'Kim']);
  assert.equal(r.e.i, 1, 'the record Undo kept is left as it was');
  assert.equal(replay(g).text.at(-1), 'Kim pinch-hits for Lee.');
});

test('a pitcher’s day in words: plurals, and outs below an inning said as outs', () => {
  const st = { np: 1, str: 1, bf: 1, outs: 0, h: 1, r: 1, er: 1, bb: 1, k: 1 };
  assert.equal(pitchDay(st), '1 pitch (1 strike), no outs yet, 1 batter faced, 1 hit, 1 run (earned), 1 walk, 1 strikeout.');
  assert.equal(pitchDay({ ...st, outs: 2, er: 0 }, false), '2 outs, 1 batter faced, 1 hit, 1 run (unearned), 1 walk, 1 strikeout.');
  assert.equal(pitchDay({ ...st, np: 0, str: 0, outs: 3, h: 0, r: 2 }), '0 pitches (0 strikes), 1 inning, 1 batter faced, 0 hits, 2 runs (1 earned), 1 walk, 1 strikeout.');
  assert.match(pitchDay({ ...st, r: 3, er: 3 }), / 3 runs \(all earned\), /);
  assert.match(pitchDay({ ...st, r: 2, er: 0 }), / 2 runs \(none earned\), /);
  assert.match(pitchDay({ ...st, r: 0, er: 0 }), / 0 runs, /);
  const S = replay(sampleGame(7)), w = pitchStat(S, 0, 0);
  assert.equal(pitchDay(w), '106 pitches (69 strikes), 6 innings, 27 batters faced, 5 hits, 4 runs (all earned), 2 walks, 8 strikeouts.');
  assert.match(pitchDay({ ...w, outs: 13 }), / 4 innings and 1 out, /);
  assert.match(pitchDay({ ...w, outs: 5 }), / 1 inning and 2 outs, /);
  // The same words for the list of earlier pitchers.
  assert.equal(pitchWork({ ...w, outs: 2, bf: 4 }), '2 outs, 4 batters faced');
  assert.equal(pitchWork({ ...w, outs: 0, bf: 1 }), 'no outs yet, 1 batter faced');
  assert.deepEqual([pitchCount(1), pitchCount(34)], ['1 pitch', '34 pitches']);
});

test('a batter’s day: each trip in order, and only what isn’t zero', () => {
  const g = game();
  // Batter 1 walks, steals second and third, and scores on a single; then strikes out looking his next time up.
  play(g, 'BB', { t: 'r', m: [[1, 2, 'SB']] }, { t: 'r', m: [[2, 3, 'SB']] }, '1B', 'K', 'K', 'GO 6 3', ...threeK, '2B', 'K', 'K', '1B', 'KL');
  const S = replay(g);
  assert.deepEqual(dayOf(S, 0, 0, 0), {
    trips: [{ inn: 1, r: 'BB', mark: 'BB', words: 'walk' }, { inn: 2, r: 'KL', mark: 'KL', words: 'strikeout looking' }],
    line: '0 for 1, a run, a walk, 2 stolen bases, a strikeout',
  });
  assert.equal(dayOf(S, 0, 1, 0).line, '1 for 1, an RBI');
  assert.deepEqual(dayOf(S, 1, 5, 0), { trips: [], line: '' }, 'not up yet');
});

test('the box score: what each pinch hitter did and who ran for whom, and dashes for someone who hasn’t batted', () => {
  const g = game();
  g.teams[0].lineup[2] = [{ name: 'Brennan', num: '' }, { name: 'Kowalski', num: '' }];
  g.teams[0].lineup[0] = [{ name: 'Ruiz', num: '' }, { name: 'Speedy', num: '' }];
  g.teams[0].lineup[3] = [{ name: 'Castillo', num: '' }, { name: 'Diaz', num: '' }];
  const S = play(g, '1B', { t: 'sub', s: 0, slot: 0, i: 1, ty: 'pr' }, 'K', { t: 'sub', s: 0, slot: 2, i: 1, ty: 'ph' }, '1B',
    { t: 'sub', s: 0, slot: 3, i: 1, ty: 'ph' });
  const box = boxHtml(S);
  assert.match(box, /<b>Pinch hitters:<\/b> Kowalski singled for Brennan in the 1st; Diaz came in to bat for Castillo in the 1st\./);
  assert.match(box, /<b>Pinch runners:<\/b> Speedy ran for Ruiz in the 1st\./);
  assert.match(box, /Diaz<\/th>(<td><span aria-label="none">–<\/span><\/td>){6}<\/tr>/, 'Diaz is up, but hasn’t batted');
  assert.match(box, /Batter 9<\/th>(<td><span aria-label="none">–<\/span><\/td>){6}<\/tr>/);
  assert.match(box, /Kowalski<\/th><td>1<\/td><td>0<\/td><td>1<\/td>/);
});

test('names on the card: the number beside it, the whole name in a title, and a long one cut to the surname', () => {
  const g = game();
  g.teams[0].lineup[0][0] = { name: 'Christopher Montgomery-Ellsworth', num: '10' };
  g.teams[0].lineup[1][0] = { name: 'Freddie Freeman', num: '5' };
  g.teams[0].lineup[2] = [{ name: 'Brennan', num: '' }, { name: 'Speedy Gonzalez-Ramirez', num: '' }];
  const h = cardHtml(play(g, '1B', 'K', { t: 'sub', s: 0, slot: 2, i: 1, ty: 'ph' }), 0);
  assert.match(h, /<span class="names one"><span class="pl" title="Christopher Montgomery-Ellsworth #10">Montgomery-Ellsworth <small>#10<\/small><\/span>/);
  assert.match(h, /title="Freddie Freeman #5">Freddie Freeman <small>#5<\/small>/, 'room for it on two lines');
  assert.match(h, /title="Speedy Gonzalez-Ramirez"><i>PH 1st<\/i> Gonzalez-Ramirez<\/span>/, 'one line under another name');
  assert.equal(cardName({ name: 'Maximiliano Fernandez', num: '' }, 0), 'M.\u00a0Fernandez');
  assert.equal(cardName({ name: 'Christopher Lee', num: '' }, 0, true), 'C.\u00a0Lee');
  assert.equal(cardName({ name: 'Christopher Lee', num: '' }, 0), 'Christopher Lee');
  assert.match(h, /title="Batter 4">Batter 4<\/span>/);
});

test('positions: kept from a pasted lineup, a file and a link, a team from before and Drive, and shown on the card and the box score', () => {
  const { batters } = parsePaste('- Noah (C)\n- Olivia - P\n• Ava\nRuiz UT\nSS M. Betts');
  assert.deepEqual(batters.map(p => p.pos), ['C', 'P', undefined, undefined, 'SS'], 'a utility man has no one place');
  const g = game();
  g.teams[0].lineup[0][0] = { name: 'Ruiz', num: '2', pos: 'SS' };
  g.teams[0].lineup[1][0] = { name: 'Okafor', num: '', pos: 'CF' };
  g.teams[0].lineup[1].push({ name: 'Diaz', num: '4', pos: 'LF' });
  g.teams[0].lineup[2][0] = { name: 'Brennan', num: '24', pos: 'Shortstop' }; // not a position: none
  const S = play(g, '1B', { t: 'sub', s: 0, slot: 1, i: 1, ty: 'ph' }, 'K');
  const card = cardHtml(S, 0);
  assert.match(card, /title="Ruiz SS #2">Ruiz <small>SS #2<\/small>/);
  assert.match(card, /title="Diaz LF #4"><i>PH 1st<\/i> Diaz <small>LF #4<\/small>/);
  assert.match(card, /title="Okafor CF">Okafor <small>CF<\/small>/);
  const box = boxHtml(S);
  assert.match(box, /<span class="ord">1<\/span>Ruiz <small class="ps">SS<\/small><\/th>/);
  assert.match(box, /PH<\/abbr> Diaz <small class="ps">LF<\/small><\/th>/);
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual([c.teams[0].lineup[0][0], c.teams[0].lineup[2][0]], [{ name: 'Ruiz', num: '2', pos: 'SS' }, { name: 'Brennan', num: '24' }]);
  assert.equal(newer(c), false);
  assert.deepEqual(cleanGame(c), c);
  assert.deepEqual(starters(c.teams[0]).slice(0, 3), [{ name: 'Ruiz', num: '2', pos: 'SS' }, { name: 'Okafor', num: '', pos: 'CF' }, { name: 'Brennan', num: '24' }]);
  // Drive: a position changed on the copy changed last comes in, and one taken off there goes.
  const a = cleanGame(JSON.parse(JSON.stringify(c))), b = cleanGame(JSON.parse(JSON.stringify(c)));
  b.teams[0].lineup[0][0].pos = '2B';
  delete b.teams[0].lineup[1][0].pos;
  b.updated = a.updated + 10;
  b.ev.push({ t: 'p', k: 'b' });
  const { game: m } = merge(a, b);
  assert.deepEqual([m.teams[0].lineup[0][0].pos, m.teams[0].lineup[1][0].pos], ['2B', undefined]);
  // Typed or picked: no position is none at all.
  const p = { name: 'Ava', num: '', pos: 'C' };
  setField(p, 'pos', '');
  assert.deepEqual(p, { name: 'Ava', num: '' });
  setField(p, 'pos', 'RF');
  assert.equal(p.pos, 'RF');
});

test('a continuous order: a player who left the game is skipped with no out, and comes back in her spot (Little League 4.04)', () => {
  const g = game();
  g.teams[0].lineup.forEach((slot, i) => { slot[0] = { name: 'V' + (i + 1), num: '' }; });
  // V4 goes home while V2 bats: V3 is followed by V5, with V5 on deck, and no out.
  let S = play(g, 'K', { t: 'gone', s: 0, slot: 3 });
  assert.equal(S.text.at(-1), 'V4 leaves the game, and the order skips the 4th spot.');
  assert.deepEqual([S.outs, S.up[0], now(S).deck], [1, 1, 2]);
  S = play(g, 'K');
  assert.deepEqual([now(S).name, now(S).deckName], ['V3', 'V5']);
  S = play(g, '1B', '1B', '1B', 'K');
  assert.deepEqual(S.cells.map(c => c.slot), [0, 1, 2, 4, 5, 6], 'nobody bats 4th, and her box stays empty');
  // Leaving while she's up: the next one bats. And she comes back: her spot is in the order again.
  S = play(g, ...threeK, { t: 'gone', s: 0, slot: 7 });
  assert.equal(now(S).name, 'V9');
  S = play(g, { t: 'back', s: 0, slot: 3 });
  assert.equal(S.text.at(-1), 'V4 is back in the game, 4th in the order.');
  S = play(g, 'K', 'K', '1B', '1B');
  assert.deepEqual([S.half, now(S).name], [0, 'V4'], 'V9, V1, V2, V3 done; V4 bats again');
  // In the box score.
  assert.match(boxHtml(S), /<b>Left the game:<\/b> V4 \(1st\), V8 \(2nd\)\./);
  assert.match(boxHtml(S), /<b>Back in the game:<\/b> V4 \(2nd\)\./);
  assert.match(cardHtml(S, 0), /V8 <i>left 2nd<\/i>/);
  // One spot always stays; a spot that isn't there, or is skipped already, changes nothing.
  const one = game({ size: 2 });
  S = play(one, { t: 'gone', s: 0, slot: 0 }, { t: 'gone', s: 0, slot: 1 }, { t: 'gone', s: 0, slot: 0 }, { t: 'back', s: 0, slot: 1 });
  assert.deepEqual([...S.gone[0]], [0]);
  assert.deepEqual(S.text.slice(1), ['Batter 2 stays in the order: it’s the last spot left.', 'Batter 1 stays in the order: that spot is skipped already.', 'Batter 2 is in the game already.']);
  // A substitute in her spot puts it back in the order.
  S = play(game(), { t: 'gone', s: 0, slot: 0 }, { t: 'sub', s: 0, slot: 0, i: 0, ty: 'def' });
  assert.equal(S.gone[0].size, 0);
  // Kept from a file and a link; nothing newer.
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))), g);
  assert.equal(newer(g), false);
  assert.deepEqual(cleanGame({ ...g, ev: [{ t: 'gone', s: 0, slot: 30 }] }).ev, [], 'a spot that isn’t there is left out');
});

test('a continuous order in extra innings: the runner put on second is the one before the leadoff man who’s still in the game', () => {
  const g = game({ innings: 1, tie: 2 });
  const S = play(g, { t: 'gone', s: 0, slot: 3 }, 'K', 'K', 'K', ...threeK);
  assert.equal(S.inn, 2);
  assert.equal(S.bases[2].slot, 2, 'Batter 5 leads off: Batter 3 starts on second, not Batter 4, who left');
});

test('a courtesy runner: only the name on the base changes, and the run and the steal are the player’s she ran for', () => {
  const g = game();
  g.teams[0].lineup.forEach((slot, i) => { slot[0] = { name: 'V' + (i + 1), num: '' }; });
  // V1 (the catcher) singles, and Emma, from the bench, runs for her; she steals and scores on V3's single.
  let S = play(g, '1B', { t: 'cr', s: 0, b: 1, name: 'Emma', num: '12' });
  assert.equal(S.text.at(-1), 'Emma runs for V1 on first, a courtesy runner.');
  assert.equal(S.bases[1].slot, 0);
  S = play(g, { t: 'r', m: [[1, 2, 'SB']] }, 'K', { t: 'pa', r: '1B', m: [[0, 1], [2, 4]] });
  assert.equal(S.text.at(-3), 'Emma steals second.');
  assert.equal(S.text.at(-1), 'V3 singles. Emma scores. Foxes take the lead, 1–0.');
  const b = S.bat['0.0.0'];
  assert.deepEqual([b.pa, b.ab, b.h, b.r, b.sb], [1, 1, 1, 1, 1], 'V1’s line stays whole: her hit, her run, her steal');
  assert.equal(S.bat['0.2.0'].rbi, 1, 'the RBI is the batter’s who drove her in');
  assert.deepEqual(S.cells[0].story, ['Emma ran for V1 as a courtesy runner.', 'Stole second.', 'Scored on V3’s single.']);
  // V1 bats again in her own spot, once the order comes round.
  S = play(g, 'K', 'K', ...threeK, 'K', 'K', 'K', ...threeK, 'K');
  assert.equal(now(S).name, 'V1');
  assert.match(boxHtml(S), /<b>Courtesy runners:<\/b> Emma ran for V1 in the 1st\./);
  // From the order: V9, who made the last out, runs for V2; a pinch runner after her takes over the base.
  S = play(g, 'K', '1B', { t: 'cr', s: 0, b: 1, slot: 8 });
  assert.equal(S.text.at(-1), 'V9 runs for V2 on first, a courtesy runner.');
  g.teams[0].lineup[1].push({ name: 'Diaz', num: '' });
  S = play(g, { t: 'sub', s: 0, slot: 1, i: 1, ty: 'pr' }, { t: 'r', m: [[1, 2, 'SB']] });
  assert.equal(S.text.at(-1), 'Diaz steals second.');
  // Nobody on that base: nothing changes. Kept from a file and a link; nothing newer.
  S = play(g, { t: 'cr', s: 0, b: 3, name: 'Zoe', num: '' });
  assert.equal(S.text.at(-1), 'There’s nobody on third to run for.');
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))), g);
  assert.equal(newer(g), false);
  assert.deepEqual(cleanGame({ ...g, ev: [{ t: 'cr', s: 0, b: 1, slot: 30 }] }).ev, [], 'a spot that isn’t there is left out');
});

test('someone else is batting: the order picks up with him, the spots passed over stay empty, and the rest is in the right row', () => {
  const g = game();
  g.teams[0].lineup.forEach((slot, i) => { slot[0] = { name: 'V' + (i + 1), num: '' }; });
  // A trip to the plate was missed: V3 is batting, not V2. The count is his.
  let S = play(g, 'K', P('b'), { t: 'up', s: 0, slot: 2 });
  assert.equal(S.text.at(-1), 'V3 is batting, 3rd in the order.');
  assert.deepEqual([now(S).name, now(S).deckName, S.b], ['V3', 'V4', 1]);
  S = play(g, '1B', '1B');
  assert.deepEqual(S.cells.map(c => [c.slot, c.inn, c.k]), [[0, 1, 0], [2, 1, 0], [3, 1, 0]], 'V2’s box is empty this time round');
  // Back to someone who batted already this inning: his box goes in a new column, as when a team bats around.
  S = play(g, { t: 'up', s: 0, slot: 0 }, 'K');
  assert.deepEqual(S.cells.at(-1), { ...S.cells.at(-1), slot: 0, inn: 1, k: 1 });
  // Who leads off for the other team next; nobody who isn't there; the one up already.
  S = play(g, { t: 'up', s: 1, slot: 4 }, { t: 'up', s: 0, slot: 20 }, { t: 'up', s: 0, slot: 1 });
  assert.deepEqual(S.text.slice(-3), ['Batter 5 leads off for the Comets next.', 'There’s nobody batting 21st in the order.', 'V2 is up already.']);
  S = play(g, 'K');
  assert.equal(now(S).name, 'Batter 5');
  // Kept from a file and a link (one for a spot that isn't there is left out); nothing newer.
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  g.ev = g.ev.filter(e => e.slot !== 20);
  assert.deepEqual(c, g);
  assert.equal(newer(g), false);
});

test('starting partway through: the innings before are dashes and shaded, the runs so far are in the score, and the game goes on from there', () => {
  const g = game({ innings: 6 });
  g.teams[1].lineup.forEach((slot, i) => { slot[0] = { name: 'H' + (i + 1), num: '' }; });
  // Picked up in the bottom of the 3rd, Foxes 4, Comets 2, with the Comets' 6th batter up.
  let S = play(g, { t: 'join', inn: 3, half: 1, r: [4, 2], up: 5 });
  assert.equal(S.text[0], 'Scored from the bottom of the 3rd: Foxes 4, Comets 2.');
  assert.deepEqual([S.inn, S.half, S.R, now(S).name, halfLabel(S)], [3, 1, [4, 2], 'H6', 'Bottom 3rd']);
  S = play(g, 'HR', ...threeK);
  assert.deepEqual([S.R, S.inn, S.half], [[4, 3], 4, 0]);
  assert.deepEqual(lineRow(S, 0).slice(0, 4), ['–', '–', '–', '0']);
  assert.deepEqual(lineRow(S, 1).slice(0, 4), ['–', '–', '1', '']);
  assert.match(lineHtml(S), /<td class="rhe">4<\/td><td class="rhe">0<\/td>/, 'the Foxes’ R is the runs they had');
  const card = cardHtml(S, 1);
  assert.equal((card.match(/class="missed"/g) || []).length, 9 * 2 + 4 * 2, 'two innings of nine batters shaded, and R H E LOB under them');
  assert.match(card, /<td class="tot" colspan="4">3<\/td>/, 'the card’s R is the score');
  assert.match(boxHtml(S), /<p class="joined">Scored from the bottom of the 3rd\. The batting and pitching lines are from then on; the runs before \(Foxes 4, Comets 2\) count in the score\.<\/p>/);
  assert.match(playsHtml(S), /Scored from the bottom of the 3rd: Foxes 4, Comets 2\./);
  // The game ends as it would have: the Comets go ahead in the 6th, and it's over.
  const late = game({ innings: 6 });
  S = play(late, { t: 'join', inn: 6, half: 1, r: [5, 5], up: 0 }, '1B', { t: 'pa', r: '2B', m: [[0, 2], [1, 4]] });
  assert.deepEqual([S.over, S.R, halfLabel(S)], [true, [5, 6], 'Final']);
  // Only a game's first play can say so; a file keeps it; Undo takes it back to the start.
  S = play(game(), 'K', { t: 'join', inn: 5, half: 0, r: [1, 1], up: 0 });
  assert.deepEqual([S.inn, S.R], [1, [0, 0]]);
  assert.deepEqual(cleanGame(JSON.parse(JSON.stringify(g))), g);
  assert.equal(newer(g), false);
  assert.deepEqual(cleanGame({ ...g, ev: [{ t: 'join', inn: 99, half: 1, r: [-3, 'x'], up: 2 }] }).ev, [{ t: 'join', inn: 30, half: 1, r: [0, 0], up: 2 }]);
  const one = game();
  play(one, { t: 'join', inn: 2, half: 0, r: [1, 0], up: 3 });
  takeBack(one);
  assert.deepEqual([replay(one).inn, replay(one).R], [1, [0, 0]]);
});

// The rules lens's hand-scored game (three innings of tricky plays): by hand, Halvorsen gave up 6 runs, 3 earned,
// Bishop none, and Whitlock 7, 4 earned.
function handScored() {
  const g = game({ innings: 3 });
  g.teams[1].pitchers = [{ name: 'Halvorsen', num: '21' }, { name: 'Bishop', num: '37' }];
  g.teams[0].pitchers = [{ name: 'Whitlock', num: '33' }];
  g.ev = [{"t":"p","k":"b"},{"t":"p","k":"b"},{"t":"p","k":"b"},{"t":"p","k":"b"},{"t":"pa","r":"1B","m":[[0,1],[1,3]]},{"t":"pa","r":"SF","m":[[0,0],[3,4],[1,1]],"f":[8]},{"t":"p","k":"b"},{"t":"r","m":[[1,2,"WP"]]},{"t":"pa","r":"GO","m":[[0,0],[2,3]],"f":[6,3]},{"t":"pa","r":"E","m":[[0,1],[3,4]],"f":[6]},{"t":"p","k":"s"},{"t":"p","k":"s"},{"t":"pa","r":"KD","m":[[0,1],[1,2]]},{"t":"pa","r":"2B","m":[[0,2],[2,4],[1,4]]},{"t":"pa","r":"LO","m":[[0,0],[2,2]],"f":[6]},{"t":"pa","r":"1B","m":[[0,1]]},{"t":"r","m":[[1,2,"SB"]]},{"t":"pa","r":"BB","m":[[0,1],[2,2]]},{"t":"r","m":[[2,3,"SB"]]},{"t":"r","m":[[1,2,"SB"]]},{"t":"pa","r":"GO","m":[[0,0],[3,3],[2,2]],"f":[6,3]},{"t":"pa","r":"IBB","m":[[0,1],[3,3],[2,2]]},{"t":"pa","r":"DP","f":[4,6,3],"m":[[0,0],[3,3],[2,2],[1,0]],"x":1},{"t":"pa","r":"HBP","m":[[0,1]]},{"t":"pa","r":"1B","m":[[0,1],[1,2]]},{"t":"pch","s":1,"i":1},{"t":"pa","r":"FC","m":[[0,1],[2,0],[1,2]],"f":[5]},{"t":"r","m":[[2,3,"BK"],[1,2,"BK"]]},{"t":"pa","r":"1B","m":[[0,1],[3,4],[2,4]]},{"t":"r","m":[[1,0,"PO",[1,3]]]},{"t":"p","k":"s"},{"t":"p","k":"s"},{"t":"p","k":"s"},{"t":"pa","r":"2B","m":[[0,2]]},{"t":"pa","r":"1B","m":[[0,2],[2,0,"@4"]]},{"t":"pa","r":"E","m":[[0,1],[2,3]],"f":[5]},{"t":"pa","r":"SF","m":[[0,0],[3,4],[1,1]],"f":[9]},{"t":"pa","r":"HR","m":[[0,4],[1,4]]},{"t":"pa","r":"PU","m":[[0,0]],"f":[4]},{"t":"pa","r":"K","m":[[0,0]]},{"t":"pa","r":"K","m":[[0,0]]},{"t":"pa","r":"KL","m":[[0,0]]},{"t":"pa","r":"BB","m":[[0,1]]},{"t":"pa","r":"1B","m":[[0,1],[1,3]]},{"t":"pa","r":"2B","m":[[0,2],[3,4],[1,3]]},{"t":"pa","r":"BB","m":[[0,1],[3,3],[2,2]]},{"t":"pa","r":"1B","m":[[0,1],[3,4],[2,4],[1,3]]},{"t":"pa","r":"3B","m":[[0,3],[3,4],[1,4]]}];
  return g;
}

test('earned runs: the hand-scored game, each pitcher’s, as a scorer works them out (OBR 9.16)', () => {
  const S = replay(handScored());
  assert.deepEqual([S.R, halfLabel(S)], [[6, 7], 'Final']);
  const line = (s, i) => [S.pitching[s][i].r, S.pitching[s][i].er];
  assert.deepEqual([line(1, 0), line(1, 1), line(0, 0)], [[6, 3], [0, 0], [7, 4]]);
  // In the box score, beside the runs; and in the pitcher's day.
  assert.match(boxHtml(S), /<th scope="row">Halvorsen<\/th><td>1<\/td><td>3<\/td><td>6<\/td><td>3<\/td>/, 'IP H R ER');
  assert.match(pitchDay(S.pitching[1][0]), / 6 runs \(3 earned\), /);
});

test('earned runs: an error that would have been the third out, a passed ball, an error on the bases, and a reliever (OBR 9.16)', () => {
  const er = (g, s = 1, i = 0) => { const S = replay(g); return [S.pitching[s][i].r, S.pitching[s][i].er]; };
  // Two out, an error that would have ended it, then a home run: neither run is earned.
  let g = game();
  play(g, 'K', 'K', 'E 6', 'HR', 'K');
  assert.deepEqual(er(g), [2, 0]);
  // Without the error (a single), both are.
  g = game();
  play(g, 'K', 'K', '1B', 'HR', 'K');
  assert.deepEqual(er(g), [2, 2]);
  // A single, a passed ball to second, a single that scores him, and three fly outs: from first, the single would have
  // taken him to third, where he'd have been left. Unearned. With a wild pitch instead, earned.
  for (const [how, want] of [['PB', [1, 0]], ['WP', [1, 1]]]) {
    g = game();
    play(g, '1B', { t: 'r', m: [[1, 2, how]] }, { t: 'pa', r: '1B', m: [[0, 1], [2, 4]] }, 'FO 8', 'FO 8', 'FO 8');
    assert.deepEqual(er(g), want, how);
  }
  // On a single he went first to third on the right fielder's error, and scored on a sacrifice fly: he'd have been on
  // second, and stayed there. On the throw instead: earned.
  for (const [how, want] of [[['E', [9]], [1, 0]], [['T'], [1, 1]]]) {
    g = game();
    play(g, '1B', { t: 'pa', r: '1B', m: [[0, 1], [1, 3, ...how]] }, { t: 'pa', r: 'SF', f: [8], m: [[0, 0], [3, 4], [1, 1]] }, 'K', 'K');
    assert.deepEqual(er(g), want, how[0]);
  }
  // A reliever doesn't get the outs the fielders missed before him (9.16(i)): one out, an error that would have been the
  // second, a ground out (the third, without the error), and a new pitcher gives up a home run. The runner who reached
  // on the error is the first pitcher's, unearned; the batter's run is the reliever's, earned, though for the team it
  // isn't.
  g = game();
  g.teams[1].pitchers.push({ name: 'Relief', num: '' });
  play(g, 'K', 'E 6', { t: 'pa', r: 'GO', f: [4, 3], m: [[0, 0], [1, 2]] }, { t: 'pch', s: 1, i: 1 }, 'HR', 'K');
  assert.deepEqual([er(g, 1, 0), er(g, 1, 1)], [[1, 0], [1, 1]]);
  // The runner put on second to start an extra inning scores: unearned.
  g = game({ innings: 1, tie: 2 });
  play(g, ...threeK, ...threeK, '2B');
  assert.deepEqual(er(g), [1, 0]);
});

test('the win, the loss and the save (OBR 9.17, 9.19): beside the names in the box score, and said in the plays', async () => {
  const { decisions, decisionWords } = await import('../js/engine.js');
  const names = (S, d = decisions(S)) => d && [d.w, d.l, d.s];
  // The sample: Halvorsen pitched six for the Comets, who went ahead in the 5th for good; Bishop came in two up and
  // pitched three.
  let S = replay(sampleGame(7));
  assert.deepEqual(names(S), [0, 0, 1]);
  assert.equal(decisionWords(S), 'Halvorsen gets the win, Whitlock the loss, and Bishop the save.');
  const box = boxHtml(S);
  assert.match(box, /Halvorsen <abbr class="dec" title="Winning pitcher">W<\/abbr><\/th>/);
  assert.match(box, /Whitlock <abbr class="dec" title="Losing pitcher">L<\/abbr><\/th>/);
  assert.match(box, /Bishop <abbr class="dec" title="Save">S<\/abbr><\/th>/);
  assert.match(playsHtml(S), /<p class="decided">Halvorsen gets the win, Whitlock the loss, and Bishop the save\.<\/p>$/);
  assert.match(playsHtml(S, { limit: 5 }), /^<p class="decider">[^<]+<\/p><p class="decided">/, 'newest first: before the last plays');
  // Not until there's a winner.
  const g = game({ innings: 3 });
  g.teams[0].pitchers.push({ name: 'Relief', num: '' });
  g.teams[1].pitchers.push({ name: 'Closer', num: '' });
  S = play(g, 'HR', 'K', 'K', 'K');
  assert.equal(decisions(S), null);
  assert.equal(playsHtml(S).includes('decided'), false);
  // The lead changes hands: the Comets go ahead 2-1 off the starter in the 1st, and the Foxes' reliever, in the game
  // since the 2nd, is the pitcher of record when the Foxes go ahead 3-2 for good in the 3rd, off the Comets' starter.
  // The Foxes' reliever finished it, but he's the winner: no save.
  S = play(g, 'HR', 'HR', ...threeK, { t: 'pch', s: 0, i: 1 }, ...threeK, ...threeK, '1B', 'HR', 'K', 'K', 'K', { t: 'pch', s: 1, i: 1 }, ...threeK);
  assert.deepEqual([S.R, S.over], [[3, 2], true]);
  assert.equal(decisionWords(S), 'Relief gets the win, Pitcher the loss.', 'the Foxes finished with Relief, who won it');
});

test('the play that won it, at the final: the one that put the winners ahead for good, or ended the game', async () => {
  const { decider } = await import('../js/engine.js');
  // The sample: the Comets went ahead for good on Quinn's home run in the 5th.
  let S = replay(sampleGame(7));
  assert.equal(decider(S), 'Quinn’s two-run home run in the bottom of the 5th put the Comets ahead for good.');
  assert.match(playsHtml(S), /<p class="decider">Quinn’s two-run home run in the bottom of the 5th put the Comets ahead for good\.<\/p><p class="decided">/);
  // Nothing while it goes on, nor for a tie.
  const g = game({ innings: 2 });
  S = play(g, 'HR', ...threeK, ...threeK, ...threeK);
  assert.deepEqual([S.over, decider(S)], [false, '']);
  // The home team ahead in the last inning: the play it ended on.
  const walk = (...evs) => decider(play(game({ innings: 1 }), ...threeK, ...evs));
  assert.equal(walk('2B', { t: 'pa', r: '1B', m: [[0, 1], [2, 4]] }), 'Batter 2’s single wins it in the bottom of the 1st.');
  assert.equal(walk('1B', '1B', '1B', 'HR'), 'Batter 4’s grand slam wins it in the bottom of the 1st.');
  assert.equal(walk('3B', { t: 'r', m: [[3, 4, 'SB']] }), 'Batter 1’s steal of home wins it in the bottom of the 1st.');
  assert.equal(walk('3B', { t: 'r', m: [[3, 4, 'WP']] }), 'A wild pitch wins it in the bottom of the 1st.');
  assert.equal(walk('3B', { t: 'pa', r: 'E', f: [6], m: [[0, 1], [3, 4]] }), 'Batter 2 reaching on an error wins it in the bottom of the 1st.');
  assert.equal(walk('3B', 'BB', 'BB', 'HBP'), 'Batter 4 being hit by a pitch wins it in the bottom of the 1st.');
  // Ahead earlier, and the lead held: when it was taken, and by whom. A lead lost and taken again is the later one.
  S = play(game({ innings: 2 }), 'HR', ...threeK, 'HR', 'HR', ...threeK, '1B', 'HR', ...threeK, ...threeK);
  assert.deepEqual([S.over, S.R], [true, [3, 2]]);
  assert.equal(decider(S), 'Batter 6’s two-run home run in the top of the 2nd put the Foxes ahead for good.');
  // A game called before it counted has no winner, and one picked up with the winners ahead doesn't know the play.
  assert.equal(decider(play(game(), 'HR', { t: 'end' })), '');
  assert.equal(decider(play(game({ innings: 1 }), { t: 'join', inn: 1, half: 1, r: [0, 2], up: 0 }, ...threeK)), '');
});

test('what the game is remembered for, said only once it’s over: a no-hitter, a perfect game, the cycle, four hits, nine pitches', async () => {
  const { milestones } = await import('../js/engine.js');
  const { summary } = await import('../js/share.js');
  const feats = S => milestones(S).map(m => `${m.side}: ${m.text}`);
  const named = g => { g.teams[0].pitchers[0].name = 'Whitlock'; g.teams[1].pitchers[0].name = 'Halvorsen'; g.teams[1].pitchers.push({ name: 'Moreno', num: '' }); return g; };
  // A perfect game: nobody on, every out, every inning. Not a word while it's going.
  let g = named(game({ innings: 2 })), S = play(g, ...threeK, ...threeK, ...threeK);
  assert.deepEqual([S.over, feats(S)], [false, []]);
  S = play(g, P('b'), P('b'), P('b'), P('b'), { t: 'r', m: [[1, 2, 'WP']] }, { t: 'r', m: [[2, 3, 'WP']] }, { t: 'r', m: [[3, 4, 'WP']] });
  // (The Comets won it without a hit, but their pitcher got only the outs of one inning: no no-hitter for the Foxes.)
  assert.deepEqual([S.over, feats(S)], [true, ['1: Halvorsen throws a perfect game.']]);
  // A walk: a no-hitter. Two pitchers: they combine on it.
  g = named(game({ innings: 1 }));
  S = play(g, 'BB', 'K', { t: 'pch', s: 1, i: 1 }, 'K', 'K', 'HR');
  assert.deepEqual(feats(S), ['1: Halvorsen and Moreno combine on a no-hitter.']);
  assert.match(summary(g), /\nHalvorsen and Moreno combine on a no-hitter\.$/, 'in the score as text');
  // First in that team's notes under the box score, and on the final card (see e2e).
  const notes = side => boxHtml(S).split('<div class="extras">')[side + 1].split('</div>')[0];
  assert.match(notes(1), /^<p class="feat">Halvorsen and Moreno combine on a no-hitter\.<\/p><p><b>/);
  assert.doesNotMatch(notes(0), /class="feat"/);
  // The cycle, and a perfect game by the other side; four hits without the cycle; and the side struck out on nine
  // pitches, every one a strike.
  g = named(game({ innings: 1, size: 1 }));
  S = play(g, '3B', '1B', 'HR', '2B', 'K', 'K', 'K', ...threeK);
  assert.deepEqual(feats(S), ['0: Whitlock throws a perfect game.', '0: Batter 1 hits for the cycle.']);
  g = named(game({ innings: 1, size: 1 }));
  S = play(g, '1B', '1B', 'HR', '2B', ...threeK, P('c'), P('f'), P('s'), P('s'), P('s'), P('c'), P('c'), P('s'), P('c'));
  assert.deepEqual(feats(S), ['0: Whitlock throws a perfect game.', '0: Whitlock strikes out the side on nine pitches in the 1st.', '0: Batter 1 goes 4 for 7.']);
  // A ball among them, or a foul with two strikes, is more than nine pitches, or not all strikes.
  g = named(game({ innings: 1, size: 1 }));
  S = play(g, 'HR', 'K', 'K', 'K', P('b'), P('c'), P('c'), P('c'), P('c'), P('c'), P('c'), P('c'), P('c'), P('c'));
  assert.deepEqual(feats(S), ['0: Whitlock throws a perfect game.']);
  // Called before it counted, or picked up partway through: nothing.
  assert.deepEqual(feats(play(named(game({ innings: 1 })), ...threeK, { t: 'end' })), []);
  assert.deepEqual(feats(play(named(game({ innings: 1 })), { t: 'join', inn: 1, half: 0, r: [0, 0], up: 0 }, 'HR', ...threeK, ...threeK)), []);
});

test('a finished game in short, for the Score tab: the line score, its best lines, and who won only where nothing else says it', async () => {
  const { recapHtml } = await import('../js/box.js');
  const S = replay(sampleGame(7)), text = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const look = recapHtml(S, { head: 'Comets win, 7–1' }), mine = recapHtml(S, { told: false });
  assert.match(look, /<h2>Comets win, 7–1<\/h2>/);
  assert.match(look, /<table class="linescore">/);
  assert.match(look, /<p class="decider">Quinn’s two-run home run in the bottom of the 5th put the Comets ahead for good\.<\/p>/);
  assert.deepEqual([...look.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map(([, t, d]) => `${t}: ${text(d)}`), [
    'Home runs: Ibarra, Quinn, Nakamura (Comets)', 'Two hits or more: Pruitt 3 for 4, Brennan 2 for 4 (Foxes); Velez 2 for 4 (Comets)',
    'Foxes pitching: Whitlock L: 6 IP, 5 H, 4 R, 4 ER, 2 BB, 8 K, 106 pitches; Moreno: 2 IP, 1 H, 3 R, 3 ER, 5 BB, 2 K, 51 pitches',
    'Comets pitching: Halvorsen W: 6 IP, 5 H, 1 R, 1 ER, 2 BB, 5 K, 97 pitches; Bishop S: 3 IP, 3 H, 0 R, 0 ER, 2 BB, 5 K, 53 pitches',
  ]);
  // Under the final card, which says who won and the play that won it, it doesn't say them again.
  assert.doesNotMatch(mine, /<h2>|decider/);
  assert.match(mine, /Bishop <abbr class="dec" title="Save">S<\/abbr>: 3 <abbr title="Innings pitched">IP<\/abbr>/);
});

test('the win: a starter needs five innings; a reliever who pitched briefly and badly gives way to the one after him (OBR 9.17)', async () => {
  const { decisions } = await import('../js/engine.js');
  // Seven innings: the Foxes' starter goes 3 with a 1-0 lead, two relievers finish (the second with more outs): the
  // win is the most effective reliever's.
  let g = game({ innings: 7 });
  g.teams[0].pitchers.push({ name: 'Two', num: '' }, { name: 'Three', num: '' });
  const K9 = Array(9).fill('K'), K6 = Array(6).fill('K');
  play(g, 'HR', 'K', 'K', 'K', ...threeK, ...K6, ...K6, { t: 'pch', s: 0, i: 1 }, ...K6, ...threeK, { t: 'pch', s: 0, i: 2 }, ...K9, ...K6);
  let S = replay(g);
  assert.deepEqual([S.R, S.over, S.pitching[0].map(p => p.outs)], [[1, 0], true, [9, 3, 9]]);
  assert.equal(decisions(S).w, 2);
  // Three innings, so no five-inning rule: the Comets' reliever, in with one out in the 2nd, is the pitcher of record
  // when they go ahead 4-0, but he gives up three home runs in a row in the 3rd, two outs in all; the one after him
  // gets the last three outs, and the win (and so no save).
  g = game({ innings: 3 });
  g.teams[1].pitchers.push({ name: 'Wild', num: '' }, { name: 'Steady', num: '' });
  play(g, ...threeK, ...threeK, 'K', { t: 'pch', s: 1, i: 1 }, 'K', 'K', '1B', '1B', '1B', 'HR', 'K', 'K', 'K', 'HR', 'HR', 'HR', { t: 'pch', s: 1, i: 2 }, 'K', 'K', 'K');
  S = replay(g);
  assert.deepEqual([S.R, S.over, S.pitching[1].map(p => [p.outs, p.er])], [[3, 4], true, [[4, 0], [2, 3], [3, 0]]]);
  assert.deepEqual([decisions(S).w, decisions(S).s], [2, null]);
  // A game picked up with the home team already ahead, who stay ahead: whoever pitched before is unknown, so nobody.
  g = game({ innings: 2 });
  play(g, { t: 'join', inn: 2, half: 0, r: [0, 3], up: 0 }, ...threeK);
  S = replay(g);
  assert.deepEqual([S.over, decisions(S)], [true, null]);
});

// ---------- season stats (stats.js) ----------
const ST = await import('../js/stats.js');
// A short game for a season: the teams' names, their batters (a name, or [name, number]), and the plays.
function seasonGame({ date, away = 'Foxes', home = 'Comets', bats = [[], []], arms = [[], []], innings = 1, ...opts }, ...evs) {
  const g = game({ innings, ...opts });
  g.id = 'g' + date.replace(/-/g, '') + away.slice(0, 3) + home.slice(0, 3);
  g.date = date;
  g.teams[0].name = away; g.teams[1].name = home;
  bats.forEach((list, s) => { if (list.length) g.teams[s].lineup = list.map(b => [Array.isArray(b) ? { name: b[0], num: b[1] } : { name: b, num: '' }]); });
  arms.forEach((list, s) => { if (list.length) g.teams[s].pitchers = list.map(name => ({ name, num: '' })); });
  play(g, ...evs);
  return g;
}
const FOX = ['Ruiz', 'Okafor', ['Brennan', '24']];
// Two 2026 games for the Foxes (one at home, its name written another way), and one from 2025.
const seasonGames = () => [
  // A 3-0 win: Ruiz doubles and scores, Okafor walks and scores, Brennan homers; then three strikeouts each way.
  seasonGame({ date: '2026-05-02', bats: [FOX, []], arms: [['Whitlock'], ['Halvorsen']] }, '2B', 'BB', 'HR', 'K', 'K', 'K', ...threeK),
  // A 1-0 walk-off at home, as "foxes ": Ruiz (RUIZ) triples, Okafor's sacrifice fly brings him in. Brennan is #24.
  seasonGame({ date: '2026-05-09', away: 'Bears', home: 'foxes ', bats: [[], ['RUIZ', 'Okafor', ['', '24']]], arms: [['Bishop'], ['whitlock']], pitches: false }, ...threeK, '3B', 'SF'),
  seasonGame({ date: '2025-06-01', bats: [FOX, []], arms: [['Whitlock'], []] }, '1B', 'K', 'K', 'K', ...threeK),
];

test('a season: each player’s games added up, matched by name (any case) or number, with the rates as OBR 9.21 has them', () => {
  const T = ST.season(seasonGames(), 'Foxes');
  assert.deepEqual([T.name, T.yr, T.years, T.record, T.games.map(x => [x.date, x.opp, x.home, x.result, x.R, x.RA])],
    ['Foxes', '2026', ['2026', '2025'], { w: 2, l: 0, t: 0 }, [['2026-05-09', 'Bears', true, 'W', 1, 0], ['2026-05-02', 'Comets', false, 'W', 3, 0]]]);
  const by = k => T.bat.find(x => x.key === k);
  assert.deepEqual(T.bat.map(x => x.name), ['RUIZ', 'Okafor', 'Brennan'], 'in the order they bat, with the name as it was written most (a tie: last)');
  const r = by('ruiz').bat, o = by('okafor').bat, b = by('brennan').bat;
  assert.deepEqual([r.g, r.pa, r.ab, r.h, r.d, r.t, r.r, r.k], [2, 3, 3, 2, 1, 1, 2, 1]);
  assert.deepEqual([ST.three(ST.avg(r)), ST.three(ST.obp(r)), ST.three(ST.slg(r)), ST.three(ST.ops(r))], ['.667', '.667', '1.667', '2.333']);
  // On base counts the sacrifice fly against him, and the walk for him: 1 of 3 (9.21(f)).
  assert.deepEqual([o.g, o.pa, o.ab, o.bb, o.sf, o.rbi, ST.three(ST.avg(o)), ST.three(ST.obp(o)), ST.three(ST.ops(o))], [2, 3, 1, 1, 1, 1, '.000', '.333', '.333']);
  // #24 one week is Brennan #24 the other: one player.
  assert.deepEqual([b.g, b.pa, b.ab, b.h, b.hr, b.rbi, by('brennan').num], [2, 2, 2, 1, 1, 3, '24']);
  assert.equal(T.bat.some(x => x.key === '#24'), false);
  assert.deepEqual([T.tot.bat.g, T.tot.bat.pa, T.tot.bat.r, T.tot.bat.h], [2, 8, 4, 3]);
  // Pitching: the win in both, and the pitches only from the game that counted them.
  const w = T.pit.find(x => x.key === 'whitlock').pit;
  assert.deepEqual([w.g, w.w, w.l, w.s, ST.ip(w.outs), w.k, w.er, ST.two(ST.era(w)), w.np, w.pg], [2, 2, 0, 0, '2', 6, 0, '0.00', 3, 1]);
  // Another year, and every year together.
  const old = ST.season(seasonGames(), 'FOXES', '2025');
  assert.deepEqual([old.yr, old.games.length, old.bat.find(x => x.key === 'ruiz').bat.h], ['2025', 1, 1]);
  const all = ST.season(seasonGames(), 'Foxes', 'all');
  assert.deepEqual([all.yr, all.games.length, all.bat.find(x => x.key === 'ruiz').bat.h, all.record.w], ['all', 3, 3, 2]);
  // A year with no games is the latest one; a team with no games has none.
  assert.equal(ST.season(seasonGames(), 'Foxes', '2019').yr, '2026');
  assert.deepEqual(ST.season(seasonGames(), 'Owls').games, []);
});

test('a season: a loss, a game still going, earned runs, the loss and the save, and the rest a pitch limit asks for', () => {
  const L = { by: 'll', age: '11-12', max: 85 };
  // The Foxes lose 0-1 (Ruiz fouls off 20 before striking out: 21 pitches, a day of rest), and a game is going on.
  const lost = seasonGame({ date: '2026-05-16', bats: [FOX, []], arms: [['Halvorsen'], ['Whitlock']], limit: L }, ...Array(20).fill(P('f')), 'K', 'K', 'K', 'HR', 'K', 'K', 'K');
  const going = seasonGame({ date: '2026-05-17', bats: [FOX, []], arms: [['Halvorsen'], ['Whitlock']] }, '1B');
  const T = ST.season([lost, going], 'Comets');
  assert.deepEqual([T.record, T.games.map(x => x.result || x.status)], [{ w: 1, l: 0, t: 0 }, ['Top 1st', 'W']]);
  const F = ST.season([lost, going], 'Foxes');
  assert.deepEqual(F.record, { w: 0, l: 1, t: 0 });
  const h = F.pit.find(x => x.key === 'halvorsen');
  // (He hasn't pitched yet in the game going on: one game. A run in an inning is an ERA of 9.00; 4 pitches, no rest.)
  assert.deepEqual([h.pit.g, h.pit.l, h.pit.r, h.pit.er, ST.two(ST.era(h.pit)), h.arms[0].rest], [1, 1, 1, 1, '9.00', 0]);
  // Under Little League's limit, 21 pitches is a day of rest: he can pitch again the day after next.
  const w = T.pit.find(x => x.key === 'whitlock');
  assert.deepEqual([w.pit.np, w.pit.w, w.arms[0].rest, w.arms[0].ready, w.arms[1].rest], [24, 1, 1, '2026-05-18', null]);
  assert.deepEqual(ST.thisWeek(T, '2026-05-17').map(x => [x.x.name, x.arms.length, x.ready]), [['Whitlock', 2, '2026-05-18']]);
  assert.deepEqual(ST.thisWeek(T, '2026-05-30'), [], 'nobody pitched in the last 7 days');
});

test('a season: a tie that counts is in the record; a game called before it counted isn’t', () => {
  // 0-0 after two innings, over on the time limit; and one rained out in the 1st of six.
  const tie = seasonGame({ date: '2026-05-23', innings: 2 }, ...threeK, ...threeK, ...threeK, ...threeK, { t: 'end', why: 'time' });
  const rain = seasonGame({ date: '2026-05-24', innings: 6 }, ...threeK, { t: 'end' });
  const T = ST.season([tie, rain], 'Foxes');
  assert.deepEqual([T.record, T.games.map(x => x.result || x.status)], [{ w: 0, l: 0, t: 1 }, ['Called', 'T']]);
});

test('a season: a courtesy runner’s run and steal are the player’s she ran for, and she has no line of her own', () => {
  const g = seasonGame({ date: '2026-05-23', bats: [FOX, []] }, '1B', { t: 'cr', s: 0, b: 1, name: 'Speedy', num: '' }, { t: 'r', m: [[1, 2, 'SB']] }, '2B', 'K', 'K', 'K', ...threeK);
  const T = ST.season([g], 'Foxes'), r = T.bat.find(x => x.key === 'ruiz');
  assert.deepEqual([r.bat.r, r.bat.sb, r.bat.h], [1, 1, 1]);
  assert.equal(T.bat.some(x => x.key === 'speedy'), false);
  assert.equal(T.bat.find(x => x.key === 'okafor').bat.rbi, 1);
});

test('a season: players with no name are added up in one row; each game is played back once until it changes', () => {
  const g = seasonGame({ date: '2026-05-30', bats: [['Ruiz', '', ''], []] }, '1B', 'BB', 'K', 'K', 'K', ...threeK);
  const T = ST.season([g], 'Foxes'), none = T.bat.find(x => !x.key);
  assert.deepEqual([none.name, none.bat.pa, none.bat.bb, none.bat.g], ['', 3, 1, 1]);
  const a = ST.gameLines(g);
  assert.equal(ST.gameLines(g), a, 'kept');
  g.ev.push({ t: 'p', k: 'b' }); g.updated++;
  assert.notEqual(ST.gameLines(g), a, 'played back again once it changed');
});

test('a season: a game set up ahead, with nothing scored yet, isn’t in it, though its lineup is there to pick from', () => {
  // Next Saturday's game, its lineups typed in tonight: no game played, no game for Ruiz, and not the last one.
  const ahead = seasonGame({ date: '2026-05-16', bats: [[...FOX, 'Quinn'], []], arms: [['Whitlock'], []] });
  const games = [...seasonGames(), ahead], T = ST.season(games, 'Foxes'), r = T.bat.find(x => x.key === 'ruiz');
  assert.deepEqual([T.games.length, T.tot.bat.g, r.bat.g, r.days.at(-1).game.date], [2, 2, 2, '2026-05-09']);
  assert.match(ST.seasonText(T, r), /\nLast game, .+ vs Bears: 1 for 1, a triple, a run\.$/);
  assert.equal(T.bat.some(x => x.key === 'quinn'), false);
  assert.deepEqual(ST.teamList([ahead]), [], 'nor a team on the home screen');
  // (A pinch hitter later this season can still be picked from it.)
  const later = seasonGame({ date: '2026-05-23', bats: [FOX, []] });
  assert.ok(ST.earlier(games, later, 0).some(x => x.name === 'Quinn'));
});

test('a season: a doubleheader’s games in the order they were scored, and a last game he didn’t bat in says so', () => {
  // (The second game's id comes first, as one Drive kept as a second copy might.)
  const one = seasonGame({ date: '2026-06-06', bats: [FOX, []] }, '1B', 'K', 'K', 'K', ...threeK), two = seasonGame({ date: '2026-06-06', bats: [FOX, []] }, 'K', 'K', 'K', ...threeK);
  Object.assign(one, { id: 'gz', created: 100 }); Object.assign(two, { id: 'ga', created: 200 });
  let T = ST.season([two, one], 'Foxes'), r = T.bat.find(x => x.key === 'ruiz');
  assert.deepEqual([T.games.map(x => x.id), r.days.map(d => d.game.id)], [['ga', 'gz'], ['gz', 'ga']]);
  assert.match(ST.seasonText(T, r), /\nLast game, .+: 0 for 1, a strikeout\.$/);
  // Quinn, fourth in a one-inning game that's gone to extras, hasn't batted yet.
  const going = seasonGame({ date: '2026-06-13', bats: [[...FOX, 'Quinn'], []] }, ...threeK, ...threeK);
  T = ST.season([one, going], 'Foxes');
  assert.match(ST.seasonText(T, T.bat.find(x => x.key === 'quinn')), /\nLast game, .+ at Comets: didn’t bat\.$/);
});

test('the teams on the home screen, and players from earlier games for the substitution sheets', () => {
  const games = seasonGames();
  games.push(seasonGame({ date: '2026-05-30', away: '', home: 'Comets' }, ...threeK));
  assert.deepEqual(ST.teamList(games).map(t => [t.name, t.year, t.n]), [['Comets', '2026', 2], ['Foxes', '2026', 2], ['Bears', '2026', 1]], 'a team with no name isn’t one');
  // Today's Foxes have Ruiz: earlier this year there were Okafor (twice) and Brennan #24 (once as #24): not last year's.
  const today = seasonGame({ date: '2026-06-06', bats: [['Ruiz', 'Han'], []], arms: [['Pruitt'], []] });
  assert.deepEqual(ST.earlier(games, today, 0), [{ name: 'Okafor', num: '' }, { name: 'Brennan', num: '24' }]);
  // (Written Whitlock once and whitlock once: as the latest game has it, as on his page.)
  assert.deepEqual(ST.earlier(games, today, 0, { pitchers: true }), [{ name: 'whitlock', num: '' }]);
  assert.deepEqual(ST.earlier(games, { ...today, date: '2027-04-01' }, 0), [], 'a new season starts with nobody');
});

test('the score as text carries the score: the line score in threes, home runs by team, and the outs in a game going on', async () => {
  const { summary, shareText, lineText } = await import('../js/share.js');
  const { fmtDate } = await import('../js/ui.js');
  const g = sampleGame(7), day = fmtDate(g.date);
  assert.equal(summary(g, 'https://backwards-k.junkdrawer.works/#s=c1'), [
    'Comets 7, Foxes 1 (Final)', `${day} · Riverside Park`, '',
    'Foxes  000 010 000 — 1 8 1', 'Comets 000 120 13x — 7 6 1', '',
    'Foxes: 1 run, 8 hits, 1 error', 'Comets: 7 runs, 6 hits, 1 error', 'Home runs: Ibarra, Quinn, Nakamura (Comets)', '',
    'The whole scorecard: https://backwards-k.junkdrawer.works/#s=c1',
  ].join('\n'));
  // What the phone's share sheet sends with the link: the score, not only who played.
  assert.equal(shareText(g), `Comets 7, Foxes 1 (Final) · ${day}`);
  assert.equal(shareText({ ...g, ev: [] }), `Foxes at Comets · ${day}`);
  // A game going on: the outs, and only the innings played.
  let cut = 0;
  while (!(replay({ ...g, ev: g.ev.slice(0, cut) }).inn === 7 && replay({ ...g, ev: g.ev.slice(0, cut) }).outs === 1)) cut++;
  const live = { ...g, ev: g.ev.slice(0, cut) };
  assert.equal(shareText(live), `Comets 3, Foxes 1 (Top 7th, 1 out) · ${day}`);
  assert.match(summary(live), /\n\nFoxes  000 010 0 — 1 6 1\nComets 000 120 — 3 5 1\n\n/);
  assert.match(summary({ ...g, ev: g.ev.slice(0, 0) }), /^Foxes at Comets\n/);
  // Home runs by team; ten runs or more in an inning in brackets, extra innings a fourth group, and innings before
  // the game was picked up a dash.
  const h = game({ innings: 1 });
  play(h, ...Array(11).fill('HR'), ...threeK, 'HR', ...threeK);
  assert.deepEqual(lineText(replay(h)), ['Foxes  (11) — 11 11 0', 'Comets 1 — 1 1 0']);
  assert.match(summary(h), /\nHome runs: Batter 1 2, Batter 2 2, Batter 3, Batter 4, Batter 5, Batter 6, Batter 7, Batter 8, Batter 9 \(Foxes\); Batter 1 \(Comets\)$/);
  const x = game();
  play(x, ...Array(54).fill('K'), 'HR', ...threeK, ...threeK);
  assert.deepEqual([replay(x).over, lineText(replay(x))], [true, ['Foxes  000 000 000 1 — 1 1 0', 'Comets 000 000 000 0 — 0 0 0']]);
  const j = game({ innings: 4 });
  play(j, { t: 'join', inn: 3, half: 1, r: [2, 1], up: 0 }, ...threeK);
  assert.deepEqual(lineText(replay(j)), ['Foxes  ––– 0 — 2 0 0', 'Comets ––0 — 1 0 0']);
});

test('the box score as a spreadsheet: the line score, and each player’s batting and pitching line, as a season’s columns', async () => {
  const { boxCsv } = await import('../js/share.js');
  const g = sampleGame(7), rows = boxCsv(g).split('\r\n');
  assert.equal(rows[0], `\ufeffFoxes at Comets,${g.date},Riverside Park`, 'UTF-8, with the mark Excel looks for');
  assert.deepEqual(rows.slice(1, 7), ['"Comets 7, Foxes 1 (Final)"', '', 'Line score', 'Team,1,2,3,4,5,6,7,8,9,R,H,E', 'Foxes,0,0,0,0,1,0,0,0,0,1,8,1', 'Comets,0,0,0,1,2,0,1,3,x,7,6,1']);
  assert.deepEqual(rows.slice(8, 10), ['Foxes batting', 'Player,No.,Pos,PA,AB,R,H,2B,3B,HR,RBI,BB,K,HBP,SB,CS,SF,SH']);
  assert.equal(rows[12], 'Brennan,24,,5,4,0,2,1,1,0,1,0,0,1,0,0,0,0');
  assert.equal(rows[19], 'Totals,,,40,35,1,8,1,1,0,1,4,10,1,0,1,0,0');
  assert.deepEqual(rows.slice(21, 25), ['Foxes pitching', 'Player,No.,Dec,IP,BF,H,R,ER,BB,K,HR,HBP,WP,BK,Pitches,Strikes', 'Whitlock,33,L,6,27,5,4,4,2,8,2,1,0,0,106,69', 'Moreno,41,,2,12,1,3,3,5,2,1,0,0,0,51,27']);
  assert.ok(rows.includes('Halvorsen,21,W,6,26,5,1,1,2,5,0,1,0,0,97,63') && rows.includes('Bishop,37,S,3,14,3,0,0,2,5,0,0,0,0,53,35'));
  // A team season's columns, in its order, less the ones only a season has, so the rows go straight into it.
  assert.deepEqual(rows[9].split(',').slice(3), ST.BAT_COLS.filter(k => !['G', 'AVG', 'OBP', 'SLG', 'OPS'].includes(k)));
  assert.deepEqual(rows[22].split(',').slice(3), ST.PIT_COLS.filter(k => !['G', 'W', 'L', 'S', 'ERA', 'Strike %'].includes(k)));
  // A pinch hitter after the starter, a sacrifice fly and a bunt in their columns, someone who hasn't batted blank, a
  // reliever, and without pitches counted, no pitch columns; an inning not played yet is empty.
  const h = game({ pitches: false });
  h.teams[0].lineup[2].push({ name: 'Diaz', num: '12', pos: 'LF' });
  h.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  play(h, '3B', 'SF 8', { t: 'sub', s: 0, slot: 2, i: 1, ty: 'ph' }, '1B', { t: 'pch', s: 1, i: 1 }, 'SAC 1 3', 'K');
  const r = boxCsv(h).split('\r\n');
  assert.equal(r[5], 'Foxes,1,,,,,,,,,1,2,0');
  assert.deepEqual(r.slice(10, 15), ['Batter 1,,,1,1,1,1,0,1,0,0,0,0,0,0,0,0,0', 'Batter 2,,,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0', 'Batter 3,,,,,,,,,,,,,,,,,', 'Diaz,12,LF,1,1,0,1,0,0,0,0,0,0,0,0,0,0,0', 'Batter 4,,,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1']);
  assert.equal(r[r.indexOf('Comets pitching') + 1], 'Player,No.,Dec,IP,BF,H,R,ER,BB,K,HR,HBP,WP,BK');
  assert.deepEqual(r.slice(r.indexOf('Comets pitching') + 2, -1), ['Pitcher,,,0.1,3,2,1,1,0,0,0,0,0,0', 'Bishop,37,,0.2,2,0,0,0,0,1,0,0,0,0']);
});

test('a season in words for a group chat, and as a spreadsheet', () => {
  const T = ST.season(seasonGames(), 'Foxes'), r = T.bat.find(x => x.key === 'ruiz');
  const text = ST.seasonText(T, r).split('\n');
  assert.equal(text[0], 'RUIZ, Foxes, 2026');
  assert.equal(text[1], 'Batting: .667 (2 for 3) in 2 games, with a double, a triple, 2 runs, a strikeout. On base .667, slugging 1.667.');
  assert.match(text[2], /^Last game, .+ vs Bears: 1 for 1, a triple, a run\.$/);
  const w = T.pit.find(x => x.key === 'whitlock');
  assert.equal(ST.seasonText(T, w).split('\n')[1], 'Pitching: 2 games, 2 innings, 2-0, 6 strikeouts, 0 walks, a 0.00 ERA, 3 pitches.');
  const csv = ST.teamCsv(T);
  assert.ok(csv.startsWith('\ufeff"Foxes, 2026 season"\r\n'), 'with the mark that tells a spreadsheet it’s UTF-8');
  assert.ok(csv.includes('\r\nPlayer,No.,Pos,G,PA,AB,R,H,2B,3B,HR,RBI,BB,K,HBP,SB,CS,SF,SH,AVG,OBP,SLG,OPS\r\nRUIZ,,,2,3,3,2,2,1,1,0,0,0,1,0,0,0,0,0,.667,.667,1.667,2.333\r\n'));
  assert.ok(csv.includes('\r\nTotals,,,2,8,'));
  assert.ok(csv.includes('\r\n2026-05-09,Bears,Home,W 1-0\r\n'));
  // A name that a spreadsheet would read as a formula, or with a comma in it, stays a name.
  const odd = seasonGame({ date: '2026-05-02', bats: [['=1+2', 'Ruiz, Jr.'], []] }, '1B', 'K', 'K', 'K', ...threeK);
  const C = ST.teamCsv(ST.season([odd], 'Foxes'));
  assert.ok(C.includes("\r\n'=1+2,") && C.includes('\r\n"Ruiz, Jr.",'));
  assert.match(ST.playerCsv(T, r), /\r\n2026-05-02,at Comets,W 3-0,2,2,1,1,1,0,0,0,0,1,0,0,0,0,0,\.500,\.500,1\.000,1\.500,2B K\r\n/);
});

test('a team’s and a player’s address', () => {
  assert.equal(ST.teamHref('Tigers 10U'), '#/team/Tigers%2010U');
  assert.equal(ST.teamHref('Tigers', '2026', { name: 'Emma P' }), '#/team/Tigers/2026/Emma%20P');
  assert.equal(ST.teamHref('Tigers', '', { name: '', num: '4' }), '#/team/Tigers/all/%234');
  assert.deepEqual([ST.keyFrom('Emma  P'), ST.keyFrom('#4')], ['emma p', '#4']);
});
