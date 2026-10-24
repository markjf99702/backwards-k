// The first screen: start a game, pick up one already going, the sample, Google Drive and backups.
import { replay, teamName, halfLabel } from './engine.js';
import { store } from './store.js';
import { $, esc, fmtDate, toast, download, pickFile, inFrame, ICON } from './ui.js';
import { today } from './model.js';
import { drive } from './sync.js';
import { helpSheet } from './help.js';

export function showHome(el) {
  const games = store.all();
  const item = g => {
    let S;
    try { S = replay(g); } catch { return ''; }
    const live = !S.over;
    return `<li><a class="gi${live ? ' live' : ''}" href="#/g/${esc(g.id)}">
      <span class="gi-date">${esc(fmtDate(g.date))}${g.place ? ` · ${esc(g.place)}` : ''}</span>
      <span class="gi-teams">${[0, 1].map(s => `<span class="${S.over && S.R[s] > S.R[1 - s] ? 'won' : ''}">${esc(teamName(g, s))} <b>${S.R[s]}</b></span>`).join('')}</span>
      <span class="gi-st">${live && !g.ev.length ? 'Not started' : esc(halfLabel(S))}</span>
    </a></li>`;
  };
  el.innerHTML = `<header class="bar home-bar">
      <div class="bar-in">
        <span class="brand">${ICON}<span>Backwards K</span></span>
        <button type="button" class="cloud bar-btn" hidden></button>
      </div>
    </header>
    <main class="home">
      <section class="hero">
        <h1>Keep score at the ballpark.</h1>
        <p>Tap what happened. Backwards K moves the runners, keeps the count, the outs and the score, and fills in a real scorecard as you go.</p>
        <a class="btn primary big" href="#/new">Score a new game</a>
      </section>
      <section class="games">
        <h2>Your games</h2>
        ${games.length ? `<ul class="game-list">${games.map(item).join('')}</ul>`
          : '<p class="quiet">No games yet. Score one, or open the sample to see a finished card.</p>'}
      </section>
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
    if (a.dataset.a === 'export') download(`backwards-k-backup-${today()}.json`, JSON.stringify(store.doc(), null, 1));
    if (a.dataset.a === 'import') {
      const f = await pickFile();
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch { return toast('That file isn’t a Backwards K backup or game.'); }
      const list = data && data.games ? Object.values(data.games) : data && data.game ? [data.game] : [data];
      const n = store.add(list);
      drive.changed();
      toast(n ? `${n} game${n > 1 ? 's' : ''} added.` : 'Nothing new in that file: you already have those games.');
      showHome(el);
    }
  };
}
