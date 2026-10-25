// The first screen: start a game, pick up one already going, the sample, Google Drive and backups.
import { replay, teamName, halfLabel, now, ord, winner } from './engine.js';
import { store } from './store.js';
import { $, esc, fmtDate, toast, download, pickFile, inFrame, ICON, whyNot } from './ui.js';
import { today, cleanGame, newer } from './model.js';
import { cellSvg } from './card.js';
import { drive } from './sync.js';
import { helpSheet, FIRST } from './help.js';
import { teamList, teamHref } from './stats.js';

// The 20 games changed last are listed, and the rest after a tap on Show all (remembered until the page is reloaded).
const FEW = 20;
let everyGame = false;
// And the teams in them: the 6 with the most games this season, and the rest after Show all teams.
const TEAMS = 6;
let everyTeam = false;
// Each team's season: its page, with how many games it has in its latest year.
function teamsHtml(games) {
  const all = teamList(games), list = everyTeam ? all : all.slice(0, TEAMS);
  if (!all.length) return '';
  return `<section class="teams" aria-labelledby="teamsH">
      <h2 id="teamsH">Teams</h2>
      <p class="quiet">Each team’s season: batting and pitching added up from its games here, and a page for every player.</p>
      <ul class="team-list">${list.map(t => `<li><a class="ti" href="${esc(teamHref(t.name))}"><b>${esc(t.name)}</b> <span>${t.n} game${t.n === 1 ? '' : 's'} in ${t.year}</span></a></li>`).join('')}</ul>
      ${list.length < all.length ? `<div class="row more"><button type="button" class="btn quiet" data-a="teams">Show all ${all.length} teams</button></div>` : ''}
    </section>`;
}

// The game to go back to: the one changed last, if it isn't over and changed in the last 12 hours (a game being
// scored today), and isn't one only a newer Backwards K can score. With the game itself as it stands.
const LATELY = 12 * 3600 * 1000;
function going(games) {
  for (const g of games) {
    if (!(Date.now() - g.updated <= LATELY)) return null;
    if (newer(g)) continue;
    let S;
    try { S = replay(g); } catch { continue; }
    if (!S.over) return { g, S };
  }
  return null;
}
// It comes first, as the scoreboard shows it: "Foxes 1, Comets 3 · Top 6th · Delgado up", with Keep scoring (or
// Start scoring, for a game set up but not started yet). A game stopped for a delay says so.
function backHtml({ g, S }) {
  const n = now(S), inn = halfLabel(S);
  return `<section class="back-to card-box" aria-labelledby="backTo">
      <h2 id="backTo">Back to the game</h2>
      <div class="bug" aria-hidden="true">
        <div class="bug-teams">${[0, 1].map(s => `<div class="bt${S.half === s ? ' bat' : ''}"><span class="nm">${esc(teamName(g, s))}</span><span class="r">${S.R[s]}</span></div>`).join('')}</div>
        <div class="bug-state"><div class="inn"><span class="arrow">${S.half ? '▼' : '▲'}</span><b>${ord(S.inn)}</b></div></div>
      </div>
      <p class="sr">${esc(`${teamName(g, 0)} ${S.R[0]}, ${teamName(g, 1)} ${S.R[1]} · ${inn}`)}</p>
      <div class="back-row"><p>${S.delayed ? '<b class="delayed">Delayed</b> · ' : ''}<b>${esc(n.name)}</b> up${g.place ? ` · ${esc(g.place)}` : ''}</p><a class="btn primary" href="#/g/${esc(g.id)}">${g.ev.length ? 'Keep' : 'Start'} scoring</a></div>
    </section>`;
}

export function showHome(el) {
  const games = store.all(), listed = everyGame ? games : games.slice(0, FEW), back = going(games);
  const item = g => {
    let S;
    try { S = replay(g); } catch { return ''; }
    // A game nobody has started yet is who's playing whom, with no score, and not in the red of a game going on.
    const fresh = !g.ev.length, live = !S.over && !fresh;
    const teams = fresh
      ? `<span><span class="gi-nm">${esc(teamName(g, 0))}</span> <span class="gi-at">at</span></span> <span><span class="gi-nm">${esc(teamName(g, 1))}</span></span>`
      : [0, 1].map(s => `<span class="${winner(S) === s ? 'won' : ''}"><span class="gi-nm">${esc(teamName(g, s))}</span> <b>${S.R[s]}</b></span>`).join(' ');
    return `<li><a class="gi${live ? ' live' : ''}" href="#/g/${esc(g.id)}">
      <span class="gi-date">${esc(fmtDate(g.date))}${g.place ? ` · ${esc(g.place)}` : ''}</span>
      <span class="gi-teams${fresh ? ' fresh' : ''}">${teams}</span>
      <span class="gi-st">${fresh ? 'Not started' : esc(halfLabel(S))}</span>
    </a></li>`;
  };
  el.innerHTML = `<header class="bar home-bar">
      <div class="bar-in">
        <span class="brand">${ICON}<span>Backwards K</span></span>
        <button type="button" class="cloud bar-btn" hidden></button>
      </div>
    </header>
    <main class="home">
      ${back ? backHtml(back) : ''}
      <section class="hero${back ? ' short' : ''}">
        <h1>Keep score at the ballpark.</h1>
        ${back ? '' : '<p>Tap what happened. Backwards K moves the runners, keeps the count, the outs and the score, and fills in a real scorecard as you go.</p>'}
        <a class="btn ${back ? '' : 'primary '}big" href="#/new">Score a new game</a>
      </section>
      ${games.length ? '' : `<figure class="first-look">
        <div>${FIRST.map(([c, t]) => `<div><div class="cell-pic">${cellSvg(c, { count: false })}</div><span>${t}</span></div>`).join('')}</div>
        <figcaption>Every box on the card is one trip to the plate, drawn the way it’s done on paper.</figcaption>
      </figure>`}
      <section class="games">
        <h2>Your games</h2>
        ${games.length ? `<ul class="game-list">${listed.map(item).join('')}</ul>`
          : '<p class="quiet">No games yet. Score one, or open the sample to see a finished card.</p>'}
        ${listed.length < games.length ? `<div class="row more"><button type="button" class="btn quiet" data-a="all">Show all ${games.length} games</button></div>` : ''}
      </section>
      ${teamsHtml(games)}
      <section class="learn">
        <a class="tile" href="#/sample"><b>See a sample game</b><span>Nine innings between the Foxes and the Comets, scored the whole way through. Tap any box.</span></a>
        <button type="button" class="tile" data-a="help"><b>How to read a scorecard</b><span>6-3, F8, the backwards K, and what the little diamonds mean.</span></button>
      </section>
      <section class="drive-card card-box" hidden></section>
      <section class="backup card-box">
        <h2>Backups</h2>
        <p>Your games are saved on this device as you score. ${inFrame() ? '' : 'Save a backup file to keep them somewhere else too, or to move them to another device.'}</p>
        <div class="row">
          ${inFrame() ? '' : `<button type="button" class="btn" data-a="export"${games.length ? '' : ' disabled'}>Save a backup file</button>`}
          <button type="button" class="btn quiet" data-a="import">Open a backup or game file</button>
        </div>
      </section>
    </main>`;
  drive.chip($('.cloud', el));
  drive.card($('.drive-card', el));
  el.onclick = async e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'help') helpSheet();
    if (a.dataset.a === 'all') {
      everyGame = true;
      showHome(el);
      // The keyboard goes on to the first game that was out of sight.
      el.querySelectorAll('.gi')[FEW]?.focus();
    }
    if (a.dataset.a === 'teams') {
      everyTeam = true;
      showHome(el);
      el.querySelectorAll('.ti')[TEAMS]?.focus();
    }
    if (a.dataset.a === 'export') download(`backwards-k-backup-${today()}.json`, JSON.stringify(store.doc(), null, 1));
    if (a.dataset.a === 'import') {
      const f = await pickFile();
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch { return toast('That file isn’t a Backwards K backup or game.'); }
      const list = data && data.games ? Object.values(data.games) : data && data.game ? [data.game] : [data];
      if (!list.some(g => cleanGame(g))) return toast('That file isn’t a Backwards K backup or game.');
      const { n, ok } = store.add(list);
      drive.changed();
      if (!ok) toast(`Couldn’t save ${n > 1 ? 'those games' : 'that game'}: ${whyNot(store.problem())}.`, { ms: 6000 });
      else toast(n ? `${n} game${n > 1 ? 's' : ''} added.` : 'Nothing new in that file: you already have those games.');
      showHome(el);
    }
  };
}
