// A team's season, and each of its players', from every game of the team's on this device (Google Drive's among
// them, once it has brought them here): batting and pitching that add up, a game log, and for a player, each game
// with her boxes from the card. Nothing new is saved: it's all played back from the games (stats.js).
import { store } from './store.js';
import {
  season, teamHref, keyFrom, avg, obp, slg, ops, era, strikes, three, two, pct, ip, batWords, pitchWords, seasonText, teamCsv,
  playerCsv, posList, thisWeek,
} from './stats.js';
import { located } from './engine.js';
import { $, esc, fmtDate, toast, copy, download, inFrame, slug, openSheet } from './ui.js';
import { today } from './model.js';
import { cellSvg } from './card.js';
import { ballWords, ball, sprayFigure } from './box.js';

// How each table is sorted, until the page is reloaded: by a column, and which way.
const sorted = { bat: { by: 'order', up: true }, pit: { by: 'outs', up: false } };

// A heading's short form, with its words for a screen reader and a mouse pointer.
const WORDS = {
  G: 'Games', PA: 'Trips to the plate', AB: 'At bats', R: 'Runs', H: 'Hits', '2B': 'Doubles', '3B': 'Triples', HR: 'Home runs', RBI: 'Runs batted in',
  BB: 'Walks', K: 'Strikeouts', HBP: 'Hit by a pitch', SB: 'Stolen bases', CS: 'Caught stealing', AVG: 'Batting average', OBP: 'On-base percentage',
  SLG: 'Slugging percentage', OPS: 'On base plus slugging', W: 'Wins', L: 'Losses', S: 'Saves', IP: 'Innings pitched', BF: 'Batters faced',
  ER: 'Earned runs', ERA: 'Earned runs for every nine innings', P: 'Pitches', 'Str%': 'Strikes, of the pitches', 'P-S': 'Pitches and strikes',
};
const abbr = k => `<abbr title="${WORDS[k]}">${k}</abbr>`;

// The batting table's columns: heading, what it sorts by, and the value shown.
const BAT = [
  ['G', 'g'], ['PA', 'pa'], ['AB', 'ab'], ['R', 'r'], ['H', 'h'], ['2B', 'd'], ['3B', 't'], ['HR', 'hr'], ['RBI', 'rbi'], ['BB', 'bb'], ['K', 'k'],
  ['HBP', 'hbp'], ['SB', 'sb'], ['CS', 'cs'], ['AVG', 'avg', b => three(avg(b))], ['OBP', 'obp', b => three(obp(b))], ['SLG', 'slg', b => three(slg(b))],
  ['OPS', 'ops', b => three(ops(b))],
];
const RATE = { avg, obp, slg, ops, era, spct: strikes };
// And the pitching table's: the pitches and strike % only when some games counted pitches.
const PIT = pitches => [
  ['G', 'g'], ['W', 'w'], ['L', 'l'], ['S', 's'], ['IP', 'outs', p => ip(p.outs)], ['BF', 'bf'], ['H', 'h'], ['R', 'r'], ['ER', 'er'],
  ['ERA', 'era', p => two(era(p))], ['BB', 'bb'], ['K', 'k'], ['HR', 'hr'], ...(pitches ? [['P', 'np', p => (p.pg ? p.np : '–')], ['Str%', 'spct', p => pct(strikes(p))]] : []),
];
// A player's value for a column: a count, or a rate (none sorts last). 'order': where he usually bats; 'name'.
function value(x, line, by) {
  if (by === 'order') return x.order;
  if (by === 'name') return x.name.toLowerCase();
  if (RATE[by]) return RATE[by](line);
  return line[by];
}
// The rows in the order picked: the players with no name always last.
function order(list, line, how) {
  const named = list.filter(x => x.key), none = list.filter(x => !x.key);
  named.sort((a, b) => {
    const va = value(a, line(a), how.by), vb = value(b, line(b), how.by);
    if (va == null && vb != null) return 1;
    if (vb == null && va != null) return -1;
    if (va !== vb) return (va < vb ? -1 : 1) * (how.up ? 1 : -1);
    return a.order - b.order || (a.name < b.name ? -1 : 1);
  });
  return [...named, ...none];
}
// A column heading that sorts the table by it: tapped again, the other way. Most columns sort highest first; ERA,
// the player's name and the batting order, lowest first.
const LOW = new Set(['era', 'name', 'order']);
function head(which, label, by, words = label) {
  const how = sorted[which], on = how.by === by;
  const dir = on ? (how.up ? 'ascending' : 'descending') : 'none';
  return `<th scope="col" aria-sort="${dir}"><button type="button" data-sort="${which}:${by}" aria-label="${esc(`Sort by ${WORDS[label] || words}`)}">${WORDS[label] ? abbr(label) : esc(label)}${on ? `<i aria-hidden="true">${how.up ? '▲' : '▼'}</i>` : ''}</button></th>`;
}

// Under a player's name in a table: his number, and the positions he played most (up to so many).
function more(x, most) {
  const num = x.num && !x.key.startsWith('#') ? `#${x.num}` : '', ps = most ? posList(x).split(', ').slice(0, most).join(', ') : '';
  return num || ps ? `<small>${esc([num, ps].filter(Boolean).join(' · '))}</small>` : '';
}
// The whole season's batting: a row for each player, sortable, and the team's totals.
function batTable(T, href) {
  const rows = order(T.bat, x => x.bat, sorted.bat).map(x => {
    const name = x.key ? `<a href="${esc(href(x))}">${esc(x.name)}</a>${more(x, 2)}` : '<span class="quiet">No name</span>';
    return `<tr><th scope="row">${name}</th>${BAT.map(([, k, f]) => `<td>${f ? f(x.bat) : x.bat[k]}</td>`).join('')}</tr>`;
  });
  return `<div class="stat-wrap"><table class="stats season" aria-label="Batting">
    <thead><tr>${head('bat', 'Player', 'name', 'name')}${BAT.map(([h, k]) => head('bat', h, k)).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot><tr><th scope="row">Totals</th>${BAT.map(([, k, f]) => `<td>${f ? f(T.tot.bat) : T.tot.bat[k]}</td>`).join('')}</tr></tfoot>
  </table></div>`;
}
function pitTable(T, href) {
  const cols = PIT(T.tot.pit.pg > 0);
  const rows = order(T.pit, x => x.pit, sorted.pit).map(x => {
    const name = x.key ? `<a href="${esc(href(x))}">${esc(x.name)}</a>${more(x, 0)}` : '<span class="quiet">No name</span>';
    return `<tr><th scope="row">${name}</th>${cols.map(([, k, f]) => `<td>${f ? f(x.pit) : x.pit[k]}</td>`).join('')}</tr>`;
  });
  return `<div class="stat-wrap"><table class="stats season" aria-label="Pitching">
    <thead><tr>${head('pit', 'Pitcher', 'name', 'name')}${cols.map(([h, k]) => head('pit', h, k)).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot><tr><th scope="row">Totals</th>${cols.map(([, k, f]) => `<td>${f ? f(T.tot.pit) : T.tot.pit[k]}</td>`).join('')}</tr></tfoot>
  </table></div>`;
}

// A game in a team's log: "W 7–3", or where it stands ("Top 5th, 3–2"), and "at Bears" or "vs Bears".
const score = game => `${game.R}–${game.RA}`;
const result = game => (game.result ? `${game.result} ${score(game)}` : `${game.status}, ${score(game)}`);
const vs = game => `${game.home ? 'vs' : 'at'} ${game.opp}`;
const RES = { W: 'won', L: 'lost', T: 'tied' };
function logItem(game, line = '') {
  return `<li><a class="gl" href="#/g/${esc(game.id)}">
    <span class="gl-when">${esc(fmtDate(game.date))}${game.place ? ` · ${esc(game.place)}` : ''}</span>
    <span class="gl-opp">${esc(vs(game))}</span>
    <b class="gl-res ${RES[game.result] || 'going'}">${esc(result(game))}</b>
    ${line}
  </a></li>`;
}

// A season's years to pick from: each year with games, newest first, and every year together.
function years(T, to) {
  if (T.years.length < 2) return '';
  const list = [...T.years, 'all'];
  return `<nav class="seg years" aria-label="Season">${list.map(y => `<a href="${esc(to(y))}"${y === T.yr ? ' aria-current="page"' : ''}>${y === 'all' ? 'Every year' : y}</a>`).join('')}</nav>`;
}
const seasonWords = T => (T.yr === 'all' ? `${T.years.at(-1)}–${T.years[0]}` : `${T.yr} season`);
// The team's record: "8–4", with ties after "8–4–1".
const recordOf = r => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;

// Pitching this week, for the coach: who pitched in the last 7 days, how many pitches each day, and under a league's
// pitch limit by age, the day each can pitch again.
function weekHtml(T) {
  if (T.yr !== 'all' && T.yr !== today().slice(0, 4)) return '';
  const list = thisWeek(T);
  if (!list.length) return '';
  const now = today();
  return `<section class="week card-box" aria-labelledby="weekH">
    <h2 id="weekH">Pitching this week</h2>
    <ul>${list.map(({ x, arms, ready }) => `<li><b>${esc(x.name || 'No name')}</b> ${arms.slice().reverse().map(a => `${a.game.pitches ? `${a.np} pitch${a.np === 1 ? '' : 'es'}` : 'pitched'} on ${esc(fmtDate(a.game.date))}`).join(', ')}${ready ? `<span class="${ready > now ? 'rest' : 'ok'}">${ready > now ? `Can pitch again ${esc(fmtDate(ready))}` : 'Can pitch'}</span>` : ''}</li>`).join('')}</ul>
    <p class="hint">The days of rest are the pitch limit’s each game was scored with (in Game settings).</p>
  </section>`;
}

export function showTeam(el, name, yr, who) {
  const T = season(store.all(), name, yr);
  const x = who != null ? findPlayer(T, who) : null;
  if (who != null) return x ? playerPage(el, T, x) : missing(el, T, who);
  const href = p => teamHref(T.name, T.yr, { name: p.name });
  document.title = `${T.name} · ${seasonWords(T)} · Backwards K`;
  const n = T.games.length;
  el.innerHTML = `${bar('#/', T.name, seasonWords(T))}
    <main class="team">
      <header class="team-head">
        <h1>${esc(T.name)}</h1>
        <p>${n ? `${esc(seasonWords(T))} · ${n} game${n === 1 ? '' : 's'} · <b>${recordOf(T.record)}</b>` : 'No games for this team on this device.'}</p>
        ${years(T, y => teamHref(T.name, y))}
      </header>
      ${n ? `<section aria-labelledby="batH"><h2 id="batH">Batting</h2><div data-t="bat">${batTable(T, href)}</div></section>
      ${T.pit.length ? `<section aria-labelledby="pitH"><h2 id="pitH">Pitching</h2><div data-t="pit">${pitTable(T, href)}</div></section>` : ''}
      ${weekHtml(T)}
      <section aria-labelledby="gamesH"><h2 id="gamesH">Games</h2><ul class="game-log">${T.games.map(g => logItem(g)).join('')}</ul></section>
      <p class="hint">Every ${esc(T.name)} game on this device${T.yr === 'all' ? '' : ` from ${T.yr}`}, added up. Tap a player for the season game by game, with the boxes from the card.</p>
      ${inFrame() ? '' : '<div class="row start"><button type="button" class="btn" data-a="csv">Save as a spreadsheet</button></div>'}` : '<p><a class="btn" href="#/">Your games</a></p>'}
    </main>`;
  el.onclick = e => {
    const s = e.target.closest('[data-sort]'), a = e.target.closest('[data-a]');
    if (s) {
      const [which, by] = s.dataset.sort.split(':'), how = sorted[which];
      if (how.by === by) how.up = !how.up; else Object.assign(how, { by, up: LOW.has(by) });
      $(`[data-t=${which}]`, el).innerHTML = which === 'bat' ? batTable(T, href) : pitTable(T, href);
      $(`[data-sort="${which}:${by}"]`, el).focus();
    }
    if (a && a.dataset.a === 'csv') download(`${slug(T.name)}-${T.yr === 'all' ? 'every-year' : T.yr}-season.csv`, teamCsv(T), 'text/csv');
  };
}

// The player an address names: by name, or by number (#4) for a player with no name, or one who wore it.
function findPlayer(T, who) {
  const k = keyFrom(who), all = [...T.bat, ...T.pit].filter(x => x.key);
  return all.find(x => x.key === k) || (k.startsWith('#') ? all.find(x => x.num === k.slice(1)) : null) || null;
}
function missing(el, T, who) {
  document.title = `${T.name} · Backwards K`;
  el.innerHTML = `${bar(teamHref(T.name, T.yr), T.name, seasonWords(T))}
    <main class="team"><h1>${esc(who)}</h1><p>Nobody called ${esc(who)} played for the ${esc(T.name)} in ${T.yr === 'all' ? 'any game' : `a ${T.yr} game`} on this device.</p>
    <p><a class="btn" href="${esc(teamHref(T.name, T.yr))}">${esc(T.name)}, ${esc(seasonWords(T))}</a></p></main>`;
}

const bar = (back, title, sub) => `<header class="bar">
    <div class="bar-in">
      <a class="back" href="${esc(back)}" aria-label="Back"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
      <div class="title"><b>${esc(title)}</b><small>${esc(sub)}</small></div>
    </div>
  </header>`;

// One row of a line: the columns' values, under their headings.
const lineTable = (label, cols, line) => `<div class="stat-wrap"><table class="stats season one" aria-label="${esc(label)}">
  <thead><tr><th scope="col"><span class="sr">${esc(label)}</span></th>${cols.map(([h]) => `<th scope="col">${abbr(h)}</th>`).join('')}</tr></thead>
  <tbody><tr><th scope="row">Season</th>${cols.map(([, k, f]) => `<td>${f ? f(line) : line[k]}</td>`).join('')}</tr></tbody></table></div>`;

// A player's season: her batting line and each game with her boxes, where her hits went, her pitching by date.
function playerPage(el, T, x) {
  const num = x.num && !x.key.startsWith('#') ? `#${x.num}` : '';
  // Where she played, and how often: "At SS in 8 games, at P in 3".
  const ps = Object.entries(x.pos).sort((a, b) => b[1] - a[1]).map(([k, n], i) => `${i ? 'at' : 'At'} ${k} in ${n}${i ? '' : ` game${n === 1 ? '' : 's'}`}`).join(', ');
  document.title = `${x.name} · ${T.name} · Backwards K`;
  const me = { name: x.name };
  const b = x.bat, p = x.pit;
  // Her season's spray chart: the balls she put in play in the games that say where hits went.
  const balls = x.days.filter(d => d.game.spray).flatMap(d => d.cells.filter(c => located(c)).map(c => ball(c, ballWords(c, fmtDate(d.game.date)))));
  const days = x.days.slice().reverse().map(d => logItem(d.game, `<span class="gl-line">${esc(d.line.pa || d.line.r || d.line.sb ? batWords(d.line) : 'Didn’t bat')}</span>
      ${d.cells.length ? `<span class="gl-boxes" aria-hidden="true">${d.cells.map(c => `<span class="cell-pic">${cellSvg(c, { count: d.game.pitches })}</span>`).join('')}</span>` : ''}`));
  const arms = x.arms.slice().reverse().map(a => {
    const L = a.line, dec = L.w ? 'W' : L.l ? 'L' : L.s ? 'S' : '';
    return `<tr><th scope="row"><a href="#/g/${esc(a.game.id)}">${esc(fmtDate(a.game.date))}</a> <small>${esc(vs(a.game))}</small></th><td>${dec}</td><td>${ip(L.outs)}</td><td>${L.bf}</td><td>${L.h}</td><td>${L.r}</td><td>${L.er}</td><td>${L.bb}</td><td>${L.k}</td>${p.pg ? `<td>${a.game.pitches ? `${L.np}-${L.str}` : '–'}</td>` : ''}${x.arms.some(y => y.rest != null) ? `<td>${a.rest == null ? '–' : a.rest}</td>` : ''}</tr>`;
  });
  const restCol = x.arms.some(y => y.rest != null);
  el.innerHTML = `${bar(teamHref(T.name, T.yr), x.name, `${T.name} · ${seasonWords(T)}`)}
    <main class="team player">
      <header class="team-head">
        <h1>${esc(x.name)}</h1>
        <p>${[esc(num), `<a href="${esc(teamHref(T.name, T.yr))}">${esc(T.name)}</a>`, esc(seasonWords(T))].filter(Boolean).join(' · ')}</p>
        ${ps ? `<p class="ps">${esc(ps)}.</p>` : ''}
        ${years(T, y => teamHref(T.name, y, me))}
      </header>
      ${x.days.length ? `<section aria-labelledby="batH"><h2 id="batH">Batting</h2>
        <p class="sum"><b>${three(avg(b))}</b> (${b.h} for ${b.ab}) in ${b.g} game${b.g === 1 ? '' : 's'}${batWords(b, true) ? `, with ${esc(batWords(b, true))}` : ''}. On base ${three(obp(b))}, slugging ${three(slg(b))}.</p>
        ${lineTable('Batting', BAT, b)}
        <h3>Game by game</h3>
        <ul class="game-log days">${days.join('')}</ul>
        ${sprayFigure(balls, `Where ${x.name} hit it`)}
      </section>` : ''}
      ${x.arms.length ? `<section aria-labelledby="pitH"><h2 id="pitH">Pitching</h2>
        <p class="sum">${p.g} game${p.g === 1 ? '' : 's'}, ${esc(pitchWords(p))}.</p>
        ${lineTable('Pitching', PIT(p.pg > 0), p)}
        <h3>By date</h3>
        <div class="stat-wrap"><table class="stats season" aria-label="Pitching by date">
          <thead><tr><th scope="col">Game</th>${['Dec', 'IP', 'BF', 'H', 'R', 'ER', 'BB', 'K'].map(h => `<th scope="col">${h === 'Dec' ? '<abbr title="Win, loss or save">Dec</abbr>' : abbr(h)}</th>`).join('')}${p.pg ? `<th scope="col">${abbr('P-S')}</th>` : ''}${restCol ? '<th scope="col"><abbr title="Days of rest needed, by the pitch limit">Rest</abbr></th>' : ''}</tr></thead>
          <tbody>${arms.join('')}</tbody></table></div>
      </section>` : ''}
      <div class="row start">
        <button type="button" class="btn primary" data-a="text">Copy the season as text</button>
        ${inFrame() ? '' : '<button type="button" class="btn" data-a="csv">Save as a spreadsheet</button>'}
      </div>
      <p class="hint">For a group chat, or the grandparents: the season so far, and the last game.</p>
    </main>`;
  el.onclick = async e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'csv') download(`${slug(x.name)}-${slug(T.name)}-${T.yr === 'all' ? 'every-year' : T.yr}.csv`, playerCsv(T, x), 'text/csv');
    if (a.dataset.a === 'text') {
      const text = seasonText(T, x);
      if (await copy(text)) return toast('Copied. Paste it into a message.');
      const body = openSheet(`<h2 id="sheetTitle">${esc(x.name)}’s season</h2><textarea readonly rows="6"></textarea><p class="hint">Copy this and paste it wherever you like.</p>
        <div class="row"><button type="button" class="btn primary" data-close>Done</button></div>`);
      const t = $('textarea', body);
      t.value = text;
      t.select();
    }
  };
}
