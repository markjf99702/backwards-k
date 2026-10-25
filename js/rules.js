// League rules for a game, picked in New game and in Game settings: none, Little League's, the Minors', or a league's
// own (Custom): the most runs a half-inning, and a mercy rule. engine.js plays them, and model.js keeps them.
import { $, esc } from './ui.js';

// Little League's mercy rule (4.10(e)): 15 runs ahead after 3 innings, or 10 after 4, half an inning sooner when it's
// the home team. The Minors add a common local rule: a half-inning ends at 5 runs, except in the last inning, and the
// 5th run is the last to count on that play.
const LL = { set: 'll', runs: 0, last: false, all: false, mercy: [[3, 15], [4, 10]] };
export const LEAGUES = { ll: LL, minors: { ...LL, set: 'minors', runs: 5 } };
const CUSTOM = { set: 'custom', runs: 5, last: false, all: false, mercy: [[4, 10]] };
const CHOICES = [['none', 'None'], ['ll', 'Little League'], ['minors', 'LL Minors'], ['custom', 'Custom']];
const copy = r => (r ? { ...r, mercy: r.mercy.map(m => m.slice()) } : null);
const either = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} or ${a.at(-1)}`);

// The rules in words, under the choice.
export function rulesWords(r) {
  if (!r) return 'Three outs end each half-inning, and the game goes the innings set.';
  const bits = [];
  if (r.runs) bits.push(`A half-inning ends at ${r.runs} run${r.runs === 1 ? '' : 's'}${r.last ? '' : ', except in the last inning'}: ${r.all ? 'every run on that play counts' : 'a run after that on the same play doesn’t count'}.`);
  if (r.mercy.length) bits.push(`The game is over with a team ${either(r.mercy.map(([n, by], i) => `${by}${i ? '' : ' runs'} ahead after ${n} inning${n === 1 ? '' : 's'}`))}, or half an inning sooner when it’s the home team${r.set === 'custom' ? '' : ' (Little League rule 4.10(e))'}.`);
  return bits.join(' ') || 'No run limit and no mercy rule.';
}

// The League rules row, drawn into host: the four choices, Custom's numbers, and the rules in words. get() gives the
// rules now; set(rules) takes new ones (null for none).
export function rulesRow(host, get, set) {
  const draw = () => {
    const r = get(), k = !r ? 'none' : LEAGUES[r.set] ? r.set : 'custom', m = (r && r.mercy[0]) || [];
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
    if (v === (!r ? 'none' : LEAGUES[r.set] ? r.set : 'custom')) return;
    set(v === 'none' ? null : v === 'custom' ? copy(CUSTOM) : copy(LEAGUES[v]));
    draw();
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
    set(r);
    $('.rules-words', host).textContent = rulesWords(r);
  };
  host.addEventListener('input', change);
  host.addEventListener('change', change);
}
