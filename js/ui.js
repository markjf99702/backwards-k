// Small helpers shared by every screen: escaping, the bottom sheet, the toast, files.

import { POSITIONS } from './model.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Whether the page is shown inside another page (as the one-file copy, built by scripts/build.mjs, can be).
export const inFrame = () => { try { return window.top !== window.self; } catch { return true; } };
export const SITE = 'https://backwards-k.junkdrawer.works/';

// Moving between screens changes the part of the address after the #. Where the page is shown inside another page,
// that change might not be announced, so if it isn't, the screen is switched directly. Once any screen has been shown
// since, that's no longer needed: switching then would undo a move made in the meantime (the address says New game,
// and the game is back).
let router = null, shown = null, later = 0;
export const routes = { use(fn) { router = fn; }, shown(h) { shown = h; clearTimeout(later); } };
export function go(h, { replace = false } = {}) {
  try { if (replace) location.replace(h); else location.hash = h; } catch { /* the address can't change here */ }
  clearTimeout(later);
  later = setTimeout(() => { if (router && shown !== h) router(h); }, 60);
}

// The app icon, drawn in place so the one-file copy needs no other files.
export const ICON = '<svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1c2a44"/><rect x="11" y="11" width="42" height="42" rx="3" fill="#fbf8f0"/><path d="M32 17 L47 32 L32 47 L17 32 Z" fill="none" stroke="#9cb3c9" stroke-width="1.6"/><g fill="none" stroke="#c0392b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M41 19 V45"/><path d="M40 33 L25 19"/><path d="M34 28 L25 45"/></g></svg>';

// A strikeout looking, drawn as a backwards K wherever it appears in text.
export const KL = '<i class="kl" aria-label="backwards K">K</i>';
export const markHtml = (code, m) => (code === 'KL' ? KL : esc(m));

// A game's date, "Sat, Oct 24" (with the year when it isn't this year's), or long, "Saturday, October 24, 2026".
export function fmtDate(d, long) {
  const [y, m, day] = String(d).split('-').map(Number);
  if (!y) return '';
  const year = long || y !== new Date().getFullYear() ? { year: 'numeric' } : {};
  return new Date(y, m - 1, day).toLocaleDateString(undefined, long ? { weekday: 'long', month: 'long', day: 'numeric', ...year } : { weekday: 'short', month: 'short', day: 'numeric', ...year });
}
// A moment in a game (at: seconds since its first pitch) on the clock where it was scored: "7:10 pm". '' without one.
export function clockAt(g, at) {
  if (!g.start || !Number.isFinite(at)) return '';
  const d = new Date(g.start + at * 1000 + (g.tz || 0) * 60000), h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
// How long, in hours and minutes, as a box score gives the time of a game: "2:31", "0:45".
export const hm = secs => { const m = Math.round(secs / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// ---------- the sheet: a panel that slides up on a phone, or a box in the middle on a big screen ----------
const dlg = () => document.getElementById('sheet');
let onClose = null;

export function openSheet(html, { wide = false, close } = {}) {
  const d = dlg();
  const prev = onClose;
  onClose = null;
  if (prev) prev();
  // A message in the sheet's own line was about the sheet this one replaces, so it goes (one about this sheet comes
  // after it opens).
  const said = d.open && d.querySelector('.sheet-toast');
  if (said && toastHide && toastAt === said) toastHide(); else if (said) said.textContent = '';
  // A new panel each time, so taps handled by the last sheet's listeners can't reach this one.
  const body = document.createElement('div');
  body.className = 'sheet-body';
  d.querySelector('.sheet-body').replaceWith(body);
  body.innerHTML = html;
  d.classList.toggle('wide', wide);
  onClose = close || null;
  if (!d.open) d.showModal();
  body.scrollTop = 0;
  const t = body.querySelector('[data-focus]') || body.querySelector('h2');
  if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
  return body;
}
export function closeSheet() {
  const d = dlg();
  if (d.open) d.close();
}
export const sheetOpen = () => dlg().open;

function wire() {
  const d = dlg();
  if (!d) return;
  // (The close event comes a moment later; if another sheet opened meanwhile, it's that one's now.) A message in the
  // sheet's own line goes with it.
  d.addEventListener('close', () => {
    if (d.open) return;
    const f = onClose; onClose = null; if (f) f();
    d.querySelector('.sheet-body').innerHTML = '';
    const t = d.querySelector('.sheet-toast');
    if (t && toastHide && toastAt === t) toastHide(); else if (t) t.textContent = '';
  });
  // A tap on the dimmed page behind it closes it.
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  d.addEventListener('click', e => { if (e.target.closest('[data-close]')) d.close(); });
  // Something drawn as a button that isn't a <button> (the fielders on the field) works from a keyboard too.
  d.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.altKey || e.ctrlKey || e.metaKey) return;
    const b = e.target.closest && e.target.closest('[role=button]');
    if (!b || b.tagName === 'BUTTON') return;
    e.preventDefault();
    if (!e.repeat) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

// Why this device couldn't save something (store.problem() is 'full' or 'blocked'), to finish a sentence.
export const whyNot = p => (p === 'full' ? 'this device is out of room' : 'this browser isn’t letting Backwards K save (private browsing, or site data is turned off)');

// ---------- the toast ----------
// It stays on the page, empty between messages (and so out of sight), so a screen reader hears each one. focus:
// give its button the keyboard (the only way back from deleting a game); when it goes, the keyboard goes back.
// An open sheet covers the whole page, and nothing outside it can be reached, so while one is open the message goes
// in the sheet's own line instead (in index.html, beside the sheet's body, so it's there before anything is written).
let toastT = null, toastHide = null, toastAt = null;
const toasts = () => [document.getElementById('toast'), dlg() && dlg().querySelector('.sheet-toast')].filter(Boolean);
const toastEl = () => (sheetOpen() && dlg().querySelector('.sheet-toast')) || document.getElementById('toast');
export function toast(msg, { action, run, ms = 3200, focus = false } = {}) {
  const t = toastEl();
  clearTimeout(toastT);
  for (const x of toasts()) if (x !== t) x.textContent = '';
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  toastAt = t;
  if (t.classList.contains('sheet-toast')) placeInSheet(t);
  let back = null;
  toastHide = () => {
    clearTimeout(toastT);
    toastHide = null;
    const had = t.contains(document.activeElement);
    t.textContent = '';
    const to = had && (back && back.isConnected ? back : t.classList.contains('sheet-toast') ? dlg().querySelector('.sheet-body h2') : document.querySelector('#app h1'));
    if (to) { if (/^H[12]$/.test(to.tagName)) to.tabIndex = -1; to.focus({ preventScroll: true }); }
  };
  hideIn(action ? Math.max(ms, 6000) : ms);
  if (action) {
    const b = t.querySelector('button');
    b.addEventListener('click', () => { toastHide(); run(); });
    if (focus) { back = document.activeElement; b.focus({ preventScroll: true }); }
  }
}
const hideIn = ms => { clearTimeout(toastT); toastT = setTimeout(() => toastHide && toastHide(), ms); };
// In a sheet, the message sits just above the rows of buttons that end it (Save play, Close, Done, and Change the
// fielders over Done), so the button the scorer wants next isn't under it: above the highest of them in sight (the
// last one always is, since it stays at the bottom edge). With none in sight, it sits at the sheet's bottom edge.
function placeInSheet(t) {
  t.style.bottom = '';
  const d = dlg(), box = d.getBoundingClientRect();
  let top = Infinity;
  for (let row = d.querySelector('.sheet-body').lastElementChild; row && row.matches('.row'); row = row.previousElementSibling) {
    const r = row.getBoundingClientRect();
    if (r.height && r.top >= box.top && r.top <= box.bottom) top = Math.min(top, r.top);
  }
  if (top < Infinity) t.style.bottom = `${Math.round(box.bottom - top + 8)}px`;
}
// Scrolls an open sheet just far enough for el to show above the row of buttons that ends it, which stays put at the
// bottom edge while the rest scrolls under it.
export function reveal(el) {
  const body = el.closest('.sheet-body');
  if (!body) return;
  const row = body.lastElementChild, b = body.getBoundingClientRect(), r = el.getBoundingClientRect();
  const floor = row && row !== el && row.matches('.row') ? row.getBoundingClientRect().top : b.bottom;
  if (r.bottom > floor - 8) body.scrollTop += Math.min(r.bottom - floor + 8, Math.max(0, r.top - b.top - 8));
}
// While the toast has the keyboard or the pointer it stays, and it goes 4 seconds after both have left. Escape
// closes it.
function wireToast() {
  for (const t of toasts()) {
    const stay = () => { if (toastAt === t) clearTimeout(toastT); };
    t.addEventListener('focusin', stay);
    t.addEventListener('mouseenter', stay);
    t.addEventListener('focusout', e => { if (toastHide && toastAt === t && !t.contains(e.relatedTarget) && !t.matches(':hover')) hideIn(4000); });
    t.addEventListener('mouseleave', () => { if (toastHide && toastAt === t && !t.contains(document.activeElement)) hideIn(4000); });
    t.addEventListener('keydown', e => { if (e.key === 'Escape' && toastHide && toastAt === t) { e.preventDefault(); toastHide(); } });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireToast); else wireToast();

// ---------- files ----------
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export function pickFile(accept = '.json,application/json') {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.addEventListener('change', () => resolve(i.files[0] || null));
    i.click();
  });
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';

// Enter in one of a list of name fields (sel) moves on to the next one in the same list, and the last one is done:
// the keyboard goes away. Typing names down a lineup then never stops at the jersey numbers.
export function nextName(e, sel) {
  if (e.key !== 'Enter' || e.isComposing || !e.target.matches(sel)) return;
  e.preventDefault();
  const list = [...e.target.closest('ol, ul').querySelectorAll(sel)], next = list[list.indexOf(e.target) + 1];
  if (next) next.focus(); else e.target.blur();
}

// Where a batter plays, picked from the positions (or none): a field beside his number and name. attrs: the select's
// own (data-f="pos" and the rest); who: whose it is, for a list of them ("Batter 3").
export function posField(pos, attrs = '', who = '') {
  return `<label class="ps"><span>Pos</span><select ${attrs}data-f="pos"${who ? ` aria-label="${esc(who)} position"` : ''}><option value="">–</option>${POSITIONS.map(x => `<option${x === pos ? ' selected' : ''}>${x}</option>`).join('')}</select></label>`;
}
