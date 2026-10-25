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

// Positions on the whole field, numbered the way scorers number them.
const SPOT = [null, [160, 186], [160, 258], [236, 164], [204, 118], [116, 118], [84, 164], [62, 66], [160, 36], [258, 66]];

// A name the picker has room for: a long one's surname, cut short.
const short = n => { const w = n.split(/\s+/), x = n.length > 10 && w.length > 1 ? w.at(-1) : n; return x.length > 11 ? x.slice(0, 10) + '…' : x; };
// Second and third have their names above them, clear of first and short.
const ABOVE = new Set([4, 5]);

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
