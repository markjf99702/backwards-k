// Sharing a game: a link that carries the whole scorecard, the score as text for a group chat, a printout, a file.
// The link holds the game itself (packed small after the #), so nothing is uploaded anywhere to share it.
import { replay, teamName, halfLabel, endNote, label, player, milestones, innings, missed, PLAY } from './engine.js';
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

// Where the game is, after the score: "Final", "Final, run rule", "Delayed, top 5th", and for a game going on, the outs
// too: "Top 7th, 1 out".
function status(S) {
  const why = endNote(S), live = !S.over && !S.delayed;
  return `${halfLabel(S)}${why ? ', ' + why : ''}${live ? `, ${S.outs ? `${S.outs} out${S.outs > 1 ? 's' : ''}` : 'no outs'}` : ''}`;
}
// Whether anything has happened in the game: a play, or runs it was picked up with.
const started = (g, S) => g.ev.some(e => PLAY.has(e.t)) || !!S.joined;
// The score in a line, the team ahead first: "Comets 8, Foxes 1 (Final)", "Comets 3, Foxes 1 (Top 7th, 1 out)". A game
// nobody has started yet: "Foxes at Comets".
export function scoreLine(g, S = replay(g)) {
  if (!started(g, S)) return `${teamName(g, 0)} at ${teamName(g, 1)}`;
  const w = S.R[1] > S.R[0] ? 1 : 0;
  return `${teamName(g, w)} ${S.R[w]}, ${teamName(g, 1 - w)} ${S.R[1 - w]} (${status(S)})`;
}
// What the phone's share sheet sends with the link (the game itself is after the #, so a link preview can't show the
// score): "Comets 8, Foxes 1 (Final) · Sat, Oct 24".
export const shareText = g => [scoreLine(g), fmtDate(g.date)].filter(Boolean).join(' · ');
// The line score as a newspaper prints it, the innings in threes: "Foxes  000 010 000 — 1 8 1", with the runs, hits and
// errors after the dash. An inning not played yet is left off, one played before the scorer picked the game up is a
// dash, ten runs or more are in brackets, and the home team's last turn, when it didn't need it, is an x.
export function lineText(S) {
  const g = S.g, names = [0, 1].map(s => teamName(g, s)), w = Math.max(...names.map(x => x.length));
  return [0, 1].map(side => {
    const runs = [];
    for (let i = 1; i <= innings(S); i++) {
      let v = missed(S, side, i) ? '–' : S.line[side][i - 1];
      if (v == null && side === 1 && S.over && S.between && S.half === 0 && i === S.inn && S.R[1] > S.R[0]) v = 'x';
      if (v == null) break;
      runs.push(v > 9 ? `(${v})` : String(v));
    }
    const threes = [];
    for (let i = 0; i < runs.length; i += 3) threes.push(runs.slice(i, i + 3).join(''));
    return [names[side].padEnd(w), ...threes, '—', S.R[side], S.H[side], S.E[side]].join(' ');
  });
}

// The score as text, for a group chat: the score and where the game is ("Tigers 11, Bears 1 (Final, run rule)"), the day
// and place, the line score, each team's runs, hits and errors in words, the home runs by team, and once it's over,
// what the game will be remembered for (a no-hitter, the cycle).
export function summary(g, link) {
  const S = replay(g), few = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const line = s => `${teamName(g, s)}: ${few(S.R[s], 'run')}, ${few(S.H[s], 'hit')}, ${few(S.E[s], 'error')}`;
  // Each team's home runs, in the order they were hit: "Velez (Foxes); Pruitt 2, Okafor (Comets)".
  const hr = s => {
    const m = new Map();
    for (const c of S.cells) if (c.side === s && c.r === 'HR') { const n = label(player(g, s, c.slot, c.p), c.slot); m.set(n, (m.get(n) || 0) + 1); }
    return m.size ? `${[...m].map(([n, k]) => n + (k > 1 ? ' ' + k : '')).join(', ')} (${teamName(g, s)})` : '';
  };
  const hrs = [hr(0), hr(1)].filter(Boolean).join('; ');
  return [
    [scoreLine(g, S), [fmtDate(g.date), g.place].filter(Boolean).join(' · ')],
    started(g, S) ? lineText(S) : [],
    [line(0), line(1), hrs ? `Home runs: ${hrs}` : '', ...milestones(S).map(m => m.text)],
    [link ? `The whole scorecard: ${link}` : ''],
  ].map(b => b.filter(Boolean)).filter(b => b.length).map(b => b.join('\n')).join('\n\n');
}

export function shareSheet(g) {
  const framed = inFrame();
  const body = openSheet(`<h2 id="sheetTitle">Share this game</h2>
    <div class="list">
      <button type="button" class="li" data-y="link"><b>Send a link to the scorecard</b><span>Whoever opens it sees the whole card and box score, and can save a copy. The game travels in the link itself.</span></button>
      <button type="button" class="li" data-y="text"><b>Copy the score as text</b><span>For a group chat: the score, the line score, hits, errors and home runs.</span></button>
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
        try { await navigator.share({ title, text: shareText(g), url }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
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
