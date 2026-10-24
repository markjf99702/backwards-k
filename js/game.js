// The game screen: the score, the field with the runners, the buttons for what happened, and beside them (or a tab
// away on a phone) the scorecard, the box score and the play-by-play.
import {
  replay, suggest, check, runsCount, now, RESULTS, BASE, POS, POS_NAME, halfLabel, label, player, teamName,
  pitcherLabel, ord, runnersOn, mark, pitchStat, ip,
} from './engine.js';
import { store } from './store.js';
import { blank } from './model.js';
import { cardHtml, lineHtml, cellSvg } from './card.js';
import { boxHtml, playsHtml } from './box.js';
import { infieldSvg, fieldSvg, BASE_AT } from './field.js';
import { $, $$, esc, openSheet, closeSheet, toast, KL, markHtml, fmtDate, go, inFrame } from './ui.js';
import { drive } from './sync.js';
import { shareSheet, saveFile } from './share.js';
import { helpSheet } from './help.js';

let G = null, S = null, root = null, redo = [];
let view = 'live', pane = 'card', cardSide = null, readOnly = false, onSave = null, lastInn = '', note = '';
const BASES = ['', '1st', '2nd', '3rd', 'Home'];

// el: where to draw. game: the game. opts.shared: someone else's game from a link (look, don't touch), with
// onSave to keep a copy.
export function showGame(el, game, opts = {}) {
  G = game; root = el; redo = []; readOnly = !!opts.shared; onSave = opts.onSave || null;
  note = opts.note || 'A scorecard someone shared with you. Tap any box to see what happened.';
  view = 'live'; cardSide = null; lastInn = '';
  if (readOnly) { view = matchMedia('(min-width: 700px)').matches ? 'live' : 'card'; pane = 'card'; }
  S = replay(G);
  el.innerHTML = frame();
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  drive.chip($('.bar .cloud', el));
  draw();
  wake(true);
}
export function leaveGame() {
  flush();
  if (root) { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); }
  wake(false);
  G = S = root = null;
}
// Another tab, or Google Drive, changed what's stored (why is 'reload'), or this page saved something.
store.onChange(why => {
  if (!G || readOnly) return;
  const fresh = store.get(G.id);
  if (why === 'reload' && soon && soon.g === G) {
    // A name typed a moment ago isn't saved yet: it goes in, unless the game changed somewhere else meanwhile.
    if (fresh && fresh.updated <= G.updated) return flush();
    clearTimeout(soon.t);
    soon = null;
  }
  if (fresh && fresh !== G) { G = fresh; S = replay(G); draw(); }
});

// ---------- keep the screen on during a game ----------
let lock = null, wantLock = false, asking = false;
async function wake(on) {
  wantLock = on;
  if (asking) return;
  try {
    if (on && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      asking = true;
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
      if (!wantLock) { await lock.release(); lock = null; }
    } else if (!on && lock) { const l = lock; lock = null; await l.release(); }
  } catch { lock = null; } finally { asking = false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
  else if (wantLock) wake(true);
});
// The page is going away (closed, reloaded, or put away by the phone): a name typed a moment ago is saved first.
window.addEventListener('pagehide', flush);

// ---------- changing the game ----------
function act(e) {
  if (readOnly) return;
  G.ev.push(e);
  redo = [];
  save();
}
// (If this device can't save, the line under the bar says so: see trouble().)
function save() {
  store.save(G);
  drive.changed();
  S = replay(G);
  draw();
}
// Names and settings changed: save, but nothing about the game itself moved. The save waits for a pause in the
// typing, and remembers which game it's for in case the screen changes first.
let soon = null;
function saveSoon() {
  S = replay(G);
  if (soon) clearTimeout(soon.t);
  soon = { g: G, t: setTimeout(flush, 400) };
}
// Saves a name change that's still waiting, straight away.
function flush() {
  if (!soon) return;
  const { g, t } = soon;
  soon = null;
  clearTimeout(t);
  store.save(g);
  drive.changed();
  if (g === G) trouble();
}
function undo() {
  const e = G.ev.pop();
  if (!e) return;
  const r = { e };
  if (e.t === 'add') r.slot = G.teams[e.s].lineup.pop();
  if (e.t === 'sub') { const slot = G.teams[e.s].lineup[e.slot]; if (slot.length - 1 === e.i) r.player = slot.pop(); }
  // A new pitcher goes again, but not one brought back: an earlier change still points at them.
  if (e.t === 'pch') { const ps = G.teams[e.s].pitchers; if (ps.length - 1 === e.i && !G.ev.some(x => x.t === 'pch' && x.s === e.s && x.i === e.i)) r.player = ps.pop(); }
  redo.push(r);
  save();
}
function redoIt() {
  const r = redo.pop();
  if (!r) return;
  if (r.slot) G.teams[r.e.s].lineup.push(r.slot);
  if (r.player && r.e.t === 'sub') G.teams[r.e.s].lineup[r.e.slot].push(r.player);
  if (r.player && r.e.t === 'pch') G.teams[r.e.s].pitchers.push(r.player);
  G.ev.push(r.e);
  save();
}

// ---------- drawing ----------
function frame() {
  return `<header class="bar">
      <div class="bar-in">
        <a class="back" href="#/" aria-label="All games"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
        <div class="title"></div>
        <button type="button" class="cloud bar-btn" hidden></button>
        ${readOnly ? '' : `<button type="button" class="bar-btn undo" data-a="undo" aria-label="Undo"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Undo</span></button>`}
        ${readOnly ? '' : `<button type="button" class="bar-btn" data-a="menu" aria-label="Game menu"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="5" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/></svg></button>`}
      </div>
    </header>
    <div class="game">
      ${readOnly ? '' : '<div class="trouble" role="alert" hidden><p></p><button type="button" class="btn sm"></button></div>'}
      ${readOnly ? `<div class="shared-bar"><p>${esc(note)}</p>${onSave ? '<button type="button" class="btn primary sm" data-a="keep">Save to my games</button>' : ''}</div>` : ''}
      <nav class="vtabs" aria-label="Views">
        <button type="button" data-v="live">${readOnly ? 'Score' : 'Score'}</button>
        <button type="button" data-v="card">Card</button>
        <button type="button" data-v="box">Box score</button>
        <button type="button" data-v="plays">Plays</button>
      </nav>
      <section class="live" aria-label="Scoring"></section>
      <section class="side">
        <div class="pane" data-p="card"></div>
        <div class="pane" data-p="box"></div>
        <div class="pane" data-p="plays"></div>
      </section>
    </div>`;
}

function draw() {
  if (!root) return;
  const game = $('.game', root);
  game.dataset.view = view;
  $('.side', root).dataset.pane = view === 'live' ? pane : view;
  $$('.vtabs button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === view || (view === 'live' && b.dataset.v === pane && wide()))));
  $('.bar .title', root).innerHTML = `<b>${esc(teamName(G, 0))}</b> <span>${S.R[0]}</span><i>–</i><span>${S.R[1]}</span> <b>${esc(teamName(G, 1))}</b><small>${esc(halfLabel(S))}${G.date ? ' · ' + esc(fmtDate(G.date)) : ''}</small>`;
  $('.live', root).innerHTML = liveHtml();
  const u = $('.bar .undo', root);
  if (u) {
    u.disabled = !G.ev.length;
    const what = G.ev.length ? S.text[G.ev.length - 1] : '';
    u.title = what ? 'Undo: ' + what : 'Nothing to undo';
    u.setAttribute('aria-label', u.title);
  }
  drawSide();
  trouble();
  wake(!S.over && !readOnly);
}
const wide = () => matchMedia('(min-width: 700px)').matches;

// While this device can't save, one line under the bar says so (instead of a message on every tap), with a way to
// keep the game anyway. It goes as soon as a save works again.
function trouble() {
  const el = root && $('.trouble', root);
  if (!el) return;
  const p = store.problem(), file = !inFrame();
  el.hidden = !p;
  if (!p) delete el.dataset.p;
  if (!p || el.dataset.p === p) return;
  el.dataset.p = p; // (written only when it changes, so a screen reader says it once)
  $('p', el).textContent = p === 'full'
    ? `This device is out of room, so the latest plays aren’t saved yet. ${file ? 'Save the game as a file' : 'Share the game'}, then delete some old games.`
    : `This browser isn’t letting Backwards K save (private browsing, or site data is turned off). ${file ? 'Save the game as a file or share its link' : 'Share the game’s link'} before you close this page.`;
  const b = $('button', el);
  b.dataset.a = file ? 'file' : 'share';
  b.textContent = file ? 'Save as a file' : 'Share this game';
}

function drawSide() {
  const side = cardSide ?? (S.over ? 0 : S.half);
  const card = $('.pane[data-p=card]', root);
  const wrap = card.querySelector('.card-wrap'), keepX = wrap ? wrap.scrollLeft : 0;
  card.innerHTML = `<div class="pane-top">
      <div class="seg" role="group" aria-label="Whose card">${[0, 1].map(s => `<button type="button" data-cs="${s}" aria-pressed="${s === side}">${esc(teamName(G, s))}${!S.over && S.half === s ? ' <i class="batting" title="Batting">●</i>' : ''}</button>`).join('')}</div>
      <button type="button" class="link-btn" data-a="help">What the marks mean</button>
    </div>
    <div class="line-wrap">${lineHtml(S)}</div>
    <div class="card-wrap">${cardHtml(S, side, { live: !readOnly })}</div>`;
  const w = card.querySelector('.card-wrap');
  w.scrollLeft = keepX;
  // Keep the inning being played in view as the game moves along.
  const key = `${side}:${S.inn}:${S.half}`;
  if (key !== lastInn) {
    lastInn = key;
    requestAnimationFrame(() => {
      const cur = w.querySelector('td.next') || w.querySelector('th.cur');
      if (!cur) return;
      const first = w.querySelector('tbody th.who'), left = first ? first.offsetWidth : 0;
      const x = cur.offsetLeft - left - 8;
      if (x < w.scrollLeft || cur.offsetLeft + cur.offsetWidth > w.scrollLeft + w.clientWidth) w.scrollLeft = Math.max(0, x - cur.offsetWidth);
    });
  }
  $('.pane[data-p=box]', root).innerHTML = `<div class="line-wrap">${lineHtml(S)}</div>${boxHtml(S)}`;
  $('.pane[data-p=plays]', root).innerHTML = `<div class="plays">${playsHtml(S)}</div>`;
}

function liveHtml() {
  const n = now(S), g = G;
  const runner = b => {
    const r = S.bases[b];
    if (!r) return '';
    const [x, y] = BASE_AT[b];
    return `<button type="button" class="runner" data-runner="${b}" style="left:${x}%;top:${y}%" aria-label="Runner on ${BASE[b]}: ${esc(label(player(g, r.side, r.slot, r.p), r.slot))}. Tap for steals and other moves."><span>${esc(label(player(g, r.side, r.slot, r.p), r.slot))}</span></button>`;
  };
  const dots = (on, of, cls) => Array.from({ length: of }, (_, i) => `<i class="${cls}${i < on ? ' on' : ''}"></i>`).join('');
  const bug = `<div class="bug">
      <div class="bug-teams">
        ${[0, 1].map(s => `<div class="bt${!S.over && S.half === s ? ' bat' : ''}"><span class="nm">${esc(teamName(g, s))}</span><span class="r">${S.R[s]}</span></div>`).join('')}
      </div>
      <div class="bug-state">
        <div class="inn">${S.over ? `<b>${S.ended ? 'Called' : 'Final'}</b>` : `<span class="arrow">${S.half ? '▼' : '▲'}</span><b>${ord(S.inn)}</b>`}</div>
        ${S.over ? '' : `<div class="outs" aria-label="${S.outs} out${S.outs === 1 ? '' : 's'}">${dots(S.outs, 3, 'o')}<span>Out${S.outs === 1 ? '' : 's'}</span></div>`}
      </div>
    </div>`;
  if (readOnly) {
    return `${bug}<div class="field-col"><div class="field over">${infieldSvg()}</div></div>
      <div class="shared-note"><p>Every box on the card is one trip to the plate. Tap one to see what happened, or see <button type="button" class="link-btn" data-a="help">how to read the card</button>.</p>
      <a class="btn" href="#/new">Score your own game</a></div>`;
  }
  const field = `<div class="field${S.over ? ' over' : ''}">
      ${infieldSvg()}
      ${[3, 2, 1].map(runner).join('')}
      ${S.over ? '' : `<button type="button" class="batter" data-a="batter" style="left:${BASE_AT[0][0]}%;top:${BASE_AT[0][1]}%" aria-label="At bat: ${esc(n.name)}. Tap to name or pinch-hit."><small>${n.slot + 1}</small><span>${esc(n.name)}</span></button>`}
      ${S.over ? '' : `<p class="deck"><span>On deck</span> ${esc(n.deckName)}</p>`}
      ${g.pitches && !S.over ? `<div class="count" aria-label="Count ${S.b} and ${S.s}"><span>B</span>${dots(S.b, 3, 'b')}<span>S</span>${dots(S.s, 2, 's')}</div>` : ''}
      ${S.over ? '' : `<button type="button" class="pitcher" data-a="pitcher" aria-label="Pitching: ${esc(n.pitcherName)}${g.pitches ? ', ' + n.pitches + ' pitches' : ''}. Tap to change pitchers."><span>${esc(n.pitcherName)}</span>${g.pitches ? `<b>${n.pitches}</b><small>pitch${n.pitches === 1 ? '' : 'es'}</small>` : ''}</button>`}
    </div>`;
  const last = G.ev.length ? S.text[G.ev.length - 1] : '';
  const lastE = G.ev[G.ev.length - 1];
  const ticker = `<div class="ticker">
      <p aria-live="polite">${last ? esc(last) : 'Tap what happens. Every tap can be undone.'}</p>
      ${lastE && lastE.t === 'pa' && lastE.m ? '<button type="button" class="link-btn" data-a="fixlast">Fix runners</button>' : ''}
      ${redo.length ? '<button type="button" class="link-btn" data-a="redo">Redo</button>' : ''}
    </div>`;
  if (S.over) {
    const w = S.R[0] === S.R[1] ? null : S.R[1] > S.R[0] ? 1 : 0;
    return `${bug}<div class="field-col">${field}${ticker}</div><div class="final">
        <h2>${w == null ? `Tied, ${S.R[0]}–${S.R[1]}` : `${esc(teamName(g, w))} win, ${S.R[w]}–${S.R[1 - w]}`}</h2>
        <p>${S.ended ? 'The game was called.' : 'That’s the ballgame.'} The whole card is ${wide() ? 'beside this' : 'under <b>Card</b>'}, and the box score under <b>Box score</b>.</p>
        <div class="row"><button type="button" class="btn primary" data-a="share">Share this game</button><button type="button" class="btn" data-a="on">Keep playing</button></div>
      </div>`;
  }
  const can = {
    SF: S.bases[3] && S.outs < 2, SAC: runnersOn(S).length && S.outs < 2, DP: runnersOn(S).length && S.outs < 2,
    FC: runnersOn(S).length,
  };
  const res = (code, big, small) => `<button type="button" class="res r-${RESULTS[code].kind}" data-r="${code}"${code in can && !can[code] ? ' disabled' : ''}><b>${big}</b><span>${small}</span></button>`;
  const pitches = g.pitches ? `<div class="pad pitches" role="group" aria-label="Pitches">
      <button type="button" class="pt ball" data-p="b"><b>Ball</b></button>
      <button type="button" class="pt" data-p="c"><b>Strike</b><span>looking</span></button>
      <button type="button" class="pt" data-p="s"><b>Strike</b><span>swinging</span></button>
      <button type="button" class="pt" data-p="f"><b>Foul</b></button>
    </div>` : '';
  return `${bug}<div class="field-col">${field}${ticker}</div>
    <div class="pads">
    ${pitches}
    <div class="pad results" role="group" aria-label="What the batter did">
      <div class="row4 g-hit" role="group" aria-label="Hits">${res('1B', '1B', 'Single')}${res('2B', '2B', 'Double')}${res('3B', '3B', 'Triple')}${res('HR', 'HR', 'Home run')}</div>
      <div class="row4 g-on" role="group" aria-label="On base without a hit">${res('BB', 'BB', 'Walk')}${res('HBP', 'HBP', 'Hit by pitch')}${res('E', 'E', 'Error')}${res('FC', 'FC', 'Fielder’s choice')}</div>
      <div class="row4 g-out" role="group" aria-label="Outs">${res('K', 'K', 'Swinging')}${res('KL', KL, 'Looking')}${res('GO', 'G', 'Ground out')}${res('FO', 'F', 'Fly out')}
        ${res('LO', 'L', 'Line out')}${res('PU', 'P', 'Pop out')}${res('SF', 'SF', 'Sac fly')}${res('SAC', 'SAC', 'Sac bunt')}
        ${res('DP', 'DP', 'Double play')}<button type="button" class="res r-more" data-a="more"><b>More</b><span>Intentional walk, dropped third strike, end the inning</span></button></div>
    </div>
    </div>
    <div class="recent"><h3>Latest plays</h3>${playsHtml(S, { limit: 5 })}</div>`;
}

// ---------- taps ----------
function onKey(e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-pos]')) { e.preventDefault(); e.target.closest('[data-pos]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
}
function onClick(e) {
  const t = e.target.closest('[data-a],[data-r],[data-p],[data-runner],[data-cell],[data-v],[data-cs]');
  if (!t || t.disabled) return;
  if (t.dataset.v) { view = t.dataset.v; if (view !== 'live') pane = view; draw(); if (!wide()) window.scrollTo({ top: 0 }); return; }
  if (t.dataset.cs) { cardSide = +t.dataset.cs; drawSide(); return; }
  if (t.dataset.cell) return cellSheet(S.cells[+t.dataset.cell]);
  if (readOnly) { if (t.dataset.a === 'keep') onSave(); if (t.dataset.a === 'help') helpSheet(); return; }
  if (t.dataset.p) return act({ t: 'p', k: t.dataset.p });
  if (t.dataset.r) return choose(t.dataset.r);
  if (t.dataset.runner) return runnerSheet(+t.dataset.runner);
  switch (t.dataset.a) {
    case 'undo': return undo();
    case 'redo': return redoIt();
    case 'fixlast': return fixLast();
    case 'more': return moreSheet();
    case 'batter': return batterSheet();
    case 'pitcher': return pitcherSheet(1 - S.half);
    case 'menu': return menuSheet();
    case 'help': return helpSheet();
    case 'share': return shareSheet(G);
    case 'file': return saveFile(G);
    case 'on': return act({ t: 'on' });
  }
}

// ---------- a plate appearance: result, then fielders, then where the runners went ----------
function choose(code, f) {
  const R = RESULTS[code];
  if (R.f && f === undefined) return pickFielders(code, null, got => choose(code, got));
  const m = suggest(S, code);
  // Nobody on, or a play where runners only move when they're forced: nothing to ask.
  // (For the odd one that went differently, Fix runners is right under the field.)
  if (!runnersOn(S).length || QUIET.has(code)) {
    closeSheet();
    return act(withF({ t: 'pa', r: code, m }, f));
  }
  runnersSheet(code, f, m);
}
const withF = (e, f) => { if (f && f.length) e.f = f; return e; };
const QUIET = new Set(['K', 'KL', 'PU', 'BB', 'IBB', 'HBP', 'CI']);

const HINT = {
  GO: 'Tap the fielder who got the ball, then whoever made the out. Short to first is 6, then 3.',
  FC: 'Tap who fielded it, then who made the out on the runner. Short to second is 6, then 4.',
  DP: 'Tap each fielder in order. Short to second to first is 6, 4, 3.',
  TP: 'Tap each fielder in order.',
  SAC: 'Tap who fielded the bunt, then who made the out.',
  E: 'Tap the fielder who made the error.',
};
// Who fielded it. One tap for a catch or an error; a sequence for throws. Skipping is fine.
function pickFielders(code, start, done, { title } = {}) {
  const R = RESULTS[code] || { f: 1, label: title };
  let seq = start ? start.slice() : [];
  const one = R.f === 1;
  const body = openSheet(`<h2 id="sheetTitle">${esc(title || R.label)}: who fielded it?</h2>
    <p class="hint">${esc(HINT[code] || 'Tap the fielder who caught it.')}</p>
    <p class="seq" aria-live="polite"></p>
    <div class="pick">${fieldSvg()}</div>
    <div class="row">
      ${one ? '' : '<button type="button" class="btn quiet" data-x="back">Undo a tap</button>'}
      <button type="button" class="btn quiet" data-x="skip">Skip</button>
      ${one ? '' : '<button type="button" class="btn primary" data-x="done">Done</button>'}
    </div>`);
  const upd = () => {
    body.querySelector('.pick').innerHTML = fieldSvg({ picked: seq });
    body.querySelector('.seq').innerHTML = seq.length ? `<b>${esc(mark(code === 'GO' && seq.length === 1 ? 'GO' : code, seq))}</b> ${esc(seq.map(n => POS_NAME[n]).join(' to '))}` : '&nbsp;';
    const d = body.querySelector('[data-x=done]');
    if (d) d.disabled = !seq.length;
  };
  upd();
  body.addEventListener('click', e => {
    const p = e.target.closest('[data-pos]'), x = e.target.closest('[data-x]');
    if (p) {
      seq.push(+p.dataset.pos);
      if (one) return done(seq);
      if (seq.length > 6) seq = seq.slice(-6);
      upd();
    } else if (x) {
      if (x.dataset.x === 'back') { seq.pop(); upd(); }
      if (x.dataset.x === 'skip') done(null);
      if (x.dataset.x === 'done') done(seq);
    }
  });
}

// Everyone on base, and the batter, with where they most likely ended up already picked.
// st: how things stood before the play (kept here, since another tab or Drive can change the game meanwhile).
// done: what to do with the play once it's saved; a new play is added to the game.
function runnersSheet(code, f, moves, { st = S, editing = false, done = act } = {}) {
  const R = RESULTS[code], n = now(st);
  const m = moves.map(x => x.slice());
  const counts = { v: runsCount(st, code, m) };
  let userSaid = null;
  const who = b => (b === 0 ? n.name : label(player(G, st.bases[b].side, st.bases[b].slot, st.bases[b].p), st.bases[b].slot));
  const body = openSheet(`<h2 id="sheetTitle">${R.kind === 'out' && code !== 'KL' && code !== 'K' ? esc(R.label) : code === 'KL' ? 'Strikeout looking' : esc(R.label)}${f && f.length ? ` <span class="mk">${esc(mark(code, f))}</span>` : ''}</h2>
    <p class="hint">Here’s where everyone usually ends up. Change anything that went differently.</p>
    <div class="moves"></div>
    <p class="tally" aria-live="polite"></p>
    <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button><button type="button" class="btn primary" data-x="save">${editing ? 'Save changes' : 'Save play'}</button></div>`);
  function draw() {
    const rows = m.slice().sort((a, b) => b[0] - a[0]).map(([from, to]) => {
      const opts = [0, ...[1, 2, 3, 4].filter(b => b >= Math.max(from, 1))];
      return `<div class="mv" data-from="${from}">
        <p><b>${esc(who(from))}</b><span>${from ? `was on ${BASE[from]}` : 'batter'}</span></p>
        <div class="chips" role="group" aria-label="Where ${esc(who(from))} ended up">${opts.map(b => `<button type="button" data-to="${b}" aria-pressed="${b === to}" class="${b === 0 ? 'out' : b === 4 ? 'home' : ''}">${b === 0 ? 'Out' : b === from ? 'Stayed' : BASES[b]}</button>`).join('')}</div>
      </div>`;
    });
    body.querySelector('.moves').innerHTML = rows.join('');
    const err = check(st, m), outs = m.filter(x => x[1] === 0).length, runs = m.filter(x => x[1] === 4).length;
    const third = st.outs + outs >= 3 && runs > 0;
    if (userSaid == null) counts.v = runsCount(st, code, m);
    let t = '';
    if (err) t = `<span class="err">${esc(err)}</span>`;
    else {
      const bits = [];
      if (runs) bits.push(`${runs} run${runs > 1 ? 's' : ''} ${third && !counts.v ? 'cross' : 'score'}${runs > 1 ? '' : 's'}`);
      bits.push(`${st.outs + outs} out${st.outs + outs === 1 ? '' : 's'}${st.outs + outs >= 3 ? ', side retired' : ''}`);
      t = bits.join(' · ');
      if (third) t += `<span class="third">That’s the third out. Did the run${runs > 1 ? 's' : ''} cross the plate before it?
        <span class="chips"><button type="button" data-runs="1" aria-pressed="${counts.v}">Yes, ${runs > 1 ? 'they count' : 'it counts'}</button><button type="button" data-runs="0" aria-pressed="${!counts.v}">No</button></span></span>`;
    }
    body.querySelector('.tally').innerHTML = t;
    body.querySelector('[data-x=save]').disabled = !!err;
  }
  draw();
  body.addEventListener('click', e => {
    const c = e.target.closest('[data-to]'), r = e.target.closest('[data-runs]'), s = e.target.closest('[data-x=save]');
    if (c) {
      const from = +c.closest('.mv').dataset.from;
      m.find(x => x[0] === from)[1] = +c.dataset.to;
      draw();
    } else if (r) { userSaid = true; counts.v = r.dataset.runs === '1'; draw(); }
    else if (s && !s.disabled) {
      const third = st.outs + m.filter(x => x[1] === 0).length >= 3;
      // A fly out that brings the runner home from third with fewer than two outs is a sacrifice fly.
      const sf = code === 'FO' && st.outs < 2 && m.some(x => x[0] === 3 && x[1] === 4) && m.some(x => x[0] === 0 && x[1] === 0);
      const e2 = withF({ t: 'pa', r: sf ? 'SF' : code, m }, f);
      if (third && !counts.v) e2.x = 1;
      closeSheet();
      done(e2);
    }
  });
}

// The last play's runners, again: ask where everyone went, from how things stood before it. The game itself is
// left alone until Save changes, so leaving the screen or cancelling loses nothing.
function fixLast() {
  const e = G.ev[G.ev.length - 1];
  if (!e || e.t !== 'pa') return;
  const id = G.id, was = plays(G.ev);
  runnersSheet(e.r, e.f || null, e.m, {
    st: replay({ ...G, ev: G.ev.slice(0, -1) }),
    editing: true,
    done: e2 => {
      // Another tab or Google Drive changed the plays while the sheet was open: the fix may not fit any more.
      if (!G || G.id !== id || plays(G.ev) !== was) return toast('The game changed somewhere else while this was open, so the fix wasn’t saved.');
      G.ev[G.ev.length - 1] = e2;
      redo = [];
      save();
    },
  });
}
// The plays written out the same way whatever order their fields were set in (a copy read back from storage has
// them in another order), to tell whether they changed.
const plays = ev => JSON.stringify(ev, (k, v) => (v && v.constructor === Object ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

function moreSheet() {
  const can = { TP: runnersOn(S).length >= 2 && S.outs === 0, KD: S.s >= 2 || !G.pitches };
  const item = (code, text) => `<button type="button" class="res r-${RESULTS[code].kind}" data-r2="${code}"${code in can && !can[code] ? ' disabled' : ''}><b>${esc(mark(code))}</b><span>${esc(text)}</span></button>`;
  const body = openSheet(`<h2 id="sheetTitle">Something else</h2>
    <div class="row2">
      ${item('IBB', 'Intentional walk')}
      ${item('KD', 'Struck out, but reached on a dropped third strike')}
      ${item('CI', 'Reached on catcher’s interference')}
      ${item('TP', 'Triple play')}
    </div>
    <h3>The inning or the game</h3>
    <div class="list">
      <button type="button" class="li" data-y="eoh"><b>End this half-inning</b><span>For a run limit or the clock. The next team comes up.</span></button>
      <button type="button" class="li" data-y="end"><b>End the game here</b><span>Rain, a mercy rule, or out of time. You can keep playing later.</span></button>
    </div>
    <div class="row"><button type="button" class="btn quiet" data-close>Close</button></div>`);
  body.addEventListener('click', e => {
    const r = e.target.closest('[data-r2]'), y = e.target.closest('[data-y]');
    if (r && !r.disabled) choose(r.dataset.r2);
    if (y) { closeSheet(); act({ t: y.dataset.y }); }
  });
}

// ---------- a runner: steals, wild pitches, pickoffs ----------
function runnerSheet(b) {
  const r = S.bases[b];
  if (!r) return;
  const name = label(player(G, r.side, r.slot, r.p), r.slot), next = b + 1;
  let to = next;
  const body = openSheet(`<h2 id="sheetTitle">${esc(name)} <small>on ${BASE[b]}</small></h2>
    <div class="row2">
      <button type="button" class="res r-hit" data-k="SB"><b>SB</b><span>Stole ${BASE[next]}</span></button>
      <button type="button" class="res r-out" data-k="CS"><b>CS</b><span>Caught stealing</span></button>
      <button type="button" class="res r-out" data-k="PO"><b>PO</b><span>Picked off ${BASE[b]}</span></button>
      <button type="button" class="res r-out" data-k="OB"><b>Out</b><span>Out on the bases, another way</span></button>
    </div>
    <h3>Moved up without a hit</h3>
    <div class="to"><span>To</span><span class="chips" role="group" aria-label="Moved to">${[1, 2, 3, 4].filter(x => x > b).map(x => `<button type="button" data-to="${x}" aria-pressed="${x === to}">${BASES[x]}</button>`).join('')}</span></div>
    <div class="row2">
      <button type="button" class="res" data-k="WP"><b>WP</b><span>Wild pitch</span></button>
      <button type="button" class="res" data-k="PB"><b>PB</b><span>Passed ball</span></button>
      <button type="button" class="res" data-k="E"><b>E</b><span>Error</span></button>
      <button type="button" class="res" data-k="OA"><b>Adv</b><span>Something else</span></button>
    </div>
    <div class="list">
      <button type="button" class="li" data-k="BK"><b>Balk</b><span>Every runner moves up a base.</span></button>
      <button type="button" class="li" data-k="PR"><b>Pinch runner</b><span>Someone else runs for ${esc(name)}.</span></button>
    </div>
    <div class="row"><button type="button" class="btn quiet" data-close>Close</button></div>`);
  body.addEventListener('click', e => {
    const c = e.target.closest('[data-to]'), k = e.target.closest('[data-k]');
    if (c) { to = +c.dataset.to; $$('[data-to]', body).forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.to === to))); return; }
    if (!k) return;
    const how = k.dataset.k;
    if (how === 'PR') return subForm(r.side, r.slot, 'pr');
    if (how === 'BK') { closeSheet(); return act({ t: 'r', m: runnersOn(S).map(x => [x, x + 1, 'BK']) }); }
    if (how === 'E') return pickFielders('E', null, f => { closeSheet(); act({ t: 'r', m: [f && f.length ? [b, to, 'E', f] : [b, to, 'E']] }); }, { title: 'Error' });
    if (how === 'SB') { if (S.bases[next] && next < 4) return toast(`Someone’s already on ${BASE[next]}. Move them first.`); closeSheet(); return act({ t: 'r', m: [[b, next, 'SB']] }); }
    if (how === 'CS' || how === 'PO' || how === 'OB') {
      closeSheet();
      return act({ t: 'r', m: [[b, 0, how]] });
    }
    // Moved up: the runners ahead have to be out of the way.
    for (let x = b + 1; x <= Math.min(to, 3); x++) if (S.bases[x]) return toast(`Someone’s on ${BASE[x]}. Move the runner ahead first.`);
    closeSheet();
    act({ t: 'r', m: [[b, to, how]] });
  });
}

// ---------- who's batting and pitching ----------
function nameFields(p, prefix = '') {
  return `<div class="name-row">
    <label class="num"><span>No.</span><input ${prefix}data-f="num" inputmode="numeric" maxlength="4" value="${esc(p.num)}" autocomplete="off"></label>
    <label class="nm"><span>Name</span><input ${prefix}data-f="name" maxlength="40" value="${esc(p.name)}" autocomplete="off" autocapitalize="words" placeholder="Optional"></label>
  </div>`;
}
function bindName(body, p, sel = '') {
  $$(`${sel}[data-f]`, body).forEach(i => i.addEventListener('input', () => { p[i.dataset.f] = i.value.trim(); saveSoon(); draw(); }));
}

function batterSheet() {
  const n = now(S), p = G.teams[n.side].lineup[n.slot][n.p];
  const st = S.bat[`${n.side}.${n.slot}.${n.p}`];
  const body = openSheet(`<h2 id="sheetTitle">At bat <small>${ord(n.slot + 1)} in the order for ${esc(teamName(G, n.side))}</small></h2>
    ${nameFields(p)}
    ${st ? `<p class="quiet">Today: ${st.h} for ${st.ab}${st.bb ? `, ${st.bb} walk${st.bb > 1 ? 's' : ''}` : ''}${st.rbi ? `, ${st.rbi} RBI` : ''}.</p>` : ''}
    <div class="list">
      <button type="button" class="li" data-y="ph"><b>Pinch hitter</b><span>Someone else bats in this spot.</span></button>
      <button type="button" class="li" data-y="lineup"><b>The whole lineup</b><span>Names, numbers and substitutions for both teams.</span></button>
    </div>
    <div class="row"><button type="button" class="btn primary" data-close>Done</button></div>`);
  bindName(body, p);
  body.addEventListener('click', e => {
    const y = e.target.closest('[data-y]');
    if (y && y.dataset.y === 'ph') subForm(n.side, n.slot, 'ph');
    if (y && y.dataset.y === 'lineup') lineupSheet(n.side);
  });
}

// A new player in a batting slot: a pinch hitter, a pinch runner, or a change in the field.
function subForm(side, slot, ty) {
  const p = blank(), was = label(player(G, side, slot, S.pl[side][slot]), slot);
  const words = { ph: 'Pinch hitter', pr: 'Pinch runner', def: 'Substitute' };
  const body = openSheet(`<h2 id="sheetTitle">${words[ty]} <small>for ${esc(was)}</small></h2>
    ${nameFields(p)}
    <div class="chips wide" role="group" aria-label="What kind of substitution">${Object.entries(words).map(([k, w]) => `<button type="button" data-ty="${k}" aria-pressed="${k === ty}">${w}</button>`).join('')}</div>
    <p class="hint">They take ${esc(was)}’s place in the batting order from now on.</p>
    <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button><button type="button" class="btn primary" data-x="go">Put them in</button></div>`);
  $$('[data-f]', body).forEach(i => i.addEventListener('input', () => { p[i.dataset.f] = i.value.trim(); }));
  body.addEventListener('click', e => {
    const t = e.target.closest('[data-ty]');
    if (t) { ty = t.dataset.ty; $$('[data-ty]', body).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.ty === ty))); body.querySelector('h2').firstChild.textContent = words[ty] + ' '; }
    if (e.target.closest('[data-x=go]')) {
      const list = G.teams[side].lineup[slot];
      list.push(p);
      closeSheet();
      act({ t: 'sub', s: side, slot, i: list.length - 1, ty });
    }
  });
  body.querySelector('[data-f=name]').focus();
}

function pitcherSheet(side) {
  const i = S.pit[side], p = G.teams[side].pitchers[i], st = pitchStat(S, side, i);
  const body = openSheet(`<h2 id="sheetTitle">Pitching <small>for ${esc(teamName(G, side))}</small></h2>
    ${nameFields(p)}
    <p class="quiet">${G.pitches ? `${st.np} pitches (${st.str} strikes), ` : ''}${ip(st.outs)} innings, ${st.h} hits, ${st.r} runs, ${st.bb} walks, ${st.k} strikeouts.</p>
    <div class="list">
      <button type="button" class="li" data-y="new"><b>New pitcher</b><span>Bring in a reliever. Their pitch count starts at zero.</span></button>
      ${G.teams[side].pitchers.length > 1 ? '<button type="button" class="li" data-y="back"><b>Bring back an earlier pitcher</b><span>Someone who already pitched today.</span></button>' : ''}
    </div>
    <div class="row"><button type="button" class="btn primary" data-close>Done</button></div>`);
  bindName(body, p);
  body.addEventListener('click', e => {
    const y = e.target.closest('[data-y]');
    if (!y) return;
    if (y.dataset.y === 'new') newPitcher(side);
    if (y.dataset.y === 'back') {
      const b2 = openSheet(`<h2 id="sheetTitle">Who’s pitching?</h2><div class="list">${G.teams[side].pitchers.map((_, j) => j === S.pit[side] ? '' : `<button type="button" class="li" data-j="${j}"><b>${esc(pitcherLabel(G, side, j))}</b><span>${pitchStat(S, side, j).np} pitches so far</span></button>`).join('')}</div>`);
      b2.addEventListener('click', e2 => { const j = e2.target.closest('[data-j]'); if (j) { closeSheet(); act({ t: 'pch', s: side, i: +j.dataset.j }); } });
    }
  });
}
function newPitcher(side) {
  const p = blank();
  const body = openSheet(`<h2 id="sheetTitle">New pitcher <small>for ${esc(teamName(G, side))}</small></h2>
    ${nameFields(p)}
    <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button><button type="button" class="btn primary" data-x="go">Bring them in</button></div>`);
  $$('[data-f]', body).forEach(i => i.addEventListener('input', () => { p[i.dataset.f] = i.value.trim(); }));
  body.addEventListener('click', e => {
    if (!e.target.closest('[data-x=go]')) return;
    G.teams[side].pitchers.push(p);
    closeSheet();
    act({ t: 'pch', s: side, i: G.teams[side].pitchers.length - 1 });
  });
  body.querySelector('[data-f=name]').focus();
}

// Both teams' orders: rename anyone, sub anyone, add a batter.
function lineupSheet(side = S.half) {
  const t = G.teams[side];
  const body = openSheet(`<h2 id="sheetTitle">Lineups</h2>
    <div class="seg" role="group" aria-label="Team">${[0, 1].map(s => `<button type="button" data-ls="${s}" aria-pressed="${s === side}">${esc(teamName(G, s))}</button>`).join('')}</div>
    <label class="team-name"><span>Team name</span><input data-team maxlength="40" value="${esc(t.name)}" placeholder="${side ? 'Home' : 'Visitors'}"></label>
    <ol class="lineup-edit">${Array.from({ length: S.size[side] }, (_, slot) => {
      const list = t.lineup[slot], cur = S.pl[side][slot] ?? 0, p = list[cur];
      const earlier = list.slice(0, cur).map(x => label(x, slot));
      return `<li data-slot="${slot}"><span class="ord">${slot + 1}</span>${nameFields(p, `data-slot="${slot}" `)}<button type="button" class="btn quiet sm" data-sub="${slot}">Sub</button>${earlier.length ? `<small class="earlier">Earlier: ${esc(earlier.join(', '))}</small>` : ''}</li>`;
    }).join('')}</ol>
    <div class="row"><button type="button" class="btn quiet" data-y="add">Add a batter to the order</button></div>
    <h3>Pitchers</h3>
    <ol class="lineup-edit">${t.pitchers.map((p, i) => `<li><span class="ord">${i === S.pit[side] ? '●' : i + 1}</span>${nameFields(p, `data-pi="${i}" `)}</li>`).join('')}</ol>
    <div class="row"><button type="button" class="btn quiet" data-y="pitcher">New pitcher</button><button type="button" class="btn primary" data-close>Done</button></div>`);
  $$('[data-slot][data-f]', body).forEach(i => i.addEventListener('input', () => {
    const slot = +i.dataset.slot;
    t.lineup[slot][S.pl[side][slot] ?? 0][i.dataset.f] = i.value.trim(); saveSoon(); draw();
  }));
  $$('[data-pi][data-f]', body).forEach(i => i.addEventListener('input', () => { t.pitchers[+i.dataset.pi][i.dataset.f] = i.value.trim(); saveSoon(); draw(); }));
  body.querySelector('[data-team]').addEventListener('input', e => { t.name = e.target.value.trim(); saveSoon(); draw(); });
  body.addEventListener('click', e => {
    const ls = e.target.closest('[data-ls]'), sub = e.target.closest('[data-sub]'), y = e.target.closest('[data-y]');
    if (ls) lineupSheet(+ls.dataset.ls);
    if (sub) subForm(side, +sub.dataset.sub, side === S.half && S.up[side] === +sub.dataset.sub ? 'ph' : 'def');
    if (y && y.dataset.y === 'add') { t.lineup.push([blank()]); G.ev.push({ t: 'add', s: side }); redo = []; save(); lineupSheet(side); }
    if (y && y.dataset.y === 'pitcher') newPitcher(side);
  });
}

// ---------- the menu ----------
function menuSheet() {
  const body = openSheet(`<h2 id="sheetTitle">This game</h2>
    <div class="list">
      <button type="button" class="li" data-y="lineup"><b>Lineups and substitutions</b><span>Names, numbers, pinch hitters, new pitchers.</span></button>
      <button type="button" class="li" data-y="share"><b>Share this game</b><span>A link to the scorecard, the score as text, or a printout.</span></button>
      <button type="button" class="li" data-y="settings"><b>Game settings</b><span>Teams, innings, counting pitches, date and place.</span></button>
      <button type="button" class="li" data-y="help"><b>How to read the card</b><span>What 6-3, F8 and the backwards K mean.</span></button>
      ${S.over ? '<button type="button" class="li" data-y="on"><b>Keep playing</b><span>Carry on scoring past the end.</span></button>'
        : '<button type="button" class="li" data-y="eoh"><b>End this half-inning</b><span>For a run limit or the clock.</span></button><button type="button" class="li" data-y="end"><b>End the game here</b><span>Rain, a mercy rule, or out of time.</span></button>'}
      <button type="button" class="li danger" data-y="delete"><b>Delete this game</b><span>From this device${drive.isOn() ? ' and your Google Drive' : ''}.</span></button>
    </div>
    <div class="row"><button type="button" class="btn quiet" data-close>Close</button></div>`);
  body.addEventListener('click', e => {
    const y = e.target.closest('[data-y]');
    if (!y) return;
    switch (y.dataset.y) {
      case 'lineup': return lineupSheet(S.half);
      case 'share': return shareSheet(G);
      case 'settings': return settingsSheet();
      case 'help': return helpSheet();
      case 'on': case 'eoh': case 'end': closeSheet(); return act({ t: y.dataset.y });
      case 'delete': {
        if (y.dataset.armed) {
          const g = G;
          closeSheet();
          store.remove(g.id); drive.changed();
          go('#/');
          toast('Game deleted.', { action: 'Undo', run: () => { store.save(g); drive.changed(); go('#/g/' + g.id); } });
        } else { y.dataset.armed = '1'; y.querySelector('b').textContent = 'Tap again to delete it'; }
      }
    }
  });
}

function settingsSheet() {
  const body = openSheet(`<h2 id="sheetTitle">Game settings</h2>
    <div class="form">
      <label><span>Visitors</span><input data-t="0" maxlength="40" value="${esc(G.teams[0].name)}" placeholder="Visitors"></label>
      <label><span>Home team</span><input data-t="1" maxlength="40" value="${esc(G.teams[1].name)}" placeholder="Home"></label>
      <label><span>Innings</span><select data-g="innings">${[3, 4, 5, 6, 7, 8, 9, 10, 12].map(n => `<option${n === G.innings ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label><span>Date</span><input type="date" data-g="date" value="${esc(G.date)}"></label>
      <label><span>Where</span><input data-g="place" maxlength="80" value="${esc(G.place)}" placeholder="Optional"></label>
      <label class="switch"><input type="checkbox" data-g="pitches"${G.pitches ? ' checked' : ''}><span>Count balls and strikes<small>Keeps the count and each pitcher’s pitch count.</small></span></label>
    </div>
    <div class="row"><button type="button" class="btn primary" data-close>Done</button></div>`);
  $$('[data-t]', body).forEach(i => i.addEventListener('input', () => { G.teams[+i.dataset.t].name = i.value.trim(); saveSoon(); draw(); }));
  $$('[data-g]', body).forEach(i => i.addEventListener(i.type === 'checkbox' || i.tagName === 'SELECT' ? 'change' : 'input', () => {
    const k = i.dataset.g;
    G[k] = k === 'pitches' ? i.checked : k === 'innings' ? +i.value : i.value.trim();
    if (k === 'innings' || k === 'pitches') save(); else { saveSoon(); draw(); }
  }));
}

// ---------- one box on the card ----------
const SAME = [['K', 'KL', 'GO', 'FO', 'LO', 'PU', 'SF', 'SAC'], ['1B', 'BB', 'IBB', 'HBP', 'E', 'FC', 'KD', 'CI']];
function cellSheet(c) {
  if (!c) return;
  const e = G.ev[c.ev], R = RESULTS[c.r];
  const name = label(player(G, c.side, c.slot, c.p), c.slot);
  const PITCH = { b: 'ball', c: 'called strike', s: 'swinging strike', f: 'foul', x: 'in play' };
  const seq = c.seq ? c.seq.split('').map(k => PITCH[k]).join(', ') : '';
  // A strikeout that came from counting pitches can still be switched between swinging and looking.
  const fromPitch = e && e.t === 'p' && (c.r === 'K' || c.r === 'KL');
  const group = readOnly || !e ? null : e.t === 'pa' ? SAME.find(gr => gr.includes(c.r)) : fromPitch ? ['K', 'KL'] : null;
  const body = openSheet(`<h2 id="sheetTitle">${esc(name)} <small>${c.side ? 'Bottom' : 'Top'} of the ${ord(c.inn)}</small></h2>
    <div class="cell-big"><div class="cell-pic">${cellSvg(c, { count: G.pitches })}</div>
      <div><p><b>${markHtml(c.r, c.mark)}</b> ${esc(R.label)}</p><p>${esc(c.text)}</p>${c.story.length ? `<p>${esc(c.story.join(' '))}</p>` : ''}
      ${seq ? `<p class="quiet">Pitches: ${esc(seq)}.</p>` : ''}</div></div>
    ${group ? `<h3>Change what it was</h3><div class="chips wide" role="group" aria-label="What it was">${group.map(k => `<button type="button" data-sw="${k}" aria-pressed="${k === c.r}">${k === 'KL' ? KL + ' looking' : esc(RESULTS[k].label)}</button>`).join('')}</div>` : ''}
    ${group && e.t === 'pa' && (R.f || c.f) ? `<div class="row"><button type="button" class="btn quiet" data-y="f">Change the fielders${c.f ? ` (${esc(c.f.join('-'))})` : ''}</button></div>` : ''}
    <div class="row"><button type="button" class="btn primary" data-close>Done</button></div>`);
  body.addEventListener('click', ev => {
    const sw = ev.target.closest('[data-sw]'), y = ev.target.closest('[data-y]');
    if (sw) {
      if (e.t === 'p') e.k = sw.dataset.sw === 'KL' ? 'c' : 's';
      else { e.r = sw.dataset.sw; if (!RESULTS[e.r].f) delete e.f; }
      save();
      cellSheet(S.cells[c.n]);
    }
    if (y) pickFielders(e.r, e.f, f => { if (f && f.length) e.f = f; else delete e.f; save(); cellSheet(S.cells[c.n]); });
  });
}
