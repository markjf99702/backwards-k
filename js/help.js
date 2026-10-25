// How to read a scorecard, and how to keep one here.
import { cellSvg } from './card.js';
import { fieldSvg } from './field.js';
import { openSheet, KL } from './ui.js';

const box = o => ({ r: 'GO', mark: '', reach: 0, notes: ['', '', '', '', ''], scored: false, outN: 0, outAt: 0, outHow: '', rbi: 0, seq: '', count: [0, 0], ...o });
const EXAMPLES = [
  [box({ r: '1B', mark: '1B', reach: 4, notes: ['', '', 'SB', '5', '7'], scored: true }), 'Singled, stole second, went to third on the 5th batter’s hit and scored on the 7th’s. A run fills the diamond in.'],
  [box({ r: 'BB', mark: 'BB', reach: 2, notes: ['', '', '4', '', ''] }), 'Walked, moved to second on the 4th batter, and was left there when the inning ended.'],
  [box({ r: 'HR', mark: 'HR', reach: 4, scored: true, rbi: 2 }), 'A home run. The dots along the bottom are runs batted in.'],
  [box({ r: 'K', mark: 'K', outN: 1 }), 'Struck out swinging, the first out of the inning (the circled number).'],
  [box({ r: 'KL', mark: 'KL', outN: 2 }), 'Struck out looking: the backwards K. Strike three was called.'],
  [box({ r: 'GO', mark: '6-3', outN: 3 }), 'Grounded out, shortstop (6) to first base (3).'],
  [box({ r: 'FO', mark: 'F8', outN: 1 }), 'Flied out to the center fielder (8). L is a line drive and P a pop-up.'],
  [box({ r: '1B', mark: '1B', reach: 1, outN: 2, outAt: 2, outHow: 'CS' }), 'Singled, then was caught stealing second.'],
  [box({ r: 'E', mark: 'E6', reach: 1 }), 'Reached first on an error by the shortstop.'],
  [box({ r: 'DP', mark: '6-4-3 DP', outN: 2 }), 'Grounded into a double play, short to second to first.'],
];
// Four of them, each in a few words, for the first screen before there are any games: what the card looks like.
export const FIRST = [[EXAMPLES[0][0], 'Singled and scored'], [EXAMPLES[1][0], 'Walked'], [EXAMPLES[4][0], 'Struck out looking'], [EXAMPLES[5][0], 'Short to first']];

export function helpSheet() {
  openSheet(`<h2 id="sheetTitle">How to read the card</h2>
    <p>Every box is one trip to the plate. The little diamond is the bases: the path is drawn as far as the batter got, and a run fills it in. Small marks by a base say how they got there.</p>
    <div class="examples">${EXAMPLES.map(([c, t]) => `<div class="ex"><div class="cell-pic">${cellSvg(c, { count: false })}</div><p>${t}</p></div>`).join('')}</div>
    <h3>Numbers for the fielders</h3>
    <p>Scorers write fielders as numbers. 6-3 is a throw from the shortstop to first; F8 is a catch by the center fielder.</p>
    <div class="pick">${fieldSvg({ tappable: false })}</div>
    <h3>The other marks</h3>
    <dl class="marks">
      <dt>1B 2B 3B HR</dt><dd>Single, double, triple, home run</dd>
      <dt>BB</dt><dd>Walk (base on balls). IBB is intentional</dd>
      <dt>HBP</dt><dd>Hit by pitch</dd>
      <dt>K, ${KL}</dt><dd>Strikeout swinging, and looking</dd>
      <dt>K and a line to first</dt><dd>Struck out, but reached first on a dropped third strike</dd>
      <dt>FC</dt><dd>Fielder’s choice: safe because they got another runner out</dd>
      <dt>E6</dt><dd>Error, by the fielder with that number</dd>
      <dt>CI</dt><dd>Catcher’s interference: the batter goes to first, and the catcher is charged with an error</dd>
      <dt>SF, SAC</dt><dd>Sacrifice fly, sacrifice bunt</dd>
      <dt>DP, TP</dt><dd>Double play, triple play</dd>
      <dt>3U</dt><dd>Unassisted: the first baseman made the out alone</dd>
      <dt>SB, CS, PO</dt><dd>Stolen base, caught stealing, picked off</dd>
      <dt>A line with a bar</dt><dd>Put out trying for that base</dd>
      <dt>AR and a dot on second</dt><dd>Put on second to start an extra inning, where a league does that: he didn’t bat, and his run is unearned</dd>
      <dt>WP, PB, BK</dt><dd>Wild pitch, passed ball, balk</dd>
      <dt>A small number</dt><dd>Moved up on that batter’s play (by their place in the order)</dd>
      <dt>2-1</dt><dd>The count when the at-bat ended (balls, then strikes)</dd>
      <dt>Red line</dt><dd>Under the last batter of an inning</dd>
      <dt>A heavy line on top</dt><dd>A new pitcher took over with that batter</dd>
      <dt>A heavy line on the left</dt><dd>A substitute’s first time up</dd>
      <dt>PH, PR, in, back</dt><dd>Pinch hitter, pinch runner, a substitute in the field, or someone who was in that spot before coming back in, with the inning they came in. A crossed-out name has left the game</dd>
      <dt>R H E LOB</dt><dd>Under the card, inning by inning: runs, hits, the other team’s errors, and runners left on base</dd>
      <dt>X</dt><dd>On the line score: the home team didn’t need to bat</dd>
    </dl>
    <h3>Keeping score here</h3>
    <ul class="tips">
      <li><b>Counting pitches is up to you.</b> Tap Ball, Strike or Foul as they happen, and four balls or three strikes finish the at-bat by themselves. Or skip them and only tap what the batter did.</li>
      <li><b>Runners move themselves.</b> With runners on, you’ll see where everyone usually ends up. Tap anything that went differently.</li>
      <li><b>Tap a runner</b> on the field for a steal, a wild pitch or a pickoff.</li>
      <li><b>Tap the batter or the pitcher</b> to give them a name, or to make a substitution. Names can wait until later.</li>
      <li><b>Undo</b> takes back plays, latest first, as many as you need. A change made in a box on the card has its own Undo, right after it.</li>
      <li><b>Tap any box on the card</b> to see what happened in words, or to fix it.</li>
      <li><b>On a keyboard,</b> keys score too: B ball, C called strike, S swinging strike, F foul; 1 to 4 for a single to a home run; W walk, H hit by pitch, E error; K strikeout (Shift+K looking), G ground out, Y fly out, L line out, P pop out; M for More, and U or Ctrl+Z to undo. Then type the fielders’ numbers and press Enter: G, 6, 3, Enter is a 6-3.</li>
    </ul>
    <div class="row"><button type="button" class="btn primary" data-close>Got it</button></div>`, { wide: true });
}
