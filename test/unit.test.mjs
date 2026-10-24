// The rules of scoring, without a browser:  node --test test/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, suggest, check, runsCount, scoredAs, mark, now, columns, halfLabel, RESULTS } from '../js/engine.js';
import { newGame, cleanGame, cleanDoc, parseLineup } from '../js/model.js';
import { sampleGame } from '../js/sample.js';
// The card is drawn with ui.js, which looks for the page's sheet as it loads: here there's no page, so no sheet.
globalThis.document ??= { readyState: 'complete', getElementById: () => null };
const { lineHtml, cellSvg, cardHtml } = await import('../js/card.js');
const { playsHtml, boxHtml } = await import('../js/box.js');

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

test('a called game that picks up again ends the usual way', () => {
  const g = game({ innings: 1 });
  let S = play(g, ...threeK, { t: 'end' });
  assert.equal(halfLabel(S), 'Called');
  S = play(g, { t: 'on' }, 'K', 'HR');
  assert.equal(S.over, true, 'a walk-off home run');
  assert.equal(halfLabel(S), 'Final');
  assert.equal(S.R[1], 1);
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

test('a home run with the batter called out says so', () => {
  const g = game();
  const S = play(g, 'E', { t: 'pa', r: 'HR', m: [[0, 0], [1, 4]] });
  assert.equal(S.text[1], 'Batter 2 hits a home run, but is called out on the bases. Batter 1 scores.');
  assert.equal(S.cells[1].outAt, 4);
  assert.equal(S.cells[1].outN, 1);
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

test('the card marks where a new pitcher took over and where a substitute first batted', () => {
  const g = game();
  g.teams[1].pitchers.push({ name: 'Bishop', num: '37' });
  g.teams[0].lineup[2].push({ name: 'Diaz', num: '' });
  g.teams[0].lineup[0].push({ name: 'Speedy', num: '' });
  const S = play(g, '1B', 'K', { t: 'pch', s: 1, i: 1 }, P('b'), { t: 'sub', s: 0, slot: 2, i: 1, ty: 'ph' }, '2B',
    { t: 'sub', s: 0, slot: 0, i: 1, ty: 'pr' }, 'K', 'K', ...threeK, 'GO 6 3', '1B', '1B', '1B', 'K');
  const h = cardHtml(S, 0);
  const td = n => h.match(new RegExp(`<td([^>]*)><button type="button" class="box" data-cell="${n}" aria-label="([^"]*)"`)).slice(1);
  assert.deepEqual(td(2), [' class="pch sub" title="Bishop pitching from here"', 'Diaz doubles. Batter 1 to third. Bishop pitching from here.']);
  assert.deepEqual(td(1), ['', 'Batter 2 strikes out swinging.']);
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
  const notes = side => boxHtml(S).split('<div class="extras">')[side + 1].split('</div>')[0].replace(/<\/?b>/g, '').split(/<\/p><p>|<\/?p>/).filter(Boolean);
  assert.deepEqual(notes(0), [
    'Doubles: Ruiz, Okafor.', 'Home runs: Pruitt.', 'Sacrifice flies: Castillo.', 'Hit by a pitch: Brennan.',
    'Stolen bases: Brennan.', 'Caught stealing: Han.', 'Left on base: 0.', 'Batters faced: Whitlock 5.',
  ]);
  assert.deepEqual(notes(1), [
    'Triples: Batter 1.', 'Sacrifice bunts: Batter 2.', 'Left on base: 1.', 'Errors: catcher’s interference, 3B.',
    'Wild pitches: Halvorsen.', 'Hit batters: Halvorsen (Brennan).', 'Balks: Bishop.', 'Batters faced: Halvorsen 4, Bishop 4.',
  ]);
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

test('a game survives being tidied (from a file or a link) unchanged', () => {
  const g = sampleGame(3);
  const c = cleanGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(c, g);
  assert.deepEqual(replay(c).R, replay(g).R);
  assert.equal(cleanGame({ nope: 1 }), null);
  assert.deepEqual(Object.keys(cleanDoc({ games: { x: g } }).games), [g.id]);
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

// Each event replayed from scratch gives what replaying it all at once gives (so undo is safe).
test('undo is replaying one event fewer', () => {
  const g = sampleGame(11);
  const all = replay(g);
  const back = { ...g, ev: g.ev.slice(0, -1) };
  const before = replay(back);
  assert.ok(before.cells.length <= all.cells.length);
  assert.equal(replay({ ...g, ev: g.ev.slice() }).R.join(), all.R.join());
});

test('every suggested set of runner moves passes check()', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const g = sampleGame(seed);
    const part = { ...g, ev: [] };
    for (const e of g.ev) {
      if (e.t === 'pa') {
        const S = replay(part);
        assert.equal(check(S, e.m), '', `seed ${seed}, event ${part.ev.length}: ${JSON.stringify(e)}`);
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
  assert.deepEqual(got.slice(0, 3), [{ name: 'Shohei Ohtani', num: '' }, { name: 'Mookie Betts', num: '' }, { name: 'Freddie Freeman', num: '' }]);
  assert.equal(got[4].name, 'Teoscar Hernández');
  assert.deepEqual(parseLineup('1. 17 Ohtani DH\n2. 50 Betts SS'), [{ name: 'Ohtani', num: '17' }, { name: 'Betts', num: '50' }]);
  assert.deepEqual(parseLineup('1) Judge #99 RF\n2) Soto LF'), [{ name: 'Judge', num: '99' }, { name: 'Soto', num: '' }]);
  // Numbers that aren't 1, 2, 3 in order are jersey numbers.
  assert.deepEqual(parseLineup('22 Kershaw\n35 Bellinger'), [{ name: 'Kershaw', num: '22' }, { name: 'Bellinger', num: '35' }]);
});
