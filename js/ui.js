// Small helpers shared by every screen: escaping, the bottom sheet, the toast, files.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The one-file copy (built by scripts/build.mjs), and whether it's shown inside another page.
export const isSingle = () => 'single' in document.documentElement.dataset;
export const inFrame = () => { try { return window.top !== window.self; } catch { return true; } };
export const SITE = 'https://backwards-k.junkdrawer.works/';

// Moving between screens changes the part of the address after the #. Where the page is shown inside another page,
// that change might not be announced, so if it isn't, the screen is switched directly.
let router = null, shown = null;
export const routes = { use(fn) { router = fn; }, shown(h) { shown = h; } };
export function go(h, { replace = false } = {}) {
  try { if (replace) location.replace(h); else location.hash = h; } catch { /* the address can't change here */ }
  setTimeout(() => { if (router && shown !== h) router(h); }, 60);
}

// The app icon, drawn in place so the one-file copy needs no other files.
export const ICON = '<svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1c2a44"/><rect x="11" y="11" width="42" height="42" rx="3" fill="#fbf8f0"/><path d="M32 17 L47 32 L32 47 L17 32 Z" fill="none" stroke="#9cb3c9" stroke-width="1.6"/><g fill="none" stroke="#c0392b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M41 19 V45"/><path d="M40 33 L25 19"/><path d="M34 28 L25 45"/></g></svg>';

// A strikeout looking, drawn as a backwards K wherever it appears in text.
export const KL = '<i class="kl" aria-label="backwards K">K</i>';
export const markHtml = (code, m) => (code === 'KL' ? KL : esc(m));

export function fmtDate(d, long) {
  const [y, m, day] = String(d).split('-').map(Number);
  if (!y) return '';
  return new Date(y, m - 1, day).toLocaleDateString(undefined, long ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- the sheet: a panel that slides up on a phone, or a box in the middle on a big screen ----------
const dlg = () => document.getElementById('sheet');
let onClose = null;

export function openSheet(html, { wide = false, close } = {}) {
  const d = dlg();
  const prev = onClose;
  onClose = null;
  if (prev) prev();
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
  // (The close event comes a moment later; if another sheet opened meanwhile, it's that one's now.)
  d.addEventListener('close', () => { if (d.open) return; const f = onClose; onClose = null; if (f) f(); d.querySelector('.sheet-body').innerHTML = ''; });
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
let toastT = null, toastHide = null;
const toastEl = () => document.getElementById('toast');
export function toast(msg, { action, run, ms = 3200, focus = false } = {}) {
  const t = toastEl();
  clearTimeout(toastT);
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  let back = null;
  toastHide = () => {
    clearTimeout(toastT);
    toastHide = null;
    const had = t.contains(document.activeElement);
    t.textContent = '';
    const to = had && (back && back.isConnected ? back : document.querySelector('#app h1'));
    if (to) { if (to.tagName === 'H1') to.tabIndex = -1; to.focus({ preventScroll: true }); }
  };
  hideIn(action ? Math.max(ms, 6000) : ms);
  if (action) {
    const b = t.querySelector('button');
    b.addEventListener('click', () => { toastHide(); run(); });
    if (focus) { back = document.activeElement; b.focus({ preventScroll: true }); }
  }
}
const hideIn = ms => { clearTimeout(toastT); toastT = setTimeout(() => toastHide && toastHide(), ms); };
// While the toast has the keyboard or the pointer it stays, and it goes 4 seconds after both have left. Escape
// closes it.
function wireToast() {
  const t = document.getElementById('toast');
  if (!t) return;
  const stay = () => clearTimeout(toastT);
  t.addEventListener('focusin', stay);
  t.addEventListener('mouseenter', stay);
  t.addEventListener('focusout', e => { if (toastHide && !t.contains(e.relatedTarget) && !t.matches(':hover')) hideIn(4000); });
  t.addEventListener('mouseleave', () => { if (toastHide && !t.contains(document.activeElement)) hideIn(4000); });
  t.addEventListener('keydown', e => { if (e.key === 'Escape' && toastHide) { e.preventDefault(); toastHide(); } });
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
