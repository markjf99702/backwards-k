// League rules for a game, picked in New game and in Game settings: none, Little League's, the Minors', USA Softball's,
// high-school softball's, or a league's own (Custom): the most runs a half-inning, and a mercy rule. And a pitch limit
// for youth pitchers. engine.js plays them, and model.js keeps them.
import { $, esc } from './ui.js';
import { PITCH_AGES, LIMIT_BY } from './engine.js';

// Little League's mercy rule (4.10(e)): 15 runs ahead after 3 innings, or 10 after 4, half an inning sooner when it's
// the home team. The Minors add a common local rule: a half-inning ends at 5 runs, except in the last inning, and the
// 5th run is the last to count on that play.
const LL = { set: 'll', runs: 0, last: false, all: false, mercy: [[3, 15], [4, 10]] };
// Softball. USA Softball's run-ahead rule for fast pitch, women's and Junior Olympic (Rule 5, Section 9 A): 15 runs
// ahead after 3 innings, 12 after 4 or 8 after 5, and the home team doesn't bat when it's that far ahead (9 B). High
// school: NFHS rule 4-2-3 leaves it to each state association, and most have 15 after 3 or 10 after 5.
const USA = { ...LL, set: 'usa', mercy: [[3, 15], [4, 12], [5, 8]] };
export const LEAGUES = { ll: LL, minors: { ...LL, set: 'minors', runs: 5 }, usa: USA, hs: { ...USA, set: 'hs', mercy: [[3, 15], [5, 10]] } };
const CITE = { ll: 'Little League rule 4.10(e)', minors: 'Little League rule 4.10(e)', usa: 'USA Softball rule 5-9, fast pitch', hs: 'as most state associations have it for high school, NFHS rule 4-2-3' };
const CUSTOM = { set: 'custom', runs: 5, last: false, all: false, mercy: [[4, 10]] };
const CHOICES = [['none', 'None'], ['ll', 'Little League'], ['minors', 'LL Minors'], ['usa', 'USA Softball'], ['hs', 'High school softball'], ['custom', 'Custom']];
const copy = r => (r ? { ...r, mercy: r.mercy.map(m => m.slice()) } : null);
// Which choice the rules are: 'none', a league's, or 'custom'.
const kind = r => (!r ? 'none' : Object.hasOwn(LEAGUES, r.set) ? r.set : 'custom');
const either = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} or ${a.at(-1)}`);

// The rules in words, under the choice.
export function rulesWords(r) {
  if (!r) return 'Three outs end each half-inning, and the game goes the innings set.';
  const bits = [];
  if (r.runs) bits.push(`A half-inning ends at ${r.runs} run${r.runs === 1 ? '' : 's'}${r.last ? '' : ', except in the last inning'}: ${r.all ? 'every run on that play counts' : 'a run after that on the same play doesn’t count'}.`);
  if (r.mercy.length) bits.push(`The game is over with a team ${either(r.mercy.map(([n, by], i) => `${by}${i ? '' : ' runs'} ahead after ${n} inning${n === 1 ? '' : 's'}`))}, or half an inning sooner when it’s the home team${Object.hasOwn(CITE, r.set) ? ` (${CITE[r.set]})` : ''}.`);
  return bits.join(' ') || 'No run limit and no mercy rule.';
}

// The League rules row, drawn into host: the four choices, Custom's numbers, and the rules in words. get() gives the
// rules now; set(rules) takes new ones (null for none), and can say why not (or what it took instead), for under them.
export function rulesRow(host, get, set) {
  const draw = () => {
    const r = get(), k = kind(r), m = (r && r.mercy[0]) || [];
    const num = (key, v, words) => `<input type="text" inputmode="numeric" maxlength="2" data-rk="${key}" value="${v || ''}" aria-label="${esc(words)}" autocomplete="off">`;
    host.innerHTML = `<div class="opt league"><span class="lbl" id="leagueLbl">League rules</span>
        <span class="chips" role="group" aria-labelledby="leagueLbl">${CHOICES.map(([v, w]) => `<button type="button" data-rules="${v}" aria-pressed="${v === k}">${w}</button>`).join('')}</span></div>
      ${k === 'custom' ? `<div class="custom-rules">
        <p class="rule-row"><span>A half-inning ends at</span>${num('runs', r.runs, 'Most runs a half-inning')}<span>runs</span><small>Blank for no limit.</small></p>
        <label class="switch"><input type="checkbox" data-rk="last"${r.last ? ' checked' : ''}><span>In the last inning too</span></label>
        <label class="switch"><input type="checkbox" data-rk="all"${r.all ? ' checked' : ''}><span>Every run on the play that reaches it counts</span></label>
        <p class="rule-row"><span>Mercy rule:</span>${num('by', m[1], 'Mercy rule: runs ahead')}<span>runs ahead after</span>${num('after', m[0], 'Mercy rule: after how many innings')}<span>innings</span></p>
      </div>` : ''}
      <p class="hint rules-words">${esc(rulesWords(r))}</p>`;
  };
  draw();
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-rules]');
    if (!b) return;
    const v = b.dataset.rules, r = get();
    if (v === kind(r)) return;
    const why = set(v === 'none' ? null : v === 'custom' ? copy(CUSTOM) : copy(LEAGUES[v]));
    draw();
    if (why) $('.rules-words', host).textContent = why;
    $(`[data-rules="${v}"]`, host).focus();
  });
  // Custom's numbers and switches: the rules change as they're typed, and only the words under them are redrawn.
  const change = e => {
    const i = e.target.closest('[data-rk]'), r = copy(get());
    if (!i || !r) return;
    const n = k => { const x = parseInt($(`[data-rk=${k}]`, host).value, 10); return Number.isFinite(x) && x > 0 ? Math.min(x, 99) : 0; };
    r.runs = n('runs');
    r.last = $('[data-rk=last]', host).checked;
    r.all = $('[data-rk=all]', host).checked;
    r.mercy = n('by') && n('after') ? [[Math.min(n('after'), 30), n('by')]] : [];
    $('.rules-words', host).textContent = set(r) || rulesWords(get());
  };
  host.addEventListener('input', change);
  host.addEventListener('change', change);
}

// ---------- pitch limits ----------
const LIMITS = [['none', 'None'], ['ll', 'Little League'], ['ps', 'Pitch Smart'], ['n', 'A number']];
const ageWords = a => a.replace('-', '–');
// The limit in words, under the choice.
export function limitWords(L) {
  if (!L) return 'No limit. Each pitcher’s count is still kept.';
  const warn = 'The pitcher’s button turns amber 5 pitches before it, and red at it: finish that batter.';
  if (!L.by) return `${L.max} pitches. ${warn}`;
  return `${L.max} pitches a day for ${ageWords(L.age)}-year-olds${L.by === 'll' ? ' (Regulation VI(c))' : ', as Pitch Smart has it'}. ${warn} The pitcher’s sheet and the box score say the days of rest each needs${L.by === 'll' ? ', and who can’t catch today' : ''}.`;
}
// The Pitch limit row, drawn into host: the four choices, the league ages or a number, and the limit in words. get()
// gives the limit now; set(limit) takes a new one (0 for none).
export function limitRow(host, get, set) {
  const preset = (by, age) => ({ by, age, max: PITCH_AGES[age] });
  const draw = () => {
    const L = get(), k = !L ? 'none' : L.by || 'n';
    const ages = Object.keys(PITCH_AGES).filter(a => k === 'ps' || a !== '19-22');
    host.innerHTML = `<div class="opt"><span class="lbl" id="limitLbl">Pitch limit</span>
        <span class="chips" role="group" aria-labelledby="limitLbl">${LIMITS.map(([v, w]) => `<button type="button" data-limit="${v}" aria-pressed="${v === k}">${w}</button>`).join('')}</span></div>
      ${LIMIT_BY[k] ? `<div class="opt"><span class="lbl" id="ageLbl">League age</span><span class="chips" role="group" aria-labelledby="ageLbl">${ages.map(a => `<button type="button" data-age="${a}" aria-pressed="${a === L.age}">${ageWords(a)}</button>`).join('')}</span></div>` : ''}
      ${k === 'n' ? `<p class="rule-row"><span>At most</span><input type="text" inputmode="numeric" maxlength="3" data-lk="max" value="${L.max}" aria-label="Most pitches" autocomplete="off"><span>pitches a pitcher</span></p>` : ''}
      <p class="hint limit-words">${esc(limitWords(L))}</p>`;
  };
  draw();
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-limit], [data-age]'), L = get();
    if (!b) return;
    if (b.dataset.age) set(preset(L.by, b.dataset.age));
    else {
      const v = b.dataset.limit;
      if (v === (!L ? 'none' : L.by || 'n')) return;
      set(v === 'none' ? 0 : v === 'n' ? { by: '', age: '', max: (L && L.max) || 75 } : preset(v, L && PITCH_AGES[L.age] ? L.age : '11-12'));
    }
    const sel = b.dataset.age ? `[data-age="${b.dataset.age}"]` : `[data-limit="${b.dataset.limit}"]`;
    draw();
    $(sel, host).focus();
  });
  // A number of the scorer's own: changed as it's typed (blank or 0 is no limit).
  host.addEventListener('input', e => {
    if (!e.target.closest('[data-lk]')) return;
    const n = parseInt(e.target.value, 10);
    set(n > 0 ? { by: '', age: '', max: Math.min(n, 300) } : 0);
    $('.limit-words', host).textContent = limitWords(get());
  });
}
