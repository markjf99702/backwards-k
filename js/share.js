// Sharing a game: a link that carries the whole scorecard, the score as text for a group chat, a printout, a file.
// The link holds the game itself (packed small after the #), so nothing is uploaded anywhere to share it.
import { replay, teamName, halfLabel, label, player } from './engine.js';
import { cardHtml, lineHtml } from './card.js';
import { boxHtml } from './box.js';
import { esc, openSheet, closeSheet, toast, copy, download, inFrame, SITE, slug, fmtDate } from './ui.js';

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export async function pack(g) {
  const json = new TextEncoder().encode(JSON.stringify(g));
  if (typeof CompressionStream === 'function') return 'z' + b64(await pipe(json, new CompressionStream('deflate-raw')));
  return 'j' + b64(json);
}
export async function unpack(s) {
  const bytes = unb64(s.slice(1));
  const json = s[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(new TextDecoder().decode(json));
}
// The link always points at the real site, even from the one-file copy.
const base = () => (location.origin + '/' === SITE ? location.origin + location.pathname : SITE);
export const linkFor = async g => base() + '#s=' + await pack(g);

export function summary(g, link) {
  const S = replay(g), w = S.R[1] > S.R[0] ? 1 : 0;
  const hrs = [];
  for (const [k, b] of Object.entries(S.bat)) if (b.hr) { const [s, slot, p] = k.split('.').map(Number); hrs.push(label(player(g, s, slot, p), slot) + (b.hr > 1 ? ' ' + b.hr : '')); }
  const line = s => `${teamName(g, s)}: ${S.R[s]} run${S.R[s] === 1 ? '' : 's'}, ${S.H[s]} hit${S.H[s] === 1 ? '' : 's'}, ${S.E[s]} error${S.E[s] === 1 ? '' : 's'}`;
  return [
    `${teamName(g, w)} ${S.R[w]}, ${teamName(g, 1 - w)} ${S.R[1 - w]} (${halfLabel(S)})`,
    [fmtDate(g.date), g.place].filter(Boolean).join(' · '),
    '',
    line(0), line(1),
    hrs.length ? `Home runs: ${hrs.join(', ')}` : '',
    link ? `\nThe whole scorecard: ${link}` : '',
  ].filter((x, i) => x !== '' || i === 2).join('\n');
}

export function shareSheet(g) {
  const framed = inFrame();
  const body = openSheet(`<h2 id="sheetTitle">Share this game</h2>
    <div class="list">
      <button type="button" class="li" data-y="link"><b>Send a link to the scorecard</b><span>Whoever opens it sees the whole card and box score, and can save a copy. The game travels in the link itself.</span></button>
      <button type="button" class="li" data-y="text"><b>Copy the score as text</b><span>For a group chat: the score, hits, errors and home runs.</span></button>
      ${framed ? '' : `<button type="button" class="li" data-y="print"><b>Print it, or save it as a PDF</b><span>Both teams’ cards and the box score, on paper.</span></button>
      <button type="button" class="li" data-y="file"><b>Save it as a file</b><span>To keep, or to open in Backwards K on another device.</span></button>`}
    </div>
    <div class="out" hidden><textarea readonly rows="5"></textarea><p class="hint">Copy this and paste it wherever you like.</p></div>
    <div class="row"><button type="button" class="btn quiet" data-close>Close</button></div>`);
  const show = text => { const o = body.querySelector('.out'); o.hidden = false; const t = o.querySelector('textarea'); t.value = text; t.select(); };
  body.addEventListener('click', async e => {
    const y = e.target.closest('[data-y]');
    if (!y) return;
    const what = y.dataset.y;
    if (what === 'link') {
      const url = await linkFor(g), title = `${teamName(g, 0)} at ${teamName(g, 1)}`;
      if (navigator.share && !framed) {
        try { await navigator.share({ title, text: `${title}, ${fmtDate(g.date)}`, url }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
      }
      if (await copy(url)) toast('Link copied. Paste it into a message.'); else show(url);
    }
    if (what === 'text') {
      const text = summary(g, await linkFor(g));
      if (await copy(text)) toast('Score copied.'); else show(text);
    }
    if (what === 'print') { closeSheet(); printGame(g); }
    if (what === 'file') saveFile(g);
  });
}

// The game as a file, to keep or to open in Backwards K on another device (it reads like a backup with one game).
export function saveFile(g) {
  download(`${g.date} ${slug(teamName(g, 0))}-at-${slug(teamName(g, 1))}.backwards-k.json`, JSON.stringify({ app: 'backwards-k', v: 1, games: { [g.id]: g } }, null, 1));
}

// Fills the print-only part of the page with both cards and the box score, then prints.
export function printGame(g) {
  const S = replay(g);
  let el = document.getElementById('print');
  if (!el) { el = document.createElement('div'); el.id = 'print'; document.body.append(el); }
  el.innerHTML = `<h1>${esc(teamName(g, 0))} at ${esc(teamName(g, 1))}</h1>
    <p>${esc([fmtDate(g.date, true), g.place].filter(Boolean).join(' · '))}</p>
    ${lineHtml(S)}
    ${[0, 1].map(s => `<h2>${esc(teamName(g, s))}</h2>${cardHtml(S, s, { live: false })}`).join('')}
    <h2>Box score</h2>${boxHtml(S)}`;
  setTimeout(() => window.print(), 50);
}
