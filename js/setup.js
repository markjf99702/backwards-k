// Starting a game: two team names and you're off. Lineups, innings and the rest are optional, and all of it can
// be changed once the game is going.
import { newGame, blank, carryLineup, today } from './model.js';
import { store } from './store.js';
import { $, $$, esc, openSheet, closeSheet } from './ui.js';
import { drive } from './sync.js';

// Teams from earlier games, newest first, with the order they finished with.
function pastTeams() {
  const seen = new Map();
  for (const g of store.all()) for (const t of g.teams) {
    const k = t.name.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, { name: t.name, lineup: carryLineup(t).map(s => s[0]), pitcher: { ...t.pitchers[0] } });
  }
  return [...seen.values()].slice(0, 8);
}

// "1. 12 Ruiz SS" or "Ruiz #12" or just "Ruiz": one player per line.
export function parseLineup(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 30).map(l => {
    l = l.replace(/^\d{1,2}\s*[.)]\s*/, '').replace(/[\s,]+(P|C|1B|2B|3B|SS|LF|CF|RF|DH|EH|UT|IF|OF)$/i, '').trim();
    let m = /^#?(\d{1,3})\s+(.+)$/.exec(l);
    if (m) return { num: m[1], name: m[2].trim() };
    m = /^(.+?)[\s,]+#?(\d{1,3})$/.exec(l);
    if (m) return { name: m[1].trim(), num: m[2] };
    return { name: l, num: '' };
  });
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
      <input class="team-name" data-name maxlength="40" placeholder="${side ? 'Home' : 'Visitors'}" aria-label="${side ? 'Home team' : 'Visitors'} name" autocapitalize="words">
      ${past.length ? `<p class="recent"><span>Teams from before:</span>${past.map((t, i) => `<button type="button" class="chip" data-past="${i}">${esc(t.name)}</button>`).join('')}</p>` : ''}
      <div class="stepper"><span>Batters in the order</span><button type="button" data-step="-1" aria-label="One fewer">−</button><b data-size>9</b><button type="button" data-step="1" aria-label="One more">+</button></div>
      <details class="lineup">
        <summary>Lineup and pitcher <small>optional, add names any time</small></summary>
        <ol class="lineup-edit"></ol>
        <div class="name-row pitcher-row"><span class="lbl">Starting pitcher</span>
          <label class="num"><span>No.</span><input data-pf="num" inputmode="numeric" maxlength="4"></label>
          <label class="nm"><span>Name</span><input data-pf="name" maxlength="40" placeholder="Optional" autocapitalize="words"></label>
        </div>
        <div class="row"><button type="button" class="btn quiet sm" data-paste>Paste a list of names</button></div>
      </details>
    </fieldset>`;
  }
  const fs = side => $(`.team-set[data-side="${side}"]`, el);
  function rows(side) {
    const t = T[side], ol = $('.lineup-edit', fs(side));
    ol.innerHTML = t.lineup.map((p, i) => `<li><span class="ord">${i + 1}</span><div class="name-row">
        <label class="num"><span>No.</span><input data-i="${i}" data-f="num" inputmode="numeric" maxlength="4" value="${esc(p.num)}"></label>
        <label class="nm"><span>Name</span><input data-i="${i}" data-f="name" maxlength="40" value="${esc(p.name)}" placeholder="Batter ${i + 1}" autocapitalize="words"></label>
      </div></li>`).join('');
    $('[data-size]', fs(side)).textContent = t.lineup.length;
    $('[data-name]', fs(side)).value = t.name;
    $$('[data-pf]', fs(side)).forEach(i => { i.value = t.pitcher[i.dataset.pf]; });
  }
  [0, 1].forEach(rows);

  el.addEventListener('input', e => {
    const f = e.target.closest('.team-set');
    if (!f) return;
    const t = T[+f.dataset.side];
    if (e.target.matches('[data-name]')) t.name = e.target.value.trim();
    if (e.target.dataset.f) t.lineup[+e.target.dataset.i][e.target.dataset.f] = e.target.value.trim();
    if (e.target.dataset.pf) t.pitcher[e.target.dataset.pf] = e.target.value.trim();
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
    location.hash = '#/g/' + g.id;
  }

  function pasteSheet(side) {
    const body = openSheet(`<h2 id="sheetTitle">Paste a lineup</h2>
      <p class="hint">One player per line, in batting order. Numbers are picked up too: “12 Ruiz” or “Ruiz #12”.</p>
      <textarea rows="10" data-focus placeholder="Ruiz #2&#10;Okafor #11&#10;Brennan #24"></textarea>
      <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button><button type="button" class="btn primary" data-x="use">Use these</button></div>`);
    body.addEventListener('click', ev => {
      if (!ev.target.closest('[data-x=use]')) return;
      const list = parseLineup(body.querySelector('textarea').value);
      if (list.length) { T[side].lineup = list; rows(side); $('details', fs(side)).open = true; }
      closeSheet();
    });
  }
}
