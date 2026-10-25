// The rules of scoring, without a browser:  node --test test/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, suggest, check, runsCount, scoredAs, mark, now, columns, halfLabel, RESULTS, runnersOn, pitchDay, pitchStat, pitchWork, pitchCount } from '../js/engine.js';
import { newGame, cleanGame, cleanDoc, parseLineup, parsePaste, takeBack, putBack, carryLineup, newer, merge, seenOf } from '../js/model.js';
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
  assert.equal(S.text.at(-1), 'Batter 3 grounds out, short to first (6-4-3). Batter 1 scores. Batter 2 to second.');
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
  assert.equal(S.text.at(-1), 'Batter 2 singles. Speedy scores.');
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

test('everyone who scores on a play is in one sentence, so a grand slam fits the line under the field', () => {
  const g = game();
  ['Mackenzie', 'Alejandro', 'Christopher', 'Josephine'].forEach((name, i) => { g.teams[0].lineup[i][0].name = name; });
  let S = play(g, 'BB', 'BB', 'BB', 'HR');
  assert.equal(S.text.at(-1), 'Josephine hits a home run. Mackenzie, Alejandro and Christopher score.');
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
  assert.equal(S.text.at(-1), 'Batter 1 and Batter 2 score on a wild pitch.');
  S = play(game(), '1B', '1B', { t: 'r', m: [[2, 4, 'E', [2]], [1, 4, 'E', [2]]] });
  assert.equal(S.text.at(-1), 'Batter 1 and Batter 2 score on an error by the catcher (E2).');
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
  const notes = side => boxHtml(S).split('<div class="extras">')[side + 1].split('</div>')[0].replace(/<\/?b>/g, '').split(/<\/p><p>|<\/?p>/).filter(Boolean);
  assert.deepEqual(notes(0), [
    'Doubles: Ruiz, Okafor.', 'Home runs: Pruitt.', 'Sacrifice flies: Castillo.', 'Hit by a pitch: Brennan.',
    'Stolen bases: Brennan.', 'Caught stealing: Han.', 'Left on base: 0.',
  ]);
  assert.deepEqual(notes(1), [
    'Triples: Batter 1.', 'Sacrifice bunts: Batter 2.', 'Left on base: 1.', 'Errors: catcher’s interference, third baseman.',
    'Wild pitches: Halvorsen.', 'Hit batters: Halvorsen (Brennan).', 'Balks: Bishop.',
  ]);
  // Batters faced, home runs, and pitches and strikes are columns of the pitching lines: IP H R BB K HR BF P-S.
  const line = who => boxHtml(S).match(new RegExp(`<th scope="row">${who}</th>((?:<td>[^<]*</td>)+)`))[1].match(/<td>([^<]*)<\/td>/g).map(x => x.slice(4, -5));
  assert.deepEqual(line('Halvorsen').slice(5, 7), ['0', '4']);
  assert.deepEqual(line('Bishop').slice(5, 7), ['1', '4']);
  assert.match(line('Bishop')[7], /^\d+-\d+$/);
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
  assert.equal(S.text.at(-1), 'Batter 2 singles. Batter 1 scores.');
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
  play(g, { t: 'sub', s: 0, slot: 1, i: 0, ty: 'def' }, 'IBB', 'CI', 'SAC 1 3', '3B', { t: 'end' }, { t: 'on' }, 'LO 6', '1B', 'DP 6 4 3');
  return g;
}

test('a game with every kind of event comes back the same from a file, Drive, storage and a link', async () => {
  const g = everyKind(), S = replay(g);
  assert.deepEqual(new Set(g.ev.map(e => e.t)), new Set(['p', 'pa', 'r', 'sub', 'pch', 'add', 'eoh', 'end', 'on']));
  assert.deepEqual([S.R, S.inn, S.half], [[5, 1], 3, 1]);
  for (const t of S.text) assert.doesNotMatch(t, /undefined|NaN/);
  const json = JSON.parse(JSON.stringify(g));
  assert.deepEqual(cleanGame(json), g);
  assert.deepEqual(cleanGame(cleanGame(json)), g, 'tidying again changes nothing');
  assert.deepEqual(cleanDoc({ app: 'backwards-k', v: 1, games: { [g.id]: json }, gone: {} }).games, { [g.id]: g });
  const { pack, unpack } = await import('../js/share.js');
  const link = await pack(g);
  assert.equal(link[0], 'z');
  assert.deepEqual(await unpack(link), json);
  assert.deepEqual(cleanGame(await unpack(link)), g);
  // A link made where the browser can't compress: the game as plain JSON, in base64url.
  const plain = 'j' + Buffer.from(JSON.stringify(g)).toString('base64url');
  assert.deepEqual(cleanGame(await unpack(plain)), g);
  assert.deepEqual(replay(cleanGame(await unpack(plain))).text, S.text);
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
  game: { limits: { pitches: 85, rest: [1, 2, 4] } }, team: { coach: 'Ann' }, player: { pos: 'SS', bats: 'L' },
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
  g.teams[0].lineup[0][0].pos = big;
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
  assert.equal(c.teams[0].lineup[0][0].pos.length, 200);
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
  assert.deepEqual(got.slice(0, 3), [{ name: 'Shohei Ohtani', num: '' }, { name: 'Mookie Betts', num: '' }, { name: 'Freddie Freeman', num: '' }]);
  assert.equal(got[4].name, 'Teoscar Hernández');
  assert.deepEqual(parseLineup('1. 17 Ohtani DH\n2. 50 Betts SS'), [{ name: 'Ohtani', num: '17' }, { name: 'Betts', num: '50' }]);
  assert.deepEqual(parseLineup('1) Judge #99 RF\n2) Soto LF'), [{ name: 'Judge', num: '99' }, { name: 'Soto', num: '' }]);
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
  assert.deepEqual(parseLineup('1. 17 Ohtani DH 2. 50 Betts SS'), [{ name: 'Ohtani', num: '17' }, { name: 'Betts', num: '50' }]);
  // The position first, after a dash, or a batting average at the end.
  assert.deepEqual(just(parseLineup('SS M. Betts\nDH S. Ohtani\nC W. Smith')), ['M. Betts', 'S. Ohtani', 'W. Smith']);
  assert.deepEqual(just(parseLineup('Shohei Ohtani - DH\nMookie Betts – SS\nFreddie Freeman — 1B')), ['Shohei Ohtani', 'Mookie Betts', 'Freddie Freeman']);
  assert.deepEqual(just(parseLineup('1 Ohtani DH .282\n2 Betts SS .289 12 HR')), ['Ohtani', 'Betts']);
  assert.deepEqual(parseLineup('1\tShohei Ohtani\tDH\n2\t#50 Mookie Betts\tSS'), [{ name: 'Shohei Ohtani', num: '' }, { name: 'Mookie Betts', num: '50' }]);
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
  // Next game starts with whoever finished in each spot: Morris, not Diaz.
  assert.deepEqual(carryLineup(g.teams[0], S.pl[0])[0], [{ name: 'Morris', num: '21' }]);
  // Back in, he bats as himself.
  const T = play(g, ...threeK, 'K', '1B', '1B', 'K', '2B');
  assert.deepEqual([T.bat['0.0.0'].pa, T.bat['0.0.0'].h, T.bat['0.0.1']], [2, 2, undefined]);
  assert.match(T.text[T.text.length - 1], /^Morris doubles/);
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

test('a pitcher’s day in words: plurals, and outs below an inning said as outs', () => {
  const st = { np: 1, str: 1, bf: 1, outs: 0, h: 1, r: 1, bb: 1, k: 1 };
  assert.equal(pitchDay(st), '1 pitch (1 strike), no outs yet, 1 batter faced, 1 hit, 1 run, 1 walk, 1 strikeout.');
  assert.equal(pitchDay({ ...st, outs: 2 }, false), '2 outs, 1 batter faced, 1 hit, 1 run, 1 walk, 1 strikeout.');
  assert.equal(pitchDay({ ...st, np: 0, str: 0, outs: 3, h: 0, r: 2 }), '0 pitches (0 strikes), 1 inning, 1 batter faced, 0 hits, 2 runs, 1 walk, 1 strikeout.');
  const S = replay(sampleGame(7)), w = pitchStat(S, 0, 0);
  assert.equal(pitchDay(w), '106 pitches (69 strikes), 6 innings, 27 batters faced, 5 hits, 4 runs, 2 walks, 8 strikeouts.');
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
