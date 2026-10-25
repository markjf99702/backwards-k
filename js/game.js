// The game screen: the score, the field with the runners, the buttons for what happened, and beside them (or a tab
// away on a phone) the scorecard, the box score and the play-by-play.
import {
  replay, suggest, check, runsCount, scoredAs, now, RESULTS, BASE, POS, POS_NAME, halfLabel, label, player, teamName,
  pitcherLabel, ord, runnersOn, mark, pitchStat, pitchWords, pitchDay, pitchWork, pitchCount, winningRun, creditedHit, credit, fits,
  ENDS, regulation, official, winner,
} from './engine.js';
import { store } from './store.js';
import { blank, takeBack, putBack, newer, plays } from './model.js';
import { cardHtml, lineHtml, cellSvg } from './card.js';
import { boxHtml, playsHtml, dayOf } from './box.js';
import { infieldSvg, fieldSvg, BASE_AT } from './field.js';
import { $, $$, esc, openSheet, closeSheet, sheetOpen, reveal, toast, KL, markHtml, fmtDate, go, inFrame, nextName } from './ui.js';
import { drive } from './sync.js';
import { shareSheet, saveFile } from './share.js';
import { helpSheet } from './help.js';
import { rulesRow } from './rules.js';

// redo: what Undo took back, latest last. kept: what it took back before a new play went in, to put back after it
// (see moved()).
let G = null, S = null, root = null, redo = [], kept = null;
let view = 'live', pane = 'card', cardSide = null, readOnly = false, onSave = null, lastInn = '', note = '', later = false;
// The play the scorer tapped for the latest plate appearance, before it was scored from where everyone ended up (a line
// out that brought the run in from third is saved as a sacrifice fly): Fix runners starts again from it. Only kept
// here, never saved; after a reload, Fix runners starts from the play as saved.
let tapped = { e: null, r: '' };
const BASES = ['', '1st', '2nd', '3rd', 'Home'];

// el: where to draw. game: the game. opts.shared: someone else's game from a link (look, don't touch), with
// onSave to keep a copy. A game holding something from a newer Backwards K is look-only too, until a reload brings
// that version.
export function showGame(el, game, opts = {}) {
  later = newer(game);
  G = game; root = el; redo = []; kept = null; readOnly = !!opts.shared || later; onSave = opts.onSave || null; tapped = { e: null, r: '' };
  view = 'live'; cardSide = null; lastInn = '';
  if (readOnly) { view = matchMedia('(min-width: 700px)').matches ? 'live' : 'card'; pane = 'card'; }
  S = replay(G);
  // A link carries the game as it was when it was sent: one sent mid-game says so, so nobody waits on it for runs.
  note = later ? 'Part of this game was saved by a newer Backwards K. Reload to get it before changing this game.'
    : opts.note || (S.over ? 'A scorecard someone shared with you. Tap any box to see what happened.'
      : `The scorecard as it stood in the ${S.half ? 'bottom' : 'top'} of the ${ord(S.inn)}. The link doesn’t update: ask for a new one to see the rest. Tap any box to see what happened.`);
  el.innerHTML = frame();
  el.addEventListener('click', onClick);
  drive.chip($('.bar .cloud', el));
  // (Drawing it keeps the screen on while the game goes on: see paint().)
  draw();
}
export function leaveGame() {
  flush();
  if (root) root.removeEventListener('click', onClick);
  wake(false);
  G = S = root = null;
}
// Another tab, or Google Drive, changed what's stored (why is 'reload'), or this page saved something.
let told = '';
store.onChange(why => {
  if (!G || readOnly) return;
  if (why === 'saved') return trouble();
  const fresh = store.get(G.id);
  if (why === 'reload' && soon && soon.g === G) {
    // A name typed a moment ago isn't saved yet: it goes in, unless the game changed somewhere else meanwhile.
    if (fresh && fresh.updated <= G.updated) return flush();
    clearTimeout(soon.t);
    soon = null;
  }
  if (!fresh) {
    if (why === 'reload' && told !== G.id) { told = G.id; toast('This game was deleted on another device. Keep scoring to bring it back.', { ms: 6000 }); }
    return;
  }
  told = '';
  if (fresh === G) return;
  // (Plays changed somewhere else: the ones kept to put back may not belong after them.)
  if (plays(fresh.ev) !== plays(G.ev)) kept = null;
  G = fresh; S = replay(G); draw();
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
  moved();
  save();
  say();
}
// A new play (or a fix) after Undo. What Undo took back isn't thrown away: it's kept to put back after the new play,
// a forgotten steal scored where it happened, say (Put back, under the field, once the game has that many plays
// again: it waits while the new play is taken back with Undo). Plays Undo takes back after that go, as before.
function moved() {
  if (redo.length && !kept) kept = { stack: redo, n: G.ev.length };
  redo = [];
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
  const said = tidy(S.text[G.ev.length - 1]), was = `Took back: ${said}`;
  const r = takeBack(G);
  if (!r) return;
  redo.push(r);
  save();
  // How things stood before it, to tell whether it can go back as it was after other plays (fits() in engine.js).
  Object.assign(r, { at: { half: S.half, inn: S.inn, outs: S.outs, over: S.over }, said });
  if (wide() || view === 'live') return say(was);
  // On a phone's Card, Box score or Plays tab, the line under the field (and its Redo) is out of sight, so a message
  // says which play went, with Redo on it. What a screen reader hears then only adds where things stand.
  toast(was, { action: 'Redo', run: redoIt });
  speak(situation());
}
function redoIt() {
  const r = redo.pop();
  if (!r) return;
  putBack(G, r);
  save();
  say();
}
// Put back: the plays kept from before a new play went in go back after it, oldest first, each as it was if it still
// fits where the game is now (fits() in engine.js). A plate appearance with other runners on now opens its runners
// sheet, with the result kept (Cancel leaves it, and the rest, to put back). Anything else that no longer fits, a
// play from a half-inning that's over now or a steal by a runner who isn't there, is left out, and the message says so.
function putBackKept() {
  if (!kept) return;
  const list = kept.stack.slice().reverse();
  kept = null;
  redo = [];
  goBack(list, { put: 0, left: [], of: list.length });
}
function goBack(list, n) {
  for (let r; (r = list.shift());) {
    const e = r.e, why = fits(S, e, r.at);
    if (!why) putBack(G, r);
    else if (why === 'runners' && e.t === 'pa') {
      const m = suggest(S, e.r);
      if (!quiet(e.r)) return askBack(r, list, n, m);
      G.ev.push(withF({ t: 'pa', r: e.r, m }, e.f));
    } else { n.left.push(r.said); continue; }
    n.put++;
    S = replay(G);
  }
  save();
  const left = n.left.length, put = `Put back ${n.put === n.of ? few(n.put, 'play') : `${n.put} of ${few(n.of, 'play')}`}.`;
  if (!left) return say(put);
  const which = `${n.left.slice(0, 2).join(' ')}${left > 2 ? ` And ${left - 2} more.` : ''}`;
  const t = !n.put ? `${n.of > 1 ? `None of the ${n.of} plays fit` : 'That play doesn’t fit'} where the game is now, so ${n.of > 1 ? 'they’re' : 'it’s'} left out: ${which}`
    : `${put} ${left > 1 ? `${left} don’t` : 'One doesn’t'} fit where the game is now, so ${left > 1 ? 'they’re' : 'it’s'} left out: ${which}`;
  say(t);
  toast(t, { ms: 8000 });
}
// A play to put back whose runners are different now: its runners sheet, from where they are. What's back so far is
// saved, and the rest is kept to put back, in case of Cancel.
function askBack(r, list, n, m) {
  save();
  kept = { stack: [...list].reverse().concat([r]), n: G.ev.length };
  draw();
  const id = G.id, was = plays(G.ev);
  runnersSheet(r.e.r, r.e.f || null, m, {
    done: e2 => {
      if (!G || G.id !== id || plays(G.ev) !== was) return toast('The game changed somewhere else while this was open, so the play wasn’t put back.');
      kept = null;
      G.ev.push(e2);
      n.put++;
      S = replay(G);
      goBack(list, n);
    },
  });
}

// ---------- what a screen reader hears ----------
// After each tap, Undo, Redo and Fix runners, one region that stays on the page says the play and where things
// stand: "Brennan singles. Pruitt scores. Foxes 2, Comets 3. Runner on first, 1 out." After a pitch, the count. It's
// emptied and filled a moment later, so the same words twice are said twice.
let sayT = null;
const few = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const countWords = () => `${few(S.b, 'ball')}, ${few(S.s, 'strike')}`;
const tidy = t => String(t || '').replace(/ \(\d-\d\)$/, '.'); // "Ball (1-0)" is "Ball." once the count is said in words
function say(lead) {
  if (!root || !$('#said', root)) return;
  const i = G.ev.length - 1, e = G.ev[i], box = S.cells[S.cells.length - 1];
  const play = S.plays.find(x => x.i === i && x.kind !== 'end');
  let t;
  if (!lead && e && e.t === 'p' && !(box && box.ev === i)) t = `${tidy(S.text[i])} ${countWords()}.`;
  else t = [lead || tidy(S.text[i]), !lead && play && play.runs && !S.over ? score() : '', situation()].filter(Boolean).join(' ');
  speak(t);
}
function speak(t) {
  const el = root && $('#said', root);
  if (!el) return;
  clearTimeout(sayT);
  el.textContent = '';
  sayT = setTimeout(() => { el.textContent = t; }, 100);
}
const score = () => `${teamName(G, 0)} ${S.R[0]}, ${teamName(G, 1)} ${S.R[1]}.`;
// Where things stand, in words: who's on, the outs and the count; or the end of the half-inning, or of the game.
function situation() {
  if (S.over) return (S.ended ? '' : 'Final. ') + score();
  const end = S.plays[S.plays.length - 1];
  if (end && end.kind === 'end' && end.i === G.ev.length - 1) return end.text;
  const on = [1, 2, 3].filter(b => S.bases[b]).map(b => BASE[b]);
  const bases = !on.length ? 'Nobody on' : on.length === 3 ? 'Bases loaded' : `Runner${on.length > 1 ? 's' : ''} on ${on.join(' and ')}`;
  return `${bases}, ${S.outs ? few(S.outs, 'out') : 'nobody out'}${G.pitches && (S.b || S.s) ? `, ${countWords()}` : ''}.`;
}

// ---------- drawing ----------
function frame() {
  return `<header class="bar">
      <div class="bar-in">
        <a class="back" href="#/" aria-label="All games"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
        <div class="title"></div>
        <button type="button" class="cloud bar-btn" hidden></button>
        ${readOnly ? '' : `<button type="button" class="bar-btn undo" data-a="undo" aria-label="Undo" aria-keyshortcuts="U Control+Z Meta+Z"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Undo</span></button>`}
        ${readOnly ? '' : `<button type="button" class="bar-btn" data-a="menu" aria-label="Game menu"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="5" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/></svg></button>`}
      </div>
    </header>
    <main class="game">
      <h1 class="sr">${esc(teamName(G, 0))} at ${esc(teamName(G, 1))}</h1>
      ${readOnly ? '' : '<p class="sr" role="status" id="said"></p><div class="trouble" role="alert" hidden><p></p><button type="button" class="btn sm"></button></div>'}
      ${readOnly ? `<div class="shared-bar"><p>${esc(note)}</p>${later ? '<button type="button" class="btn sm" data-a="reload">Reload</button>' : ''}${onSave ? '<button type="button" class="btn primary sm" data-a="keep">Save to my games</button>' : ''}</div>` : ''}
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
    </main>`;
}

function draw() {
  if (root) keepFocus(paint);
}
function paint() {
  const game = $('.game', root);
  game.dataset.view = view;
  $('.side', root).dataset.pane = view === 'live' ? pane : view;
  $$('.vtabs button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === view || (view === 'live' && b.dataset.v === pane && wide()))));
  $('.bar .title', root).innerHTML = `<span class="score-line"><b>${esc(teamName(G, 0))}</b> <span class="r">${S.R[0]}</span><i>–</i><span class="r">${S.R[1]}</span> <b>${esc(teamName(G, 1))}</b></span><small>${esc(halfLabel(S))}${G.date ? ' · ' + esc(fmtDate(G.date)) : ''}</small>`;
  // (The buttons too are only drawn while they're on screen: not behind a phone's other tabs.)
  if (view === 'live' || wide()) $('.live', root).innerHTML = liveHtml(); else $('.live', root).replaceChildren();
  // The tab's title keeps the score, and the heading the teams' names as they change.
  document.title = `${teamName(G, 0)} ${S.R[0]}, ${teamName(G, 1)} ${S.R[1]} · ${halfLabel(S)} · Backwards K`;
  $('h1', root).textContent = `${teamName(G, 0)} at ${teamName(G, 1)}`;
  const u = $('.bar .undo', root);
  if (u) {
    u.disabled = !G.ev.length;
    const what = G.ev.length ? S.text[G.ev.length - 1] : '';
    u.title = what ? 'Undo: ' + what : 'Nothing to undo';
    u.setAttribute('aria-label', u.title);
  }
  drawSide();
  trouble();
  // (During a delay the screen can sleep: the game waits.)
  wake(!S.over && !S.delayed && !readOnly);
}
const wide = () => matchMedia('(min-width: 700px)').matches;
// The buttons and the card side by side (a tablet on its side, a computer).
const sideBySide = () => matchMedia('(min-width: 1000px)').matches;

// Drawing again replaces the buttons, so the one that had the keyboard (or that a sheet just gave it back to, as a
// sheet does when it closes) gets it again, found by what it is: the same pitch, result, runner, box or link. If it's
// gone (the runner moved on, the game ended), the first pitch button does, or the first thing to tap. Only a button
// that already had focus is focused again, so taps look the same.
const KEYS = ['p', 'r', 'a', 'runner', 'cs', 'cell', 'v'];
function keepFocus(paint) {
  const a = document.activeElement, had = !!root && !!a && a !== document.body && root.contains(a);
  const k = had && KEYS.find(x => a.dataset && a.dataset[x] !== undefined);
  // (Undo is in the bar and under the field: the one that had the keyboard keeps it.)
  const sel = k ? `${a.closest('.ticker') ? '.ticker ' : ''}[data-${k}="${a.dataset[k]}"]` : null;
  paint();
  if (!had || (a.isConnected && document.activeElement === a)) return;
  const el = [sel && $(sel, root), $('.live [data-p]', root), $('.live [data-r]:not(:disabled)', root), $('.final [data-a]', root)].find(x => x && !x.disabled);
  if (el) el.focus({ preventScroll: true });
}

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

// Only the pane on screen is drawn: on a phone, the Card, Box score or Plays tab when it's the one showing, and on a
// tablet or bigger, the one beside or under the buttons. The others are drawn when they're shown (a tap on a tab, or
// the screen turned), so a tap in the 9th doesn't redraw two long tables nobody can see.
const onScreen = () => (view !== 'live' ? view : wide() ? pane : '');
matchMedia('(min-width: 700px)').addEventListener('change', () => { if (root) draw(); });
function drawSide() {
  const shown = onScreen();
  for (const el of $$('.side .pane', root)) if (el.dataset.p !== shown) el.replaceChildren();
  if (shown === 'box') $('.pane[data-p=box]', root).innerHTML = `<div class="line-wrap">${lineHtml(S)}</div>${boxHtml(S)}`;
  if (shown === 'plays') $('.pane[data-p=plays]', root).innerHTML = `<div class="plays">${playsHtml(S)}</div>`;
  if (shown === 'card') drawCard();
  // A line score wider than the screen (extra innings on a phone) shows its end: the latest innings and R H E.
  for (const lw of $$('.line-wrap', root)) lw.scrollLeft = lw.scrollWidth;
}
function drawCard() {
  const side = cardSide ?? (S.over ? 0 : S.half);
  const card = $('.pane[data-p=card]', root);
  const wrap = card.querySelector('.card-wrap'), keepX = wrap ? wrap.scrollLeft : 0;
  card.innerHTML = `<div class="pane-top">
      <div class="seg" role="group" aria-label="Whose card">${[0, 1].map(s => `<button type="button" data-cs="${s}" aria-pressed="${s === side}">${esc(teamName(G, s))}${!S.over && S.half === s ? ' <i class="batting" title="Batting" aria-hidden="true">●</i><span class="sr">, batting</span>' : ''}</button>`).join('')}</div>
      <button type="button" class="link-btn" data-a="help">What the marks mean</button>
    </div>
    <div class="line-wrap">${lineHtml(S)}</div>
    <div class="card-wrap">${cardHtml(S, side, { live: !readOnly })}</div>`;
  const w = card.querySelector('.card-wrap');
  w.scrollLeft = keepX;
  // Keep the inning being played in view as the game moves along, and beside the buttons on a big screen, the
  // batter's box as each one comes up. (On a phone the card is a tab away and has no size while hidden, so this waits
  // until it's shown.)
  const key = `${side}:${S.inn}:${S.half}${sideBySide() ? ':' + S.up[side] : ''}`;
  if (key !== lastInn && card.offsetParent) {
    lastInn = key;
    requestAnimationFrame(() => scrollCard(w));
  }
}
// The batter's box on screen: the card scrolls sideways to his inning, with the box before it showing, right where the
// names end. And on a phone's Card tab, or beside the buttons on a big screen, the page scrolls when his row is below
// the screen or under the tabs (or the bar): his row just under them, with the row before it showing. (Not on a
// tablet held upright, where the card is under the buttons, nor while a sheet is open.)
function scrollCard(w) {
  if (!w.isConnected) return;
  const cur = w.querySelector('td.next') || w.querySelector('th.cur');
  if (!cur) return;
  const first = w.querySelector('tbody th.who'), left = first ? first.offsetWidth : 0;
  if (cur.offsetLeft - left < w.scrollLeft || cur.offsetLeft + cur.offsetWidth > w.scrollLeft + w.clientWidth) {
    const prev = cur.previousElementSibling;
    w.scrollLeft = prev && !prev.classList.contains('who') ? prev.offsetLeft - left : 0;
  }
  if (!cur.matches('td') || sheetOpen() || (wide() && !sideBySide())) return;
  // (scrollIntoView would move the card sideways too, and the box under the names.)
  const lid = $(sideBySide() ? '.bar' : '.vtabs', root), r = cur.getBoundingClientRect();
  const under = getComputedStyle(lid).position === 'sticky' ? Math.max(0, lid.getBoundingClientRect().bottom) : 0;
  if (r.bottom <= innerHeight - 12 && r.top >= under) return;
  const above = cur.parentElement.previousElementSibling || cur.closest('table').querySelector('thead tr');
  window.scrollBy(0, (above ? above.getBoundingClientRect().top : r.top) - under - 6);
}

function liveHtml() {
  const n = now(S), g = G;
  // The first time through, the order coming back round to the top is worth a warning: a youth team that bats
  // everyone may have more kids than the order has spots yet.
  const top = n.deck === 0 && S.size[n.side] > 1 && !S.cells.some(c => c.side === n.side && c.slot === n.slot);
  // After the final, whoever was left on base is still drawn there, but there's nothing more to tap; and during a
  // delay, nobody runs.
  const runner = b => {
    const r = S.bases[b];
    if (!r) return '';
    const [x, y] = BASE_AT[b], name = esc(label(player(g, r.side, r.slot, r.p), r.slot));
    if (S.over || S.delayed) return `<span class="runner left" style="left:${x}%;top:${y}%"><span class="sr">${S.over ? 'Left on' : 'On'} ${BASE[b]}: </span><span>${name}</span></span>`;
    return `<button type="button" class="runner" data-runner="${b}" style="left:${x}%;top:${y}%" aria-label="Runner on ${BASE[b]}: ${name}. Tap for steals and other moves."><span>${name}</span></button>`;
  };
  const dots = (on, of, cls) => Array.from({ length: of }, (_, i) => `<i class="${cls}${i < on ? ' on' : ''}"></i>`).join('');
  const bug = `<div class="bug">
      <div class="bug-teams">
        ${[0, 1].map(s => `<div class="bt${!S.over && S.half === s ? ' bat' : ''}${winner(S) === s ? ' won' : ''}"><span class="nm">${esc(teamName(g, s))}</span><span class="r">${S.R[s]}</span>${!S.over && S.half === s ? '<span class="sr">, batting</span>' : ''}</div>`).join('')}
      </div>
      <div class="bug-state">
        <div class="inn">${S.over ? `<b>${esc(halfLabel(S))}</b>` : `<span class="arrow" aria-hidden="true">${S.half ? '▼' : '▲'}</span><span class="sr">${S.half ? 'Bottom' : 'Top'} of the </span><b>${ord(S.inn)}</b>`}</div>
      </div>
    </div>`;
  if (readOnly) {
    return `${bug}<div class="field-col"><div class="field over">${infieldSvg()}</div></div>
      <div class="shared-note"><p>Every box on the card is one trip to the plate. Tap one to see what happened, or see <button type="button" class="link-btn" data-a="help">how to read the card</button>.</p>
      ${later && !onSave ? '' : '<a class="btn" href="#/new">Score your own game</a>'}</div>`;
  }
  // The count and the outs, as a ballpark's board shows them: a row of lamps each for B, S and O (just the outs when
  // pitches aren't counted, labelled OUT, since in the board's lettering an O on its own looks like a 0), in the
  // corner opposite On deck. The pitcher is on the mound, and the top edge is left to the runner on second.
  const lamps = (k, on, of, cls) => `<span class="lamps"><span aria-hidden="true">${k}</span>${dots(on, of, cls)}</span>`;
  const board = `<div class="count">${g.pitches ? `<span class="sr">${countWords()}</span>${lamps('B', S.b, 3, 'b')}${lamps('S', S.s, 2, 's')}` : ''}<span class="lamps outs"><span aria-hidden="true">${g.pitches ? 'O' : 'OUT'}</span>${dots(S.outs, 2, 'o')}<span class="sr">${few(S.outs, 'out')}</span></span></div>`;
  const field = `<div class="field${S.over ? ' over' : ''}">
      ${infieldSvg()}
      ${[3, 2, 1].map(runner).join('')}
      ${S.over ? '' : `<button type="button" class="batter" data-a="batter" style="left:${BASE_AT[0][0]}%;top:${BASE_AT[0][1]}%" aria-label="At bat: ${esc(n.name)}. Tap to name or pinch-hit."><small>${n.slot + 1}</small><span>${esc(n.name)}</span></button>`}
      ${S.over ? '' : `<p class="deck"><span>On deck</span> ${esc(n.deckName)}${top ? '<small>Top of the order</small>' : ''}</p>`}
      ${S.over ? '' : board}
      ${S.over ? '' : `<button type="button" class="pitcher" data-a="pitcher" aria-label="Pitching: ${esc(n.pitcherName)}${g.pitches ? ', ' + n.pitches + ' pitches' : ''}. Tap to change pitchers."><span>${esc(n.pitcherName)}</span>${g.pitches ? `<b>${n.pitches}</b><small>pitch${n.pitches === 1 ? '' : 'es'}</small>` : ''}</button>`}
    </div>`;
  const last = G.ev.length ? S.text[G.ev.length - 1] : '';
  // The links have a row of their own (beside the play, on a big screen), each a thumb's height, and the line a fixed
  // height, so the buttons below never move. Undo comes first: it takes back the play just above it.
  const k = fixable(), fix = k < 0 ? '' : `Fix runners: ${S.text[k]}`, back = last && `Undo: ${last}`;
  const keep = !redo.length && kept && G.ev.length >= kept.n ? kept.stack.length : 0;
  const ticker = `<div class="ticker">
      <p>${last ? esc(last) : 'Tap what happens. Every tap can be undone.'}</p>
      <div class="acts">${back ? `<button type="button" class="link-btn" data-a="undo" title="${esc(back)}" aria-label="${esc(back)}">Undo</button>` : ''}${fix ? `<button type="button" class="link-btn" data-a="fixlast" title="${esc(fix)}" aria-label="${esc(fix)}">Fix runners</button>` : ''}${redo.length ? '<button type="button" class="link-btn" data-a="redo">Redo</button>' : ''}${keep ? `<button type="button" class="link-btn" data-a="putback">Put back ${few(keep, 'play')}</button>` : ''}</div>
    </div>`;
  // Over: who won, or for a game called before it counted, who's ahead (OBR 7.01(c)). A run rule or a time limit says
  // so after the score.
  if (S.over) {
    const lead = S.R[1] > S.R[0] ? 1 : 0, n = regulation(g.innings);
    const tag = S.why ? ENDS[S.why].short : S.mercy ? `${S.mercy.by}-run rule` : '';
    const head = S.R[0] === S.R[1] ? `Tied, ${S.R[0]}–${S.R[1]}`
      : `${esc(teamName(g, lead))} ${winner(S) == null ? 'ahead' : 'win'}, ${S.R[lead]}–${S.R[1 - lead]}${tag ? ` <small>(${tag})</small>` : ''}`;
    const says = S.mercy ? `That’s the ballgame, on the ${S.mercy.by}-run rule after ${S.mercy.inn} inning${S.mercy.inn === '1' ? '' : 's'}.`
      : !S.ended ? 'That’s the ballgame.' : S.why ? `${ENDS[S.why].text}` : official(S) ? 'The game was called, and it counts.'
      : `The game was called before it was official: that takes ${n} innings, or ${n - 1}½ with the home team ahead. Keep playing picks it up where it stopped.`;
    return `${bug}<div class="field-col">${field}${ticker}</div><div class="final">
        <h2>${head}</h2>
        <p>${says} The whole card is ${sideBySide() ? 'beside this' : wide() ? 'below' : 'under <b>Card</b>'}, and the box score under <b>Box score</b>.</p>
        <div class="row"><button type="button" class="btn primary" data-a="share">Share this game</button><button type="button" class="btn" data-a="on">Keep playing</button></div>
      </div>`;
  }
  // Stopped for a delay: where things stand stays drawn, and one tap picks it up again. A substitution or a new
  // pitcher can go in meanwhile (tap the batter or the pitcher).
  if (S.delayed) {
    return `${bug}<div class="field-col">${field}${ticker}</div><div class="final delayed">
        <h2>Delayed</h2>
        <p>Play stopped in the ${S.half ? 'bottom' : 'top'} of the ${ord(S.inn)}. The game waits here, and the screen can sleep. Resume when play starts again.</p>
        <div class="row"><button type="button" class="btn primary" data-a="on">Resume play</button><button type="button" class="btn" data-a="endgame">End the game here</button></div>
      </div>`;
  }
  const can = {
    SF: S.bases[3] && S.outs < 2, SAC: runnersOn(S).length && S.outs < 2, DP: runnersOn(S).length && S.outs < 2,
    FC: runnersOn(S).length,
  };
  const key = k => (k ? ` aria-keyshortcuts="${k}"` : '');
  const res = (code, big, small) => `<button type="button" class="res r-${RESULTS[code].kind}" data-r="${code}"${key(KEY_OF[code])}${code in can && !can[code] ? ' disabled' : ''}><b>${big}</b><span>${small}</span></button>`;
  const pitches = g.pitches ? `<div class="pad pitches" role="group" aria-label="Pitches">
      <button type="button" class="pt ball" data-p="b"${key('B')}><b>Ball</b></button>
      <button type="button" class="pt" data-p="c"${key('C')}><b>Strike</b><span>looking</span></button>
      <button type="button" class="pt" data-p="s"${key('S')}><b>Strike</b><span>swinging</span></button>
      <button type="button" class="pt" data-p="f"${key('F')}><b>Foul</b></button>
    </div>` : '';
  return `${bug}<div class="field-col">${field}${ticker}</div>
    <div class="pads">
    ${pitches}
    <div class="pad results" role="group" aria-label="What the batter did">
      <div class="row4 g-hit" role="group" aria-label="Hits">${res('1B', '1B', 'Single')}${res('2B', '2B', 'Double')}${res('3B', '3B', 'Triple')}${res('HR', 'HR', 'Home run')}</div>
      <div class="row4 g-on" role="group" aria-label="On base without a hit">${res('BB', 'BB', 'Walk')}${res('HBP', 'HBP', 'Hit by pitch')}${res('E', 'E', 'Error')}${res('FC', 'FC', 'Fielder’s choice')}</div>
      <div class="row4 g-out" role="group" aria-label="Outs">${res('K', 'K', 'Strikeout')}${res('KL', KL, 'Strikeout looking')}${res('GO', 'G', 'Ground out')}${res('FO', 'F', 'Fly out')}
        ${res('LO', 'L', 'Line out')}${res('PU', 'P', 'Pop out')}${res('SF', 'SF', 'Sac fly')}${res('SAC', 'SAC', 'Sac bunt')}
        ${res('DP', 'DP', 'Double play')}<button type="button" class="res r-more" data-a="more"${key('M')}><b>More</b><span>Intentional walk, dropped third strike, end the inning</span></button></div>
    </div>
    </div>
    <div class="recent"><h3>Latest plays</h3>${playsHtml(S, { limit: 5 })}</div>`;
}

// ---------- taps ----------
function onClick(e) {
  const t = e.target.closest('[data-a],[data-r],[data-p],[data-runner],[data-cell],[data-v],[data-cs]');
  if (!t || t.disabled) return;
  if (t.dataset.v) {
    view = t.dataset.v;
    if (view !== 'live') pane = view;
    if (view === 'card') lastInn = ''; // the card opens on the batter's box (see scrollCard)
    if (!wide()) window.scrollTo({ top: 0 });
    draw();
    return;
  }
  if (t.dataset.cs) { cardSide = +t.dataset.cs; keepFocus(drawSide); return; }
  if (t.dataset.cell) return cellSheet(S.cells[+t.dataset.cell]);
  if (readOnly) { if (t.dataset.a === 'keep') onSave(); if (t.dataset.a === 'help') helpSheet(); if (t.dataset.a === 'reload') location.reload(); return; }
  if (t.dataset.p) return act({ t: 'p', k: t.dataset.p });
  if (t.dataset.r) return choose(t.dataset.r);
  if (t.dataset.runner) return runnerSheet(+t.dataset.runner);
  switch (t.dataset.a) {
    case 'undo': return undo();
    case 'redo': return redoIt();
    case 'putback': return putBackKept();
    case 'fixlast': return fixLast();
    case 'more': return moreSheet();
    case 'batter': return batterSheet();
    case 'pitcher': return pitcherSheet(1 - S.half);
    case 'menu': return menuSheet();
    case 'help': return helpSheet();
    case 'share': return shareSheet(G);
    case 'file': return saveFile(G);
    case 'on': return act({ t: 'on' });
    case 'endgame': return endSheet();
  }
}

// ---------- scoring from a keyboard ----------
// For a scorer at a laptop, or following on TV: a key for each pitch and the everyday results, More, and Undo. Only
// with no sheet open and nothing being typed in; a sheet that opens (the fielders, say) takes its own keys, so G 6 3
// Enter scores a 6-3. A key held down counts once: the keyboard's repeats would be more balls, and soon a walk.
const KEYS_TO = { b: ['p', 'b'], c: ['p', 'c'], s: ['p', 's'], f: ['p', 'f'], 1: ['r', '1B'], 2: ['r', '2B'], 3: ['r', '3B'], 4: ['r', 'HR'],
  w: ['r', 'BB'], h: ['r', 'HBP'], e: ['r', 'E'], k: ['r', 'K'], K: ['r', 'KL'], g: ['r', 'GO'], y: ['r', 'FO'], l: ['r', 'LO'], p: ['r', 'PU'], m: ['a', 'more'], u: ['a', 'undo'] };
const KEY_OF = { '1B': '1', '2B': '2', '3B': '3', HR: '4', BB: 'W', HBP: 'H', E: 'E', K: 'K', KL: 'Shift+K', GO: 'G', FO: 'Y', LO: 'L', PU: 'P' };
document.addEventListener('keydown', e => {
  if (!root || readOnly || e.defaultPrevented || e.repeat || e.altKey || e.isComposing || sheetOpen()) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : '';
  const [what, v] = (e.ctrlKey || e.metaKey ? (k === 'z' && !e.shiftKey ? KEYS_TO.u : null) : KEYS_TO[k === 'k' && e.shiftKey ? 'K' : k]) || [];
  if (!what) return;
  // (Pitches, results and More only while their buttons are on screen and the game is going.)
  if (what !== 'a' || v !== 'undo') {
    const b = $(`.live ${what === 'p' ? `[data-p="${v}"]` : what === 'r' ? `[data-r="${v}"]` : '[data-a=more]'}`, root);
    if (!b || b.disabled) return;
  }
  e.preventDefault();
  if (what === 'p') act({ t: 'p', k: v });
  else if (what === 'r') choose(v);
  else if (v === 'more') moreSheet();
  else undo();
});

// ---------- a plate appearance: result, then fielders, then where the runners went ----------
function choose(code, f) {
  const R = RESULTS[code];
  if (R.f && f === undefined) return pickFielders(code, null, got => choose(code, got));
  const m = suggest(S, code);
  // With two out, a runner on second is off with the pitch and usually scores on a single: Home is picked for him.
  if (code === '1B' && S.outs === 2 && S.bases[2]) m.find(x => x[0] === 2)[1] = 4;
  // (For the odd one that went differently, Fix runners is right under the field.)
  if (quiet(code)) {
    closeSheet();
    const e = withF({ t: 'pa', r: code, m }, f);
    tapped = { e, r: code };
    return act(e);
  }
  runnersSheet(code, f, m);
}
const withF = (e, f) => { if (f && f.length) e.f = f; return e; };
const QUIET = new Set(['K', 'KL', 'PU', 'BB', 'IBB', 'HBP', 'CI']);
// Nothing to ask about the runners: nobody on, a play where runners only move when they're forced, the batter making
// the third out (nobody can move up or score on that), or a double play with one runner on or a triple play with two
// (everyone is out).
function quiet(code) {
  const on = runnersOn(S).length;
  return !on || QUIET.has(code) || (S.outs === 2 && RESULTS[code].kind === 'out') || (code === 'DP' && on === 1) || (code === 'TP' && on === 2);
}

const HINT = {
  GO: 'Tap the fielder who got the ball, then whoever made the out. Short to first is 6, then 3.',
  FC: 'Tap who fielded it, then who made the out on the runner. Short to second is 6, then 4.',
  DP: 'Tap each fielder in order. Short to second to first is 6, 4, 3.',
  TP: 'Tap each fielder in order.',
  SAC: 'Tap who fielded the bunt, then who made the out.',
  E: 'Tap the fielder who made the error.',
};
// Who fielded it. One tap for a catch or an error; a sequence for throws. Skipping is fine. From a keyboard, the
// fielders' numbers pick them too, Backspace takes the last one back, and Enter is Done.
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
    // Redrawn with each pick: the fielder that had the keyboard keeps it.
    const had = body.querySelector('[data-pos]:focus');
    body.querySelector('.pick').innerHTML = fieldSvg({ picked: seq });
    if (had) body.querySelector(`[data-pos="${had.dataset.pos}"]`).focus({ preventScroll: true });
    body.querySelector('.seq').innerHTML = seq.length ? `<b>${esc(mark(code === 'GO' && seq.length === 1 ? 'GO' : code, seq))}</b> ${esc(seq.map(n => POS_NAME[n]).join(' to '))}` : '&nbsp;';
    const d = body.querySelector('[data-x=done]');
    if (d) d.disabled = !seq.length;
  };
  const add = n => {
    seq.push(n);
    if (one) return done(seq);
    if (seq.length > 6) seq = seq.slice(-6);
    upd();
  };
  upd();
  body.addEventListener('click', e => {
    const p = e.target.closest('[data-pos]'), x = e.target.closest('[data-x]');
    if (p) add(+p.dataset.pos);
    else if (x) {
      if (x.dataset.x === 'back') { seq.pop(); upd(); }
      if (x.dataset.x === 'skip') done(null);
      if (x.dataset.x === 'done') done(seq);
    }
  });
  body.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); add(+e.key); }
    else if (e.key === 'Backspace' && !one) { e.preventDefault(); seq.pop(); upd(); }
    else if (e.key === 'Enter' && !one && seq.length && !e.target.closest('button,[role=button]')) { e.preventDefault(); done(seq); }
  });
}

// Everyone on base, and the batter, with where they most likely ended up already picked.
// st: how things stood before the play (kept here, since another tab or Drive can change the game meanwhile).
// done: what to do with the play once it's saved; a new play is added to the game.
function runnersSheet(code, f, moves, { st = S, editing = false, done = act } = {}) {
  const R = RESULTS[code], n = now(st);
  const m = moves.map(x => x.slice());
  const counts = { v: runsCount(st, code, m) };
  let userSaid = null, asked = null;
  const who = b => (b === 0 ? n.name : label(player(G, st.bases[b].side, st.bases[b].slot, st.bases[b].p), st.bases[b].slot));
  const body = openSheet(`<h2 id="sheetTitle">${R.kind === 'out' && code !== 'KL' && code !== 'K' ? esc(R.label) : code === 'KL' ? 'Strikeout looking' : esc(R.label)}${f && f.length ? ` <span class="mk">${esc(mark(code, f))}</span>` : ''}</h2>
    <p class="hint">Here’s where everyone usually ends up. Change anything that went differently.</p>
    <div class="moves"></div>
    <p class="tally" aria-live="polite"></p>
    <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button><button type="button" class="btn primary" data-x="save">${editing ? 'Save changes' : 'Save play'}</button></div>`);
  function draw() {
    // The chip that had the keyboard keeps it.
    const had = body.querySelector('[data-to]:focus, [data-runs]:focus');
    const again = had && (had.dataset.runs ? `[data-runs="${had.dataset.runs}"]` : `[data-from="${had.closest('[data-from]').dataset.from}"] [data-to="${had.dataset.to}"]`);
    const rows = m.slice().sort((a, b) => b[0] - a[0]).map(([from, to]) => {
      const opts = [0, ...[1, 2, 3, 4].filter(b => b >= Math.max(from, 1))];
      return `<div class="mv" data-from="${from}">
        <p><b>${esc(who(from))}</b><span>${from ? `was on ${BASE[from]}` : 'at bat'}</span></p>
        <div class="chips" role="group" aria-label="Where ${esc(who(from))} ended up">${opts.map(b => `<button type="button" data-to="${b}" aria-pressed="${b === to}" class="${b === 0 ? 'out' : b === 4 ? 'home' : ''}">${b === 0 ? 'Out' : b === from ? 'Stayed' : BASES[b]}</button>`).join('')}</div>
      </div>`;
    });
    body.querySelector('.moves').innerHTML = rows.join('');
    // (In Fix runners the play is in the game already, so changing what it was is a job for Undo.)
    const said = check(st, m, code), err = editing ? said.replace('Cancel and', 'Undo back to that play and') : said;
    const outs = m.filter(x => x[1] === 0).length, runs = m.filter(x => x[1] === 4).length;
    const third = st.outs + outs >= 3 && runs > 0;
    if (userSaid == null) counts.v = runsCount(st, code, m);
    const need = winningRun(st, code, m, third && !counts.v);
    let t = '';
    if (err) t = `<span class="err">${esc(err)}</span>`;
    // The run that puts the home team ahead in its last turn ends the game: the runs behind it don't score, and a hit
    // counts for the bases it took.
    else if (need) t = `The winning run scores, and that’s the game.${creditedHit(code, need, m) !== code ? ' ' + credit(code, creditedHit(code, need, m)) : ''}`;
    else {
      const bits = [];
      if (runs) bits.push(`${runs} run${runs > 1 ? 's' : ''} ${third && !counts.v ? (runs > 1 ? 'cross' : 'crosses') : (runs > 1 ? 'score' : 'scores')}`);
      bits.push(`${st.outs + outs} out${st.outs + outs === 1 ? '' : 's'}${st.outs + outs >= 3 ? ', side retired' : ''}`);
      t = bits.join(' · ');
    }
    if (!err && third) t += `<span class="third">That’s the third out. Did the run${runs > 1 ? 's' : ''} cross the plate before it?
        <span class="chips"><button type="button" data-runs="1" aria-pressed="${counts.v}">Yes, ${runs > 1 ? 'they count' : 'it counts'}</button><button type="button" data-runs="0" aria-pressed="${!counts.v}">No</button></span></span>`;
    const tally = body.querySelector('.tally');
    tally.innerHTML = t;
    body.querySelector('[data-x=save]').disabled = !!err;
    // What's wrong, or the third-out question, that a tap just brought up shows above Save play, not under it.
    const ask = err || (third ? 'third' : '');
    if (ask && asked !== null && ask !== asked) reveal(tally);
    asked = ask;
    if (again && body.querySelector(again)) body.querySelector(again).focus({ preventScroll: true });
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
      // A sacrifice fly or bunt, or not, from where everyone ended up.
      const e2 = withF({ t: 'pa', r: scoredAs(st, code, f, m), m }, f);
      if (third && !counts.v) e2.x = 1;
      if (!editing) tapped = { e: e2, r: code };
      closeSheet();
      done(e2);
    }
  });
}

// The play Fix runners changes, by its place in the game, or -1. It's the latest plate appearance, when there were
// runners or the batter got on (after an out with the bases empty there's nobody to move), and while nothing but
// pitches to the next batter has come after it: his at-bat is still going, in the same half-inning. (A play this
// version doesn't know, from a damaged file or a newer copy of the app, has nothing to fix here.)
function fixable() {
  let k = G.ev.length - 1;
  while (k >= 0 && G.ev[k].t === 'p') k--;
  const e = G.ev[k], R = e && RESULTS[e.r];
  if (!R || e.t !== 'pa' || !e.m || (e.m.length < 2 && R.kind === 'out')) return -1;
  const box = S.cells[S.cells.length - 1];
  if (k < G.ev.length - 1 && (S.over || !box || box.ev !== k || box.side !== S.half || box.inn !== S.inn)) return -1;
  return k;
}

// That play's runners, again: ask where everyone went, from how things stood before it. The game itself is left
// alone until Save changes, so leaving the screen or cancelling loses nothing. Pitches since then stay: they don't
// depend on where the runners are. But a fix that changes the outs or the half-inning would leave them thrown in
// the wrong place, so with pitches since, that's a job for Undo.
function fixLast() {
  const k = fixable();
  if (k < 0) return;
  const e = G.ev[k], id = G.id, was = plays(G.ev), code = tapped.e === e ? tapped.r : e.r;
  runnersSheet(code, e.f || null, e.m, {
    st: replay(G, k),
    editing: true,
    done: e2 => {
      // Another tab or Google Drive changed the plays while the sheet was open: the fix may not fit any more.
      if (!G || G.id !== id || plays(G.ev) !== was) return toast('The game changed somewhere else while this was open, so the fix wasn’t saved.');
      if (k < G.ev.length - 1) {
        const S2 = replay({ ...G, ev: G.ev.map((x, i) => (i === k ? e2 : x)) });
        if (S2.over && !S.over) return toast('That ends the game. Undo back to that play instead.');
        if (S2.half !== S.half || S2.inn !== S.inn || S2.outs !== S.outs) return toast('That changes the outs. Undo back to that play instead.');
      }
      G.ev[k] = e2;
      tapped = { e: e2, r: code };
      moved();
      save();
      say(`Fixed: ${S.text[k]}`);
    },
  });
}

function moreSheet() {
  // With first base taken and fewer than two out, a dropped third strike is still an out (OBR 5.09(a)(3)).
  const firstTaken = !!S.bases[1] && S.outs < 2;
  const can = { TP: runnersOn(S).length >= 2 && S.outs === 0, KD: (S.s >= 2 || !G.pitches) && !firstTaken };
  const item = (code, text) => `<button type="button" class="res r-${RESULTS[code].kind}" data-r2="${code}"${code in can && !can[code] ? ' disabled' : ''}><b>${esc(mark(code))}</b><span>${esc(text)}</span></button>`;
  const body = openSheet(`<h2 id="sheetTitle">Something else</h2>
    <div class="row2">
      ${item('IBB', 'Intentional walk')}
      ${item('KD', firstTaken ? 'No dropped third strike with a runner on first and fewer than two out' : 'Struck out, but reached on a dropped third strike')}
      ${item('CI', 'Reached on catcher’s interference')}
      ${item('TP', 'Triple play')}
    </div>
    <h3>The inning or the game</h3>
    <div class="list">
      <button type="button" class="li" data-y="eoh"><b>End this half-inning</b><span>For a run limit or the clock. The next team comes up.</span></button>
      <button type="button" class="li" data-y="end"><b>End the game here</b><span>Or stop for a delay. Rain, a run rule, or out of time. You can keep playing later.</span></button>
    </div>
    <div class="row"><button type="button" class="btn quiet" data-close>Close</button></div>`);
  body.addEventListener('click', e => {
    const r = e.target.closest('[data-r2]'), y = e.target.closest('[data-y]');
    if (r && !r.disabled) choose(r.dataset.r2);
    if (y && y.dataset.y === 'end') return endSheet();
    if (y) { closeSheet(); act({ t: y.dataset.y }); }
  });
}

// Ending the game early. Stopping for a delay: the game waits, as it was. Over on a run rule or a time limit: the game
// is complete, and reads Final. Called for rain or darkness: it reads Called, and until it has gone far enough to
// count (OBR 7.01(c)), the team in front is ahead, not the winner.
function endSheet() {
  const n = regulation(G.innings);
  const body = openSheet(`<h2 id="sheetTitle">End the game here</h2>
    <div class="list">
      ${S.delayed ? '' : '<button type="button" class="li" data-end="delay"><b>Stop for a delay</b><span>Rain, lightning, or the field. The game waits, the screen can sleep, and one tap picks it up again.</span></button>'}
      <button type="button" class="li" data-end="rule"><b>Game over: run rule</b><span>A team far enough ahead. It reads Final (run rule).</span></button>
      <button type="button" class="li" data-end="time"><b>Game over: time limit</b><span>Out of time. It reads Final (time limit).</span></button>
      <button type="button" class="li" data-end="called"><b>Called: rain or darkness</b><span>It reads Called. Until ${n} innings are in (${n - 1}½ with the home team ahead), the team in front is ahead, not the winner.</span></button>
    </div>
    <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button></div>`);
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-end]');
    if (!b) return;
    const k = b.dataset.end;
    closeSheet();
    act(k === 'delay' ? { t: 'delay' } : k === 'called' ? { t: 'end' } : { t: 'end', why: k });
  });
}

// ---------- a runner: steals, wild pitches, pickoffs ----------
function runnerSheet(b) {
  const r = S.bases[b];
  if (!r || S.over || S.delayed) return;
  const name = label(player(G, r.side, r.slot, r.p), r.slot), next = b + 1;
  // Where each runner ended up when they moved up without a hit. Everyone else on base can move up on the same wild
  // pitch, passed ball or throw; they stayed unless the scorer says otherwise.
  const to = { [b]: next }, others = runnersOn(S).filter(x => x !== b);
  for (const x of others) to[x] = x;
  const who = x => label(player(G, S.bases[x].side, S.bases[x].slot, S.bases[x].p), S.bases[x].slot);
  const chips = (x, words) => `<span class="chips" role="group" aria-label="${esc(words)}">${[1, 2, 3, 4].filter(y => y > x || (y === x && x !== b)).map(y => `<button type="button" data-to="${y}" aria-pressed="${y === to[x]}"${y === 4 ? ' class="home"' : ''}>${y === x ? 'Stayed' : BASES[y]}</button>`).join('')}</span>`;
  const body = openSheet(`<h2 id="sheetTitle">${esc(name)} <small>on ${BASE[b]}</small></h2>
    <div class="row2">
      <button type="button" class="res r-hit" data-k="SB"><b>SB</b><span>Stole ${BASE[next]}</span></button>
      <button type="button" class="res r-out" data-k="CS"><b>CS</b><span>Caught stealing</span></button>
      <button type="button" class="res r-out" data-k="PO"><b>PO</b><span>Picked off ${BASE[b]}</span></button>
      <button type="button" class="res r-out" data-k="OB"><b>Out</b><span>Out on the bases, another way</span></button>
    </div>
    <h3>Moved up without a hit</h3>
    <div class="to" data-from="${b}"><span>To</span>${chips(b, `Where ${name} moved to`)}</div>
    ${others.length ? `<div class="also">${others.map(x => `<div class="mv" data-from="${x}"><p><b>${esc(who(x))}</b><span>on ${BASE[x]}</span></p>${chips(x, `Where ${who(x)} ended up`)}</div>`).join('')}</div>` : ''}
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
    if (c) {
      const row = c.closest('[data-from]');
      to[row.dataset.from] = +c.dataset.to;
      $$('[data-to]', row).forEach(x => x.setAttribute('aria-pressed', String(x === c)));
      return;
    }
    if (!k) return;
    const how = k.dataset.k;
    if (how === 'PR') return subForm(r.side, r.slot, 'pr');
    if (how === 'BK') { closeSheet(); return act({ t: 'r', m: runnersOn(S).map(x => [x, x + 1, 'BK']) }); }
    if (how === 'SB') { if (S.bases[next] && next < 4) return toast(`Someone’s already on ${BASE[next]}. Move them first.`); closeSheet(); return act({ t: 'r', m: [[b, next, 'SB']] }); }
    if (how === 'CS' || how === 'PO' || how === 'OB') {
      closeSheet();
      return act({ t: 'r', m: [[b, 0, how]] });
    }
    // Moved up: everyone who moved, in one play, lead runner first.
    const moves = runnersOn(S).filter(x => to[x] !== x).map(x => [x, to[x], how]);
    const err = jam(moves);
    if (err) return toast(err);
    if (how === 'E') return pickFielders('E', null, f => { closeSheet(); act({ t: 'r', m: f && f.length ? moves.map(m => [...m, f]) : moves }); }, { title: 'Error' });
    closeSheet();
    act({ t: 'r', m: moves });
  });
}
// What's wrong with where the runners would be after some of them move up, in words, or '' if it could happen: two
// on one base, or one passing the runner ahead (often because the runner ahead stayed).
function jam(moves) {
  const at = runnersOn(S).map(x => [x, (moves.find(m => m[0] === x) || [x, x])[1]]);
  for (let i = 1; i < at.length; i++) {
    const [from, ahead] = at[i - 1], behind = at[i][1];
    if (behind < ahead || (behind === 4 && ahead === 4)) continue;
    if (ahead === from) return `Someone’s on ${BASE[from]}. Move them up too.`;
    return behind === ahead ? `Two runners can’t both be on ${BASE[ahead]}.` : 'A runner can’t pass the runner ahead of them.';
  }
  return '';
}

// ---------- who's batting and pitching ----------
// A name's field is left alone by a phone's keyboard: no autocorrect (which turns Jaxon into Jason as the space after
// it is typed) and no red underline, just a capital at the start of each word. Team and place names too.
// who: whose fields these are, when a list has many ("Batter 3"), so each says so ("Batter 3 name").
function nameFields(p, prefix = '', who = '') {
  const named = w => (who ? ` aria-label="${esc(`${who} ${w}`)}"` : '');
  return `<div class="name-row">
    <label class="num"><span>No.</span><input ${prefix}data-f="num" inputmode="numeric" maxlength="4" value="${esc(p.num)}" autocomplete="off"${named('number')}></label>
    <label class="nm"><span>Name</span><input ${prefix}data-f="name" maxlength="40" value="${esc(p.name)}" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" placeholder="Optional"${named('name')}></label>
  </div>`;
}
// who(): the player those fields are for, found again with each key typed: storage read again (another tab saved,
// or Google Drive) brings in a new copy of the game, and a name typed after that goes in that copy.
function bindName(body, who, sel = '') {
  $$(`${sel}[data-f]`, body).forEach(i => i.addEventListener('input', () => {
    const p = G && who();
    if (!p) return;
    p[i.dataset.f] = i.value.trim(); saveSoon(); draw();
  }));
}

function batterSheet() {
  const n = now(S), p = G.teams[n.side].lineup[n.slot][n.p];
  // Their day so far, for the parent whose kid just walked up: every trip in order, then what it adds up to.
  const day = dayOf(S, n.side, n.slot, n.p);
  const body = openSheet(`<h2 id="sheetTitle">At bat <small>${ord(n.slot + 1)} in the order for ${esc(teamName(G, n.side))}</small></h2>
    ${nameFields(p)}
    ${day.line ? `<div class="today"><p><b>Today</b> ${day.trips.map(t => `<span>${ord(t.inn)}: ${markHtml(t.r, t.mark)}, ${esc(t.words)}</span>`).join(' · ')}</p><p class="quiet">${esc(day.line)}.</p></div>` : ''}
    <div class="list">
      <button type="button" class="li" data-y="ph"><b>Pinch hitter</b><span>Someone else bats in this spot.</span></button>
      <button type="button" class="li" data-y="add"><b>Add a batter to the order</b><span>For a team that bats everyone: a new spot after ${esc(label(player(G, n.side, S.size[n.side] - 1, S.pl[n.side][S.size[n.side] - 1] || 0), S.size[n.side] - 1))}.</span></button>
      <button type="button" class="li" data-y="lineup"><b>The whole lineup</b><span>Names, numbers and substitutions for both teams.</span></button>
    </div>
    <div class="row"><button type="button" class="btn primary" data-close>Done</button></div>`);
  bindName(body, () => G.teams[n.side].lineup[n.slot]?.[n.p]);
  body.addEventListener('click', e => {
    const y = e.target.closest('[data-y]');
    if (y && y.dataset.y === 'ph') subForm(n.side, n.slot, 'ph');
    if (y && y.dataset.y === 'lineup') lineupSheet(n.side);
    if (y && y.dataset.y === 'add') {
      closeSheet();
      G.teams[n.side].lineup.push([blank()]);
      act({ t: 'add', s: n.side });
    }
  });
}

// Everyone who has been in a batting slot but isn't now, by their place in it: [[index, player]].
function earlier(side, slot) {
  const cur = S.pl[side][slot] ?? 0, list = G.teams[side].lineup[slot] || [];
  const been = new Set([0, ...G.ev.filter(e => e.t === 'sub' && e.s === side && e.slot === slot).map(e => e.i)]);
  return [...been].filter(i => i !== cur && list[i]).map(i => [i, list[i]]);
}
const named = (p, slot) => label(p, slot) + (p.name && p.num ? ' #' + p.num : '');

// A new player in a batting slot: a pinch hitter, a pinch runner, or a change in the field. Or someone who was in
// this spot before coming back in (a starter re-entering, or the runner who ran for him), as the same player.
// done: what comes next (the Lineups sheet again, for several changes in a row); otherwise back to the game.
function subForm(side, slot, ty, done) {
  const p = blank(), was = label(player(G, side, slot, S.pl[side][slot]), slot), back = earlier(side, slot);
  const words = { ph: 'Pinch hitter', pr: 'Pinch runner', def: 'Substitute' };
  // Whoever comes in for a player who's on base runs for him there.
  const on = side === S.half ? [1, 2, 3].find(b => S.bases[b] && S.bases[b].slot === slot && S.bases[b].p === S.pl[side][slot]) : undefined;
  if (on) ty = 'pr';
  const body = openSheet(`<h2 id="sheetTitle">${words[ty]} <small>for ${esc(was)}</small></h2>
    ${back.length ? `<p class="pick-row"><span>Back in:</span>${back.map(([i, x]) => `<button type="button" class="chip" data-back="${i}">${esc(named(x, slot))}</button>`).join('')}</p>` : ''}
    ${nameFields(p)}
    <div class="chips wide" role="group" aria-label="What kind of substitution">${Object.entries(words).map(([k, w]) => `<button type="button" data-ty="${k}" aria-pressed="${k === ty}">${w}</button>`).join('')}</div>
    <p class="hint">${on ? `They run for ${esc(was)} on ${BASE[on]}, and take that spot in the batting order from now on.` : `They take ${esc(was)}’s place in the batting order from now on.`}</p>
    <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button><button type="button" class="btn primary" data-x="go">Put them in</button></div>`);
  $$('[data-f]', body).forEach(i => i.addEventListener('input', () => { p[i.dataset.f] = i.value.trim(); }));
  body.addEventListener('click', e => {
    const t = e.target.closest('[data-ty]'), b = e.target.closest('[data-back]');
    if (t) { ty = t.dataset.ty; $$('[data-ty]', body).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.ty === ty))); body.querySelector('h2').firstChild.textContent = words[ty] + ' '; }
    if (b) {
      closeSheet();
      act({ t: 'sub', s: side, slot, i: +b.dataset.back, ty });
      if (done) done();
      return;
    }
    if (e.target.closest('[data-x=go]')) {
      const list = G.teams[side].lineup[slot];
      list.push(p);
      closeSheet();
      act({ t: 'sub', s: side, slot, i: list.length - 1, ty });
      if (done) done();
    }
  });
  body.querySelector('[data-f=name]').focus();
}

function pitcherSheet(side) {
  const i = S.pit[side], p = G.teams[side].pitchers[i], st = pitchStat(S, side, i);
  const body = openSheet(`<h2 id="sheetTitle">Pitching <small>for ${esc(teamName(G, side))}</small></h2>
    ${nameFields(p)}
    <p class="quiet">${esc(pitchDay(st, G.pitches))}</p>
    <div class="list">
      <button type="button" class="li" data-y="new"><b>New pitcher</b><span>Bring in a reliever. Their pitch count starts at zero.</span></button>
      ${G.teams[side].pitchers.length > 1 ? '<button type="button" class="li" data-y="back"><b>Bring back an earlier pitcher</b><span>Someone who already pitched today.</span></button>' : ''}
    </div>
    <div class="row"><button type="button" class="btn primary" data-close>Done</button></div>`);
  bindName(body, () => G.teams[side].pitchers[i]);
  body.addEventListener('click', e => {
    const y = e.target.closest('[data-y]');
    if (!y) return;
    if (y.dataset.y === 'new') newPitcher(side);
    if (y.dataset.y === 'back') {
      // How much each has thrown: pitches when they're counted (without, the count is one a batter, and means nothing).
      const so = st => (G.pitches ? `${pitchCount(st.np)} so far` : pitchWork(st));
      const b2 = openSheet(`<h2 id="sheetTitle">Who’s pitching?</h2><div class="list">${G.teams[side].pitchers.map((_, j) => j === S.pit[side] ? '' : `<button type="button" class="li" data-j="${j}"><b>${esc(pitcherLabel(G, side, j))}</b><span>${esc(so(pitchStat(S, side, j)))}</span></button>`).join('')}</div>
        <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button></div>`);
      b2.addEventListener('click', e2 => { const j = e2.target.closest('[data-j]'); if (j) { closeSheet(); act({ t: 'pch', s: side, i: +j.dataset.j }); } });
    }
  });
}
// The same person, by name, or by number when there's no name to go by.
const samePerson = (a, b) => (a.name && b.name ? a.name.toLowerCase() === b.name.toLowerCase() : !!a.num && a.num === b.num);
// Chips that fill a player's number and name from a list: [[key, player]], with the one now filled in pressed.
const pickChips = (words, list, now) => (list.length ? `<p class="pick-row" role="group" aria-label="${esc(words)}"><span>${esc(words)}:</span>${list.map(([k, x]) => `<button type="button" class="chip" data-pick="${k}" aria-pressed="${samePerson(x, now)}">${esc(label(x, 0) + (x.name && x.num ? ' #' + x.num : ''))}</button>`).join('')}</p>` : '');

function newPitcher(side) {
  const p = blank(), t = G.teams[side];
  // In youth ball, high school and any game without a DH, a reliever is usually someone already in the order.
  const order = [], now = [];
  for (let slot = 0; slot < S.size[side]; slot++) {
    const x = t.lineup[slot][S.pl[side][slot] ?? 0];
    now.push(x);
    if (x && (x.name || x.num) && !t.pitchers.some(y => samePerson(x, y))) order.push([slot, x]);
  }
  // And when the pitcher going out bats (no DH), the new one can take his spot in the order too: the pitching change
  // and the substitution in one go (Undo takes them back one at a time). Not for someone already in the order.
  const out = t.pitchers[S.pit[side]] || blank(), spot = out.name || out.num ? now.findIndex(x => x && samePerson(x, out)) : -1;
  const inOrder = () => now.some(x => x && samePerson(x, p));
  const body = openSheet(`<h2 id="sheetTitle">New pitcher <small>for ${esc(teamName(G, side))}</small></h2>
    ${pickChips('From the order', order, p)}
    ${nameFields(p)}
    ${spot < 0 ? '' : `<label class="switch double"><input type="checkbox" data-also><span>Also bats ${ord(spot + 1)} in place of ${esc(label(now[spot], spot))}<small>For a game without a DH: the batting order changes with the pitcher.</small></span></label>`}
    <div class="row"><button type="button" class="btn quiet" data-close>Cancel</button><button type="button" class="btn primary" data-x="go">Bring them in</button></div>`);
  const also = $('.double', body), shown = () => { if (also) also.hidden = inOrder(); };
  $$('[data-f]', body).forEach(i => i.addEventListener('input', () => { p[i.dataset.f] = i.value.trim(); shown(); }));
  body.addEventListener('click', e => {
    const k = e.target.closest('[data-pick]');
    if (k) {
      const x = order.find(([slot]) => slot === +k.dataset.pick)[1];
      for (const f of ['num', 'name']) { p[f] = x[f]; $(`[data-f=${f}]`, body).value = x[f]; }
      $$('[data-pick]', body).forEach(c => c.setAttribute('aria-pressed', String(c === k)));
      shown();
      return;
    }
    if (!e.target.closest('[data-x=go]')) return;
    const both = also && !also.hidden && $('[data-also]', body).checked;
    G.teams[side].pitchers.push(p);
    closeSheet();
    const i = G.teams[side].pitchers.length - 1;
    act({ t: 'pch', s: side, i });
    if (!both) return;
    const list = G.teams[side].lineup[spot], was = label(now[spot], spot);
    list.push({ ...p });
    act({ t: 'sub', s: side, slot: spot, i: list.length - 1, ty: 'def' });
    toast(`Two changes: ${pitcherLabel(G, side, i)} pitches, and bats ${ord(spot + 1)} in place of ${was}.`, { ms: 6000 });
  });
  body.querySelector('[data-f=name]').focus();
}

// Both teams' orders: rename anyone, sub anyone, add a batter. focus: a batting slot whose name gets the keyboard (a
// batter just added), brought into sight. Otherwise Lineups opened again (the other team, a substitution made from it)
// stays scrolled where it was (top: how far), rather than jumping back to the top.
function lineupSheet(side = S.half, { focus, top } = {}) {
  const t = G.teams[side], was = sheetOpen() && $('#sheet .sheet-body');
  if (top == null) top = was && was.querySelector('[data-ls]') ? was.scrollTop : 0;
  const body = openSheet(`<h2 id="sheetTitle">Lineups</h2>
    <div class="seg" role="group" aria-label="Team">${[0, 1].map(s => `<button type="button" data-ls="${s}" aria-pressed="${s === side}">${esc(teamName(G, s))}</button>`).join('')}</div>
    <label class="team-name"><span>Team name</span><input data-team maxlength="40" value="${esc(t.name)}" placeholder="${side ? 'Home' : 'Visitors'}" autocapitalize="words" autocorrect="off" spellcheck="false"></label>
    <ol class="lineup-edit">${Array.from({ length: S.size[side] }, (_, slot) => {
      const list = t.lineup[slot], cur = S.pl[side][slot] ?? 0, p = list[cur];
      const before = earlier(side, slot).map(([, x]) => label(x, slot));
      return `<li data-slot="${slot}"><span class="ord">${slot + 1}</span>${nameFields(p, `data-slot="${slot}" `, `Batter ${slot + 1}`)}<button type="button" class="btn quiet sm" data-sub="${slot}" aria-label="${esc(`Sub for ${label(p, slot)}`)}">Sub</button>${before.length ? `<small class="earlier">Earlier: ${esc(before.join(', '))}</small>` : ''}</li>`;
    }).join('')}</ol>
    <div class="row"><button type="button" class="btn quiet" data-y="add">Add a batter to the order</button></div>
    <h3>Pitchers</h3>
    <ol class="lineup-edit">${t.pitchers.map((p, i) => `<li><span class="ord">${i === S.pit[side] ? '●' : i + 1}</span>${nameFields(p, `data-pi="${i}" `, `Pitcher ${i + 1}`)}</li>`).join('')}</ol>
    <div class="row"><button type="button" class="btn quiet" data-y="pitcher">New pitcher</button><button type="button" class="btn primary" data-close>Done</button></div>`);
  const names = $$('[data-slot][data-f=name]', body);
  names.forEach((i, k) => { i.enterKeyHint = k < names.length - 1 ? 'next' : 'done'; });
  body.addEventListener('keydown', e => nextName(e, '[data-slot][data-f=name]'));
  // (The team is found again with each key typed, as in bindName().)
  $$('li[data-slot]', body).forEach(li => bindName(li, () => { const slot = +li.dataset.slot; return G.teams[side].lineup[slot]?.[S.pl[side][slot] ?? 0]; }));
  $$('[data-pi][data-f=name]', body).forEach(i => bindName(i.closest('li'), () => G.teams[side].pitchers[+i.dataset.pi]));
  body.querySelector('[data-team]').addEventListener('input', e => { if (!G) return; G.teams[side].name = e.target.value.trim(); saveSoon(); draw(); });
  body.addEventListener('click', e => {
    const ls = e.target.closest('[data-ls]'), sub = e.target.closest('[data-sub]'), y = e.target.closest('[data-y]');
    if (ls) lineupSheet(+ls.dataset.ls);
    if (sub) { const at = body.scrollTop; subForm(side, +sub.dataset.sub, side === S.half && S.up[side] === +sub.dataset.sub ? 'ph' : 'def', () => lineupSheet(side, { top: at })); }
    if (y && y.dataset.y === 'add') { G.teams[side].lineup.push([blank()]); G.ev.push({ t: 'add', s: side }); moved(); save(); lineupSheet(side, { focus: S.size[side] - 1 }); }
    if (y && y.dataset.y === 'pitcher') newPitcher(side);
  });
  const name = focus != null && body.querySelector(`[data-slot="${focus}"][data-f=name]`);
  if (name) { name.focus(); reveal(name.closest('li')); } else body.scrollTop = top;
}

// ---------- the menu ----------
function menuSheet() {
  const body = openSheet(`<h2 id="sheetTitle">This game</h2>
    <div class="list">
      <button type="button" class="li" data-y="lineup"><b>Lineups and substitutions</b><span>Names, numbers, pinch hitters, new pitchers.</span></button>
      <button type="button" class="li" data-y="share"><b>Share this game</b><span>A link to the scorecard, the score as text, or a printout.</span></button>
      <button type="button" class="li" data-y="settings"><b>Game settings</b><span>Teams, innings, league rules, counting pitches, date and place.</span></button>
      <button type="button" class="li" data-y="help"><b>How to read the card</b><span>What 6-3, F8 and the backwards K mean.</span></button>
      ${S.over ? '<button type="button" class="li" data-y="on"><b>Keep playing</b><span>Carry on scoring past the end.</span></button>'
        : S.delayed ? '<button type="button" class="li" data-y="on"><b>Resume play</b><span>Pick the game up where it stopped.</span></button><button type="button" class="li" data-y="end"><b>End the game here</b><span>A run rule, the time limit, or called for rain or darkness.</span></button>'
          : '<button type="button" class="li" data-y="eoh"><b>End this half-inning</b><span>For a run limit or the clock.</span></button><button type="button" class="li" data-y="end"><b>End the game here</b><span>Or stop for a delay. Rain, a run rule, or out of time.</span></button>'}
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
      case 'end': return endSheet();
      case 'on': case 'eoh': closeSheet(); return act({ t: y.dataset.y });
      case 'delete': {
        if (y.dataset.armed) {
          const g = G;
          closeSheet();
          store.remove(g.id); drive.changed();
          go('#/');
          toast('Game deleted.', { action: 'Undo', focus: true, run: () => { store.save(g); drive.changed(); go('#/g/' + g.id); } });
        } else { y.dataset.armed = '1'; y.querySelector('b').textContent = 'Tap again to delete it'; }
      }
    }
  });
}

function settingsSheet() {
  // In the bottom of an inning with the home team ahead after the top of it, that inning can't be made the last: the
  // game would have been over before this half, and the plays in it would go on as if after a Final.
  const led = S.half === 1 && !S.over && S.R[1] - (S.line[1][S.inn - 1] || 0) > S.R[0];
  const notes = [
    S.inn > 3 ? `Already in the ${ord(S.inn)}, so it can’t be shorter than that.` : '',
    led ? `${G.teams[1].name ? `The ${G.teams[1].name} were` : 'The home team was'} already ahead after the top of the ${ord(S.inn)}: use End the game here.` : '',
  ].filter(Boolean).join(' ');
  // (A game from a file or a newer version can have more innings than the list, up to 30: its own number is in it.)
  const body = openSheet(`<h2 id="sheetTitle">Game settings</h2>
    <div class="form">
      <label><span>Visitors</span><input data-t="0" maxlength="40" value="${esc(G.teams[0].name)}" placeholder="Visitors" autocapitalize="words" autocorrect="off" spellcheck="false"></label>
      <label><span>Home team</span><input data-t="1" maxlength="40" value="${esc(G.teams[1].name)}" placeholder="Home" autocapitalize="words" autocorrect="off" spellcheck="false"></label>
      <label><span>Innings</span><select data-g="innings">${[...new Set([3, 4, 5, 6, 7, 8, 9, 10, 12, G.innings])].sort((a, b) => a - b).map(n => `<option${n === G.innings ? ' selected' : n < S.inn || (n === S.inn && led) ? ' disabled' : ''}>${n}</option>`).join('')}</select>${notes ? `<small>${esc(notes)}</small>` : ''}</label>
      <div class="rules-row"></div>
      <label><span>Date</span><input type="date" data-g="date" value="${esc(G.date)}"></label>
      <label><span>Where</span><input data-g="place" maxlength="80" value="${esc(G.place)}" placeholder="Optional" autocapitalize="words" autocorrect="off" spellcheck="false"></label>
      <label class="switch"><input type="checkbox" data-g="pitches"${G.pitches ? ' checked' : ''}><span>Count balls and strikes<small>Keeps the count and each pitcher’s pitch count.</small></span></label>
    </div>
    <div class="row"><button type="button" class="btn primary" data-close>Done</button></div>`);
  $$('[data-t]', body).forEach(i => i.addEventListener('input', () => { G.teams[+i.dataset.t].name = i.value.trim(); saveSoon(); draw(); }));
  // The league's rules change how the game is played back, so each change is saved and the game drawn again.
  rulesRow($('.rules-row', body), () => G && G.rules, r => { if (!G) return; G.rules = r; save(); });
  $$('[data-g]', body).forEach(i => i.addEventListener(i.type === 'checkbox' || i.tagName === 'SELECT' ? 'change' : 'input', () => {
    const k = i.dataset.g;
    if (k === 'date' && !i.value) return; // (see below)
    G[k] = k === 'pitches' ? i.checked : k === 'innings' ? +i.value : i.value.trim();
    if (k === 'innings' || k === 'pitches') save(); else { saveSoon(); draw(); }
  }));
  // A game always has a date (one saved blank would read back as whatever day it was next opened), so clearing the
  // field changes nothing, and the date comes back.
  const date = $('[data-g=date]', body);
  const back = () => {
    if (date.value) return;
    date.value = G.date;
    if (!$('small', date.parentNode)) date.insertAdjacentHTML('afterend', '<small>A game always has a date.</small>');
  };
  date.addEventListener('change', back);
  date.addEventListener('blur', back);
}

// ---------- one box on the card ----------
const SAME = [['K', 'KL', 'GO', 'FO', 'LO', 'PU', 'SF', 'SAC'], ['1B', 'BB', 'IBB', 'HBP', 'E', 'FC', 'KD', 'CI']];
// What a box's play couldn't have been, from how things stood before it, with why: a fielder's choice or a sacrifice
// needs a runner on (and a sacrifice, fewer than two out), a sacrifice fly a run in from third with fewer than two
// out, and a dropped third strike two strikes (when pitches are counted) and first base open or two out (OBR
// 5.09(a)(3)).
function cantBe(c, e) {
  const st = replay(G, c.ev), why = {};
  const nobody = !runnersOn(st).length, two = st.outs >= 2 && 'There were already two out.';
  why.FC = nobody && 'Nobody was on base.';
  why.SAC = (nobody && 'Nobody was on base.') || two;
  why.SF = (!(e.m || []).some(x => x[0] === 3 && x[1] === 4) && 'Nobody scored from third on it.') || two;
  why.KD = (G.pitches && st.s !== 2 && 'There weren’t two strikes yet.') || (st.bases[1] && st.outs < 2 && 'First base was taken with fewer than two out.');
  // A batter who was safe wasn't out: only a sacrifice (with everyone safe on an error) leaves him on base.
  if ((e.m || []).some(x => x[0] === 0 && x[1] !== 0)) for (const k of ['K', 'KL', 'GO', 'FO', 'LO', 'PU', 'SF']) why[k] ||= 'The batter was safe on it.';
  return why;
}
function cellSheet(c) {
  if (!c) return;
  const e = G.ev[c.ev], R = RESULTS[c.r];
  const name = label(player(G, c.side, c.slot, c.p), c.slot);
  const seq = pitchWords(c.seq);
  // A strikeout that came from counting pitches can still be switched between swinging and looking.
  const fromPitch = e && e.t === 'p' && (c.r === 'K' || c.r === 'KL');
  // (By what was tapped: a double that won the game and counts as a single is still a double, and can't be a walk.)
  const group = readOnly || !e ? null : e.t === 'pa' ? SAME.find(gr => gr.includes(e.r)) : fromPitch ? ['K', 'KL'] : null;
  const why = group && e.t === 'pa' ? cantBe(c, e) : {};
  const body = openSheet(`<h2 id="sheetTitle">${esc(name)} <small>${c.side ? 'Bottom' : 'Top'} of the ${ord(c.inn)}</small></h2>
    <div class="cell-big"><div class="cell-pic">${cellSvg(c, { count: G.pitches })}</div>
      <div><p><b>${markHtml(c.r, c.mark)}</b> ${esc(R.label)}</p><p>${esc(c.text)}</p>${c.story.length ? `<p>${esc(c.story.join(' '))}</p>` : ''}
      ${seq ? `<p class="quiet">Pitches: ${esc(seq)}.</p>` : ''}</div></div>
    ${group ? `<h3>Change what it was</h3><div class="chips wide" role="group" aria-label="What it was">${group.map(k => `<button type="button" data-sw="${k}" aria-pressed="${k === c.r}"${why[k] && k !== c.r ? ` disabled title="${esc(why[k])}"` : ''}>${esc(RESULTS[k].label)}</button>`).join('')}</div>` : ''}
    ${group && e.t === 'pa' && (R.f || c.f) ? `<div class="row"><button type="button" class="btn quiet" data-y="f">Change the fielders${c.f ? ` (${esc(c.f.join('-'))})` : ''}</button></div>` : ''}
    ${!readOnly && e && !group ? '<p class="hint">This one can’t be changed here. Undo takes plays back, latest first, and until the next batter’s turn is over, Fix runners changes where everyone ended up on the play before.</p>' : ''}
    <div class="row"><button type="button" class="btn primary" data-close>Done</button></div>`);
  // Undo takes back plays, not a change made here, so each change has its own Undo, in a message right after it.
  const old = { r: e && e.r, f: e && e.f, k: e && e.k, tap: tapped.e === e ? tapped.r : null };
  const changed = () => {
    const cell = S.cells[c.n];
    cellSheet(cell);
    if (!cell || (e.r === old.r && e.k === old.k && String(e.f) === String(old.f))) return;
    const what = RESULTS[cell.r].label.toLowerCase();
    toast(`Changed to ${cell.f ? `${what} (${cell.mark})` : what}.`, {
      action: 'Undo',
      run: () => {
        if (!G || G.ev[c.ev] !== e) return; // the game changed somewhere else meanwhile
        if (e.t === 'p') e.k = old.k;
        else { e.r = old.r; if (old.f) e.f = old.f; else delete e.f; }
        if (tapped.e === e && old.tap != null) tapped.r = old.tap;
        save();
        cellSheet(S.cells[c.n]);
      },
    });
  };
  body.addEventListener('click', ev => {
    const sw = ev.target.closest('[data-sw]'), y = ev.target.closest('[data-y]');
    if (sw && !sw.disabled) {
      const was = e.r;
      if (e.t === 'p') e.k = sw.dataset.sw === 'KL' ? 'c' : 's';
      else { e.r = sw.dataset.sw; if (!RESULTS[e.r].f) delete e.f; }
      // Fix runners starts from what the box says now.
      if (tapped.e === e) tapped.r = e.r;
      save();
      // Now an error or a ground out, say, with nobody named: who fielded it? (Skip leaves it blank.)
      if (e.t === 'pa' && e.r !== was && RESULTS[e.r].f && !e.f) return pickFielders(e.r, null, f => { if (f && f.length) { e.f = f; save(); } changed(); });
      changed();
    }
    if (y) pickFielders(e.r, e.f, f => { if (f && f.length) e.f = f; else delete e.f; save(); changed(); });
  });
}
