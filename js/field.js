// Drawings of the field: the infield behind the runners on the scoring screen, and the whole field with the nine
// positions to tap when saying who fielded the ball.
import { POS, POS_NAME, ord } from './engine.js';
import { esc } from './ui.js';

// Where each base is on the scoring screen's infield, as percentages of its box (home, first, second, third).
// The diamond is drawn a little flattened, as if from behind home plate, so it doesn't take up the whole phone.
export const BASE_AT = [[50, 88.2], [83.3, 51.8], [50, 15.3], [16.7, 51.8]];

export function infieldSvg() {
  return `<svg class="infield" viewBox="0 0 300 170" preserveAspectRatio="none" aria-hidden="true">
    <defs><pattern id="mow" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><rect width="18" height="36" class="grass-a"/><rect x="18" width="18" height="36" class="grass-b"/></pattern></defs>
    <rect width="300" height="170" fill="url(#mow)"/>
    <path class="dirt" d="M150 168 L276 88 Q150 -26 24 88 Z"/>
    <path class="infield-grass" d="M150 134 L224 88 L150 42 L76 88 Z"/>
    <ellipse class="dirt" cx="150" cy="89" rx="13" ry="8"/>
    <path class="chalk" d="M150 150 L250 88 L150 26 L50 88 Z"/>
    <path class="plate" d="M143 147 h14 v3 l-7 4 l-7 -4 z"/>
    <path class="bag" d="M250 82 L259 88 L250 94 L241 88 Z"/>
    <path class="bag" d="M150 20 L159 26 L150 32 L141 26 Z"/>
    <path class="bag" d="M50 82 L59 88 L50 94 L41 88 Z"/>
  </svg>`;
}

// Positions on the whole field, numbered the way scorers number them: each where he stands, the third baseman (5) by
// third base and the shortstop (6) between second and third. (Home plate is at 160 248, first base 230 178, second
// 160 108 and third 90 178.)
export const SPOT = [null, [160, 186], [160, 258], [236, 164], [204, 118], [84, 164], [116, 118], [62, 66], [160, 36], [258, 66]];

// A name the picker has room for: a long one's surname, cut short.
const short = n => { const w = n.split(/\s+/), x = n.length > 10 && w.length > 1 ? w.at(-1) : n; return x.length > 11 ? x.slice(0, 10) + '…' : x; };
// Second and short have their names above them, clear of first and third.
const ABOVE = new Set([4, 6]);

// names: who's at each position, under his number (or over it), when the lineup says.
export function fieldSvg({ picked = [], tappable = true, names = [] } = {}) {
  const all = POS_NAME.slice(1).map((name, i) => `${i + 1} ${name}`).join(', '), named = names.some(Boolean);
  let s = `<svg class="whole-field" viewBox="0 0 320 ${named ? 298 : 284}" ${tappable ? 'role="group" aria-label="The nine fielding positions"' : `role="img" aria-label="The nine fielding positions: ${all}"`}>
    <path class="of" d="M160 262 L6 108 A218 218 0 0 1 314 108 Z"/>
    <path class="dirt" d="M160 262 L250 172 Q160 52 70 172 Z"/>
    <path class="infield-grass" d="M160 236 L214 182 L160 128 L106 182 Z"/>
    <path class="chalk" d="M160 248 L230 178 L160 108 L90 178 Z M160 248 L6 94 M160 248 L314 94"/>`;
  for (let n = 1; n <= 9; n++) {
    const [x, y] = SPOT[n], at = picked.indexOf(n);
    const who = names[n] ? `<text class="who" y="${ABOVE.has(n) ? -27 : 35}">${esc(short(names[n]))}</text>` : '';
    const g = `<circle r="21" class="spot${at >= 0 ? ' on' : ''}"/><text class="num" y="3">${n}</text><text class="ab" y="14">${POS[n]}</text>${at >= 0 ? `<text class="order" x="15" y="-13">${at + 1}</text>` : ''}${who}`;
    // Named in words ("6, shortstop"), with where in the play they came when picked ("picked 1st and 3rd"). The ring
    // outside the circle shows which one has the keyboard, on the grass and the dirt alike.
    const when = picked.map((p, i) => (p === n ? ord(i + 1) : '')).filter(Boolean);
    s += tappable
      ? `<g class="pos" transform="translate(${x} ${y})" data-pos="${n}" role="button" tabindex="0" aria-keyshortcuts="${n}" aria-label="${n}, ${POS_NAME[n]}${names[n] ? ', ' + esc(names[n]) : ''}${when.length ? ', picked ' + when.join(' and ') : ''}"${when.length ? ' aria-pressed="true"' : ''}><circle r="26.5" class="ring halo"/><circle r="26.5" class="ring"/>${g}</g>`
      : `<g class="pos" transform="translate(${x} ${y})">${g}</g>`;
  }
  return s + '</svg>';
}

// A spray chart: where the balls a batter or a team hit went, on the field as a scorecard draws it (its lines in the
// card's blue). balls: [{ n: the fielder it went to, hit: whether it was a hit, hr: a home run, title: it in words,
// now: the one to pick out }], in game order. A hit is a red dot and anything else (an out, an error, a fielder's
// choice) an open ring, so they differ by shape as well as colour; several to one fielder sit around his spot, the
// first in the middle. Each fielder's spot is at his angle from home: the outfielders' inside the fence, so a ball
// caught there doesn't look like a home run, and a home run over it. label: the chart in words, for a screen reader.
// (The drawing has room above the fence and below home for a second home run to center, or a few pop-ups to the
// catcher, with the one picked out ringed.)
const HOME = [160, 248], FENCE = 212;
function spot(n, hr) {
  const [x, y] = SPOT[n], a = Math.atan2(x - HOME[0], HOME[1] - y), d = hr ? FENCE + 16 : n >= 7 ? 175 : Math.hypot(x - HOME[0], y - HOME[1]);
  return [HOME[0] + d * Math.sin(a), HOME[1] - d * Math.cos(a)];
}
const AROUND = [[0, 0], ...[0, 1, 2, 3, 4, 5].map(k => [13 * Math.sin(k * Math.PI / 3), -13 * Math.cos(k * Math.PI / 3)]),
  ...Array.from({ length: 12 }, (_, k) => [26 * Math.sin(k * Math.PI / 6), -26 * Math.cos(k * Math.PI / 6)])];
export function sprayField(balls, label = '') {
  let s = `<svg class="spray-field" viewBox="0 -8 320 288" role="img" aria-label="${esc(label)}">
    <path class="fo" d="M160 248 L10 98 A212 212 0 0 1 310 98 Z"/>
    <path class="fi" d="M160 248 L230 178 L160 108 L90 178 Z M70 172 Q160 52 250 172"/>`;
  const at = {};
  for (const b of balls) {
    const where = b.n + (b.hr ? 'hr' : ''), k = at[where] = (at[where] || 0) + 1, [dx, dy] = AROUND[(k - 1) % AROUND.length], [x, y] = spot(b.n, b.hr);
    s += `<g class="ball${b.hit ? ' hit' : ''}${b.now ? ' now' : ''}" transform="translate(${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)})"><title>${esc(b.title)}</title><circle class="tap" r="12"/>${b.now ? '<circle class="mark" r="10"/>' : ''}<circle class="dot" r="6"/></g>`;
  }
  return s + '</svg>';
}
