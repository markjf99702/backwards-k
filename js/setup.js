// Starting a game: two team names and you're off. Lineups, innings and the rest are optional, and all of it can
// be changed once the game is going.
import { newGame, blank, carryLineup, today, parsePaste } from './model.js';
import { replay } from './engine.js';
import { store } from './store.js';
import { $, $$, esc, openSheet, closeSheet, go } from './ui.js';
import { drive } from './sync.js';

// Teams from earlier games, newest first, with the order they finished with.
function pastTeams() {
  const seen = new Map();
  for (const g of store.all()) {
    if (seen.size >= 8) break;
    let S = null;
    g.teams.forEach((t, side) => {
      const k = t.name.trim().toLowerCase();
      if (!k || seen.has(k)) return;
      S ||= replay(g);
      seen.set(k, { name: t.name, lineup: carryLineup(t, S.pl[side]).map(s => s[0]), pitcher: { ...t.pitchers[0] } });
    });
  }
  return [...seen.values()].slice(0, 8);
}

export function showSetup(el) {
  const past = pastTeams();
  const T = [0, 1].map(() => ({ name: '', lineup: Array.from({ length: 9 }, blank), pitcher: blank() }));
  const opt = { innings: 9, pitches: true, date: today(), place: '' };

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
          <div class="opt"><span class="lbl">Innings</span><span class="chips" role="group" aria-label="Innings">${[9, 7, 6, 5, 4, 3].map(n => `<button type="button" data-inn="${n}" aria-pressed="${n === opt.innings}">${n}</button>`).join('')}</span></div>
          <label class="switch"><input type="checkbox" name="pitches" checked><span>Count balls and strikes<small>Keeps the count and each pitcher’s pitch count. Turn it off to only tap what each batter did.</small></span></label>
          <div class="two-sm">
            <label><span>Date</span><input type="date" name="date" value="${opt.date}"></label>
            <label><span>Where</span><input name="place" maxlength="80" placeholder="Optional"></label>
          </div>
        </fieldset>
        <button class="btn primary big" type="button" data-go>Play ball</button>
        <p class="hint center">All of this can be changed during the game.</p>
      </form>
    </main>`;

  function teamHtml(side) {
    return `<fieldset class="team-set card-box" data-side="${side}">
      <legend><b>${side ? 'Home team' : 'Visitors'}</b> <small>${side ? 'bats second' : 'bats first'}</small></legend>
      <input class="team-name-in" data-name maxlength="40" placeholder="${side ? 'Home' : 'Visitors'}" aria-label="${side ? 'Home team' : 'Visitors'} name" autocapitalize="words">
      ${past.length ? `<p class="past-teams"><span>Teams from before:</span>${past.map((t, i) => `<button type="button" class="chip" data-past="${i}">${esc(t.name)}</button>`).join('')}</p>` : ''}
      <div class="stepper"><span class="st">Batters in the order<button type="button" class="link-btn" data-paste aria-label="Paste a lineup for the ${side ? 'home team' : 'visitors'}">Paste a lineup</button></span><button type="button" data-step="-1" aria-label="One fewer batter">−</button><b data-size role="status">9</b><button type="button" data-step="1" aria-label="One more batter">+</button></div>
      <details class="lineup">
        <summary>Lineup and pitcher <small>optional, add names any time</small></summary>
        <ol class="lineup-edit"></ol>
        <div class="name-row pitcher-row"><span class="lbl">Starting pitcher</span>
          <label class="num"><span>No.</span><input data-pf="num" inputmode="numeric" maxlength="4" aria-label="Starting pitcher number"></label>
          <label class="nm"><span>Name</span><input data-pf="name" maxlength="40" placeholder="Optional" autocapitalize="words" aria-label="Starting pitcher name"></label>
        </div>
        <div class="from-order"></div>
      </details>
    </fieldset>`;
  }
  const fs = side => $(`.team-set[data-side="${side}"]`, el);
  function rows(side) {
    const t = T[side], ol = $('.lineup-edit', fs(side));
    ol.innerHTML = t.lineup.map((p, i) => `<li><span class="ord">${i + 1}</span><div class="name-row">
        <label class="num"><span>No.</span><input data-i="${i}" data-f="num" inputmode="numeric" maxlength="4" value="${esc(p.num)}" aria-label="Batter ${i + 1} number"></label>
        <label class="nm"><span>Name</span><input data-i="${i}" data-f="name" maxlength="40" value="${esc(p.name)}" placeholder="Batter ${i + 1}" autocapitalize="words" aria-label="Batter ${i + 1} name"></label>
      </div></li>`).join('');
    $('[data-size]', fs(side)).innerHTML = `${t.lineup.length}<span class="sr"> batter${t.lineup.length === 1 ? '' : 's'}</span>`;
    $('[data-name]', fs(side)).value = t.name;
    $$('[data-pf]', fs(side)).forEach(i => { i.value = t.pitcher[i.dataset.pf]; });
    chips(side);
  }
  // The starting pitcher can be picked from the order: a tap fills the number and name.
  const same = (a, b) => (a.name && b.name ? a.name.toLowerCase() === b.name.toLowerCase() : !!a.num && a.num === b.num);
  function chips(side) {
    const t = T[side], list = t.lineup.map((p, i) => [i, p]).filter(([, p]) => p.name || p.num);
    $('.from-order', fs(side)).innerHTML = list.length ? `<p class="pick-row" role="group" aria-label="From the order"><span>From the order:</span>${list.map(([i, p]) => `<button type="button" class="chip" data-pick="${i}" aria-pressed="${same(p, t.pitcher)}">${esc(p.name ? p.name + (p.num ? ' #' + p.num : '') : '#' + p.num)}</button>`).join('')}</p>` : '';
  }
  [0, 1].forEach(rows);

  el.addEventListener('input', e => {
    const f = e.target.closest('.team-set');
    if (!f) return;
    const t = T[+f.dataset.side];
    if (e.target.matches('[data-name]')) t.name = e.target.value.trim();
    if (e.target.dataset.f) t.lineup[+e.target.dataset.i][e.target.dataset.f] = e.target.value.trim();
    if (e.target.dataset.pf) t.pitcher[e.target.dataset.pf] = e.target.value.trim();
    if (e.target.dataset.f || e.target.dataset.pf) chips(+f.dataset.side);
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const f = b.closest('.team-set'), side = f ? +f.dataset.side : -1;
    if (b.dataset.inn) { opt.innings = +b.dataset.inn; $$('[data-inn]', el).forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.inn === opt.innings))); }
    if (b.dataset.step) {
      const t = T[side], n = Math.min(30, Math.max(1, t.lineup.length + +b.dataset.step));
      while (t.lineup.length < n) t.lineup.push(blank());
      t.lineup.length = n;
      rows(side);
    }
    if (b.dataset.past) {
      const p = past[+b.dataset.past], t = T[side];
      t.name = p.name; t.lineup = p.lineup.map(x => ({ ...x })); t.pitcher = { ...p.pitcher };
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
    const g = newGame({ away: T[0].name, home: T[1].name, innings: opt.innings, pitches: form.pitches.checked, date: form.date.value || today(), place: form.place.value.trim() });
    T.forEach((t, s) => {
      g.teams[s].lineup = t.lineup.map(p => [{ ...p }]);
      g.teams[s].pitchers = [{ ...t.pitcher }];
    });
    store.save(g);
    drive.changed();
    // Ask the browser to keep this site's games when it clears space (it decides; nothing to do with the answer).
    try { navigator.storage?.persist?.()?.catch(() => {}); } catch { /* not offered here */ }
    go('#/g/' + g.id);
  }

  function pasteSheet(side) {
    const body = openSheet(`<h2 id="sheetTitle">Paste a lineup</h2>
      <p class="hint">One player per line, in batting order. Names separated by commas work too. Jersey numbers are picked up: “12 Ruiz” or “Ruiz #12”. A lineup copied from a game preview works as it is: the 1 to 9 down the side, positions and (L) or (R) are left out, and the pitcher (SP, or “Pitcher: Okafor”) goes in as the starting pitcher.</p>
      <textarea rows="10" data-focus placeholder="Ruiz #2&#10;Okafor #11&#10;Brennan #24"></textarea>
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
