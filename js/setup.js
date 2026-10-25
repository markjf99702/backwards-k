// Starting a game: two team names and you're off. Lineups, innings and the rest are optional, and all of it can
// be changed once the game is going.
import { newGame, blank, starters, today, parsePaste, carried, setField } from './model.js';
import { store } from './store.js';
import { $, $$, esc, openSheet, closeSheet, go, nextName, posField, toast } from './ui.js';
import { ord } from './engine.js';
import { drive } from './sync.js';
import { rulesRow, limitRow } from './rules.js';

// Teams from earlier games, newest first, with the order they started with. Each player's name and number, and
// nothing else: anything a newer Backwards K saved on a player belongs to that game, and in a new one would make it
// look-only here (see newer() in model.js). Not the pitcher who started last time: youth teams and rotations rarely
// start the same one twice running, and one filled in without a word is easy to miss (From the order picks one).
function pastTeams() {
  const seen = new Map();
  for (const g of store.all()) {
    if (seen.size >= 8) break;
    g.teams.forEach(t => {
      const k = t.name.trim().toLowerCase();
      if (!k || seen.has(k)) return;
      seen.set(k, { name: t.name, lineup: starters(t) });
    });
  }
  return [...seen.values()].slice(0, 8);
}

export function showSetup(el) {
  const past = pastTeams();
  const T = [0, 1].map(() => ({ name: '', lineup: Array.from({ length: 9 }, blank), pitcher: blank() }));
  // The innings, the pitch counting and limit, the league rules and the runner on second in extra innings start as
  // they were for the last game on this device: a league that plays six innings without counting pitches, under
  // Little League's rules, doesn't have to say so every week.
  const last = store.all()[0], INN = [9, 7, 6, 5, 4, 3];
  const opt = {
    innings: last && INN.includes(last.innings) ? last.innings : 9, pitches: last ? last.pitches !== false : true,
    ...carried(last), tie: !!(last && last.tie), date: today(), place: '',
  };

  el.innerHTML = `<header class="bar">
      <div class="bar-in">
        <a class="back" href="#/" aria-label="Back"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
        <div class="title"><b>New game</b></div>
      </div>
    </header>
    <main class="setup">
      <h1 class="sr">New game</h1>
      <form autocomplete="off">
        <div class="two">${[0, 1].map(teamHtml).join('')}</div>
        <fieldset class="opts card-box">
          <legend class="sr">The game</legend>
          <div class="opt"><span class="lbl">Innings</span><span class="chips" role="group" aria-label="Innings">${INN.map(n => `<button type="button" data-inn="${n}" aria-pressed="${n === opt.innings}">${n}</button>`).join('')}</span></div>
          <div class="rules-row"></div>
          <label class="switch"><input type="checkbox" name="tie"${opt.tie ? ' checked' : ''}><span>Extra innings start with a runner on second<small>The batter before the leadoff man, as the majors have done since 2020.</small></span></label>
          <label class="switch"><input type="checkbox" name="pitches"${opt.pitches ? ' checked' : ''}><span>Count balls and strikes<small>Keeps the count and each pitcher’s pitch count. Turn it off to only tap what each batter did.</small></span></label>
          <div class="limit-row"${opt.pitches ? '' : ' hidden'}></div>
          <div class="two-sm">
            <label><span>Date</span><input type="date" name="date" value="${opt.date}"></label>
            <label><span>Where</span><input name="place" maxlength="80" placeholder="Optional" autocapitalize="words" autocorrect="off" spellcheck="false"></label>
          </div>
          <details class="lineup partway">
            <summary>Starting partway through? <small>optional</small></summary>
            <div class="two-sm">
              <label class="wide"><span>Scoring from the</span><select name="from"></select></label>
              <label><span>Visitors’ runs</span><input name="r0" type="number" inputmode="numeric" min="0" max="99" placeholder="0"></label>
              <label><span>Home team’s runs</span><input name="r1" type="number" inputmode="numeric" min="0" max="99" placeholder="0"></label>
              <label class="wide"><span>Who’s up</span><select name="lead"></select></label>
            </div>
            <p class="hint">For a game that’s already going. The innings before are shaded on the card, and each team’s runs so far are in the score.</p>
          </details>
        </fieldset>
        <button class="btn primary big" type="button" data-go>Play ball</button>
        <p class="hint center">All of this can be changed during the game.</p>
      </form>
    </main>`;

  function teamHtml(side) {
    return `<fieldset class="team-set card-box" data-side="${side}">
      <legend><b>${side ? 'Home team' : 'Visitors'}</b> <small>${side ? 'bats second' : 'bats first'}</small></legend>
      <input class="team-name-in" data-name maxlength="40" placeholder="${side ? 'Home' : 'Visitors'}" aria-label="${side ? 'Home team' : 'Visitors'} name" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="${side ? 'go' : 'next'}">
      ${past.length ? `<p class="past-teams"><span>Teams from before:</span>${past.map((t, i) => `<button type="button" class="chip" data-past="${i}">${esc(t.name)}</button>`).join('')}</p>` : ''}
      <div class="stepper"><span class="st">Batters in the order<button type="button" class="link-btn" data-paste aria-label="Paste a lineup for the ${side ? 'home team' : 'visitors'}">Paste a lineup</button></span><button type="button" data-step="-1" aria-label="One fewer batter">−</button><b data-size role="status">9</b><button type="button" data-step="1" aria-label="One more batter">+</button></div>
      <details class="lineup">
        <summary>Lineup and pitcher <small>optional</small></summary>
        <ol class="lineup-edit"></ol>
        <div class="name-row pitcher-row"><span class="lbl">Starting pitcher</span>
          <label class="num"><span>No.</span><input data-pf="num" inputmode="numeric" maxlength="4" aria-label="Starting pitcher number"></label>
          <label class="nm"><span>Name</span><input data-pf="name" maxlength="40" placeholder="Optional" autocapitalize="words" autocorrect="off" spellcheck="false" aria-label="Starting pitcher name"></label>
        </div>
        <div class="from-order"></div>
      </details>
    </fieldset>`;
  }
  const fs = side => $(`.team-set[data-side="${side}"]`, el);
  function rows(side) {
    const t = T[side], ol = $('.lineup-edit', fs(side));
    ol.innerHTML = t.lineup.map((p, i) => `<li><span class="ord">${i + 1}</span><div class="name-row has-pos">
        <label class="num"><span>No.</span><input data-i="${i}" data-f="num" inputmode="numeric" maxlength="4" value="${esc(p.num)}" aria-label="Batter ${i + 1} number"></label>
        <label class="nm"><span>Name</span><input data-i="${i}" data-f="name" maxlength="40" value="${esc(p.name)}" placeholder="Batter ${i + 1}" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="${i < t.lineup.length - 1 ? 'next' : 'done'}" aria-label="Batter ${i + 1} name"></label>
        ${posField(p.pos, `data-i="${i}" `, `Batter ${i + 1}`)}
      </div></li>`).join('');
    $('[data-size]', fs(side)).innerHTML = `${t.lineup.length}<span class="sr"> batter${t.lineup.length === 1 ? '' : 's'}</span>`;
    $('[data-name]', fs(side)).value = t.name;
    $$('[data-pf]', fs(side)).forEach(i => { i.value = t.pitcher[i.dataset.pf]; });
    chips(side);
    if ($('[name=from]', el)) partway();
  }
  // The starting pitcher can be picked from the order: a tap fills the number and name.
  const same = (a, b) => (a.name && b.name ? a.name.toLowerCase() === b.name.toLowerCase() : !!a.num && a.num === b.num);
  function chips(side) {
    const t = T[side], list = t.lineup.map((p, i) => [i, p]).filter(([, p]) => p.name || p.num);
    $('.from-order', fs(side)).innerHTML = list.length ? `<p class="pick-row" role="group" aria-label="From the order"><span>From the order:</span>${list.map(([i, p]) => `<button type="button" class="chip" data-pick="${i}" aria-pressed="${same(p, t.pitcher)}">${esc(p.name ? p.name + (p.num ? ' #' + p.num : '') : '#' + p.num)}</button>`).join('')}</p>` : '';
  }
  // Starting partway through: which half-inning (the start of the game is no part at all), and who's up for the team
  // batting in it.
  function partway() {
    const from = $('[name=from]', el), lead = $('[name=lead]', el), was = from.value || '1.0', last = Math.max(opt.innings, 1);
    const halves = [];
    for (let inn = 1; inn <= last; inn++) for (const h of [0, 1]) halves.push([`${inn}.${h}`, inn === 1 && !h ? 'Top of the 1st (the start)' : `${h ? 'Bottom' : 'Top'} of the ${ord(inn)}`]);
    from.innerHTML = halves.map(([v, w]) => `<option value="${v}"${v === was ? ' selected' : ''}>${w}</option>`).join('');
    if (!from.value) from.value = '1.0';
    const h = +from.value.split('.')[1], pick = lead.value || '0', t = T[h];
    lead.innerHTML = t.lineup.map((p, i) => `<option value="${i}"${String(i) === pick ? ' selected' : ''}>${i + 1}. ${esc(p.name || (p.num ? '#' + p.num : `Batter ${i + 1}`))}</option>`).join('');
    $('[name=lead]', el).closest('label').firstElementChild.textContent = `Who’s up for the ${t.name || (h ? 'home team' : 'visitors')}`;
  }
  [0, 1].forEach(rows);
  partway();
  rulesRow($('.rules-row', el), () => opt.rules, r => { opt.rules = r; });
  // (A pitch limit needs the pitches counted.)
  limitRow($('.limit-row', el), () => opt.limit, L => { opt.limit = L; });
  el.querySelector('input[name=pitches]').addEventListener('change', e => { $('.limit-row', el).hidden = !e.target.checked; });

  el.addEventListener('input', e => {
    if (e.target.matches('[name=from]')) return partway();
    const f = e.target.closest('.team-set');
    if (!f) return;
    const t = T[+f.dataset.side];
    if (e.target.matches('[data-name]')) t.name = e.target.value.trim();
    if (e.target.dataset.f) setField(t.lineup[+e.target.dataset.i], e.target.dataset.f, e.target.value);
    if (e.target.dataset.pf) t.pitcher[e.target.dataset.pf] = e.target.value.trim();
    if (e.target.dataset.f || e.target.dataset.pf) chips(+f.dataset.side);
    if (e.target.matches('[data-name]') || e.target.dataset.f) partway();
  });
  // Enter in a batter's name goes to the next batter's name (past the number, which needs another keyboard).
  el.addEventListener('keydown', e => nextName(e, '.lineup-edit [data-f=name]'));
  // Enter in the visitors' name goes on to the home team's, and in the home team's starts the game (the keyboard's
  // Next and Go).
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.matches('[data-name]')) return;
    e.preventDefault();
    if (e.target.closest('[data-side="0"]')) $('[data-side="1"] [data-name]', el).focus(); else start();
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const f = b.closest('.team-set'), side = f ? +f.dataset.side : -1;
    if (b.dataset.inn) { opt.innings = +b.dataset.inn; $$('[data-inn]', el).forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.inn === opt.innings))); partway(); }
    if (b.dataset.step) {
      const t = T[side], n = Math.min(30, Math.max(1, t.lineup.length + +b.dataset.step));
      while (t.lineup.length < n) t.lineup.push(blank());
      t.lineup.length = n;
      rows(side);
    }
    if (b.dataset.past) {
      const p = past[+b.dataset.past], t = T[side];
      t.name = p.name; t.lineup = p.lineup.map(x => ({ ...x }));
      rows(side);
      $('details', fs(side)).open = true;
    }
    if (b.matches('[data-paste]')) pasteSheet(side);
    if (b.dataset.pick) {
      const t = T[side];
      t.pitcher = { ...t.lineup[+b.dataset.pick] };
      $$('[data-pf]', fs(side)).forEach(i => { i.value = t.pitcher[i.dataset.pf]; });
      chips(side);
    }
  });
  // A plain button, not a form submission: inside another page's frame, forms can be switched off.
  const form = el.querySelector('form');
  form.addEventListener('submit', e => { e.preventDefault(); start(); });
  el.querySelector('[data-go]').addEventListener('click', start);
  function start() {
    const g = newGame({ away: T[0].name, home: T[1].name, innings: opt.innings, pitches: form.pitches.checked, rules: opt.rules, tie: form.tie.checked ? opt.innings + 1 : 0, limit: form.pitches.checked ? opt.limit : 0, date: form.date.value || today(), place: form.place.value.trim() });
    T.forEach((t, s) => {
      g.teams[s].lineup = t.lineup.map(p => [{ ...p }]);
      g.teams[s].pitchers = [{ ...t.pitcher }];
    });
    // Picked up partway through: the first event says from where, the runs so far and who's up. (Not the bottom of the
    // last inning with the home team ahead: that game was over.)
    const [inn, half] = form.from.value.split('.').map(Number), runs = x => Math.min(99, Math.max(0, parseInt(x, 10) || 0));
    const r = [runs(form.r0.value), runs(form.r1.value)];
    if (half && inn >= opt.innings && r[1] > r[0]) {
      toast('With the home team ahead in the bottom of the last inning, that game was over. Check the inning and the runs.', { ms: 6000 });
      return;
    }
    if (inn > 1 || half) g.ev.push({ t: 'join', inn, half, r, up: +form.lead.value || 0 });
    store.save(g);
    drive.changed();
    // Ask the browser to keep this site's games when it clears space (it decides; nothing to do with the answer).
    try { navigator.storage?.persist?.()?.catch(() => {}); } catch { /* not offered here */ }
    go('#/g/' + g.id);
  }

  function pasteSheet(side) {
    const body = openSheet(`<h2 id="sheetTitle">Paste a lineup</h2>
      <p class="hint">One player per line, in batting order. Names separated by commas work too. Jersey numbers are picked up: “12 Ruiz” or “Ruiz #12”. A lineup copied from a game preview works as it is: the 1 to 9 down the side and (L) or (R) are left out, positions are kept (“Ruiz SS”), and the pitcher (SP, or “Pitcher: Okafor”) goes in as the starting pitcher.</p>
      <textarea rows="10" data-focus autocorrect="off" spellcheck="false" placeholder="Ruiz #2&#10;Okafor #11&#10;Brennan #24"></textarea>
      <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button><button type="button" class="btn primary" data-x="use">Use these</button></div>`);
    body.addEventListener('click', ev => {
      if (!ev.target.closest('[data-x=use]')) return;
      const { batters, pitcher } = parsePaste(body.querySelector('textarea').value);
      if (batters.length) T[side].lineup = batters;
      if (pitcher) T[side].pitcher = pitcher;
      if (batters.length || pitcher) { rows(side); $('details', fs(side)).open = true; }
      closeSheet();
    });
  }
}
