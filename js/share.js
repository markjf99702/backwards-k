// Sharing a game: a link that carries the whole scorecard, the score as text for a group chat, a printout, a file.
// The link holds the game itself (packed small after the #), so nothing is uploaded anywhere to share it.
import { replay, teamName, halfLabel, endNote, label, player, milestones } from './engine.js';
import { cardHtml, lineHtml } from './card.js';
import { boxHtml } from './box.js';
import { esc, openSheet, closeSheet, toast, copy, download, inFrame, SITE, slug, fmtDate } from './ui.js';

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

// A checksum of some bytes (CRC-32): any one letter of a link changed on its way changes it.
const CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
export const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// The game in a link: a letter for how it's packed, then base64url. 'c': the checksum of the game's text, in four
// bytes, then the text compressed; 'p' the same with the text as it is, where the browser can't compress. A link that
// a chat app or a text cut short or changed doesn't match its checksum, and doesn't open as some other game. Links
// made before there was a checksum still open: 'z' (compressed) and 'j' (as it is).
export async function pack(g) {
  const json = new TextEncoder().encode(JSON.stringify(g)), z = typeof CompressionStream === 'function';
  const body = z ? await pipe(json, new CompressionStream('deflate-raw')) : json, out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, crc32(json));
  out.set(body, 4);
  return (z ? 'c' : 'p') + b64(out);
}
export async function unpack(s) {
  const k = s[0], bytes = unb64(s.slice(1)), text = json => JSON.parse(new TextDecoder().decode(json));
  if (k === 'z' || k === 'j') return text(k === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes);
  if ((k !== 'c' && k !== 'p') || bytes.length < 5) throw new Error('not a link to a game');
  const sum = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0), body = bytes.subarray(4);
  const json = k === 'c' ? await pipe(body, new DecompressionStream('deflate-raw')) : body;
  if (crc32(json) !== sum) throw new Error('the link changed on its way');
  return text(json);
}
// The link always points at the real site, even from the one-file copy.
const base = () => (location.origin + '/' === SITE ? location.origin + location.pathname : SITE);
export const linkFor = async g => base() + '#s=' + await pack(g);

// The score as text: "Tigers 11, Bears 1 (Final, run rule)", the day and place, each team's runs, hits and errors, the
// home runs, and once it's over, what the game will be remembered for (a no-hitter, the cycle).
export function summary(g, link) {
  const S = replay(g), w = S.R[1] > S.R[0] ? 1 : 0, why = endNote(S);
  const hrs = [];
  for (const [k, b] of Object.entries(S.bat)) if (b.hr) { const [s, slot, p] = k.split('.').map(Number); hrs.push(label(player(g, s, slot, p), slot) + (b.hr > 1 ? ' ' + b.hr : '')); }
  const line = s => `${teamName(g, s)}: ${S.R[s]} run${S.R[s] === 1 ? '' : 's'}, ${S.H[s]} hit${S.H[s] === 1 ? '' : 's'}, ${S.E[s]} error${S.E[s] === 1 ? '' : 's'}`;
  return [
    `${teamName(g, w)} ${S.R[w]}, ${teamName(g, 1 - w)} ${S.R[1 - w]} (${halfLabel(S)}${why ? ', ' + why : ''})`,
    [fmtDate(g.date), g.place].filter(Boolean).join(' · '),
    '',
    line(0), line(1),
    hrs.length ? `Home runs: ${hrs.join(', ')}` : '',
    ...milestones(S).map(m => m.text),
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

// Fills the print-only part of the page with both cards and the box score, then prints. Each card is a page of its
// own, with its heading, and its rows as tall as the page allows (--rows: the order, and half a row more for each name
// past two in one slot); the box score starts another.
export function printGame(g) {
  const S = replay(g);
  const rows = s => {
    const subs = Array(S.size[s]).fill(0);
    for (const e of g.ev) if (e.t === 'sub' && e.s === s && e.slot < subs.length) subs[e.slot]++;
    return subs.reduce((n, k) => n + Math.max(0, k - 1) / 2, S.size[s]);
  };
  let el = document.getElementById('print');
  if (!el) { el = document.createElement('div'); el.id = 'print'; document.body.append(el); }
  el.innerHTML = `<h1>${esc(teamName(g, 0))} at ${esc(teamName(g, 1))}</h1>
    <p>${esc([fmtDate(g.date, true), g.place].filter(Boolean).join(' · '))}</p>
    ${lineHtml(S)}
    ${[0, 1].map(s => `<section class="pcard" style="--rows:${rows(s)}"><h2>${esc(teamName(g, s))}</h2>${cardHtml(S, s, { live: false })}</section>`).join('')}
    <section class="pbox"><h2>Box score</h2>${boxHtml(S)}</section>`;
  setTimeout(() => window.print(), 50);
}
