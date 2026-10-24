// The scorecard: one row per spot in the batting order, one column per inning, and in each box a small diamond
// with the batter's trip around the bases drawn the way it's done on paper.
import { RESULTS, columns, innings, label, player, batKey, ord } from './engine.js';
import { esc } from './ui.js';

// The diamond in a 60 x 60 box: home, first, second, third.
const PT = [[30, 51], [49, 32], [30, 13], [11, 32], [30, 51]];
// Where the note for reaching each base goes: beside the base path that ends there, outside the diamond.
const NOTE = [null, [46, 50, 'start'], [58, 17, 'end'], [2, 17, 'start'], [2, 50, 'start']];
const pts = n => PT.slice(0, n + 1).map(p => p.join(',')).join(' ');
const mid = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// c is a box from engine.js (or a made-up one for the guide). count: show the final count in the corner.
export function cellSvg(c, { count = true } = {}) {
  const R = RESULTS[c.r] || {};
  let s = '<svg viewBox="0 0 60 60" class="cs" aria-hidden="true">';
  s += `<path class="dia" d="M${pts(3)}Z"/>`;
  if (c.scored) s += `<path class="run" d="M${pts(3)}Z"/>`;
  if (c.reach) s += `<polyline class="path" points="${pts(Math.min(c.reach, 4))}"/>`;
  // Put out on the way to the next base: a line part of the way there, and a bar across it.
  if (c.outN && c.outAt > c.reach && c.outAt > 0 && (c.reach > 0 || c.outAt > 1)) {
    const a = PT[c.reach], b = PT[Math.min(c.outAt, 4)], m = mid(a, b, 0.55);
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), nx = -dy / l * 4, ny = dx / l * 4;
    s += `<line class="path" x1="${a[0]}" y1="${a[1]}" x2="${m[0]}" y2="${m[1]}"/><line class="path" x1="${m[0] - nx}" y1="${m[1] - ny}" x2="${m[0] + nx}" y2="${m[1] + ny}"/>`;
    if (c.outHow) s += note(Math.min(c.outAt, 4), c.outHow);
  } else if (c.outN && c.outAt && c.outAt <= c.reach && c.outHow) s += note(c.outAt, c.outHow); // picked off
  for (let b = 1; b <= 4; b++) if (c.notes[b]) s += note(b, c.notes[b]);

  const m = c.mark || '';
  if (R.kind === 'out' && !c.reach) {
    // The out itself, big in the middle: K, 6-3, F8. A strikeout looking is a backwards K.
    if (c.r === 'KL') s += '<text class="big k" x="30" y="40" transform="translate(60 0) scale(-1 1)">K</text>';
    else if (c.r === 'K') s += '<text class="big k" x="30" y="40">K</text>';
    else {
      const [a, b] = m.split(' ');
      const size = a.length <= 2 ? 15 : a.length <= 3 ? 13 : a.length <= 5 ? 11 : 9;
      s += `<text class="big" x="30" y="${b ? 34 : 37}" style="font-size:${size}px">${esc(a)}</text>`;
      if (b) s += `<text class="sub" x="30" y="44">${esc(b)}</text>`;
    }
  } else if (m) {
    s += `<text class="mk" x="58" y="58">${esc(m)}</text>`;
  }
  if (c.outN) s += `<circle class="on" cx="7.5" cy="7.5" r="5.6"/><text class="onn" x="7.5" y="10.3">${c.outN}</text>`;
  if (count && c.seq) s += `<text class="ct" x="58" y="8">${c.count[0]}-${c.count[1]}</text>`;
  for (let i = 0; i < Math.min(c.rbi, 4); i++) s += `<circle class="rbi" cx="${4 + i * 4.6}" cy="56" r="1.7"/>`;
  return s + '</svg>';
}
// Just the first word fits in the box ("CS", not "CS 2-6"); tapping the box tells the rest.
function note(b, t) {
  const [x, y, anchor] = NOTE[b];
  t = String(t).split(' ')[0];
  return `<text class="nt" x="${x}" y="${y}" text-anchor="${anchor}">${esc(t)}</text>`;
}

// Substitutions in each slot of one team's order, in the order they happened.
function subsOf(g, side) {
  const out = {};
  for (const e of g.ev) if (e.t === 'sub' && e.s === side) (out[e.slot] ||= []).push(e);
  return out;
}

const TYPE = { ph: 'PH', pr: 'PR', def: 'in' };

// The card for one team. live: mark where the next batter goes.
export function cardHtml(S, side, { live = true } = {}) {
  const g = S.g, cols = columns(S, side), subs = subsOf(g, side);
  const at = new Map();
  for (const c of S.cells) if (c.side === side) at.set(`${c.slot}:${c.inn}:${c.k}`, c);
  // Where the batter now at the plate will go.
  let next = '';
  if (live && !S.over && S.half === side) {
    const slot = S.up[side], k = S.col.used.has(slot) ? S.col.k + 1 : S.col.k;
    next = `${slot}:${S.inn}:${k}`;
    if (k > (S.extra[side][S.inn - 1] || 0)) cols.splice(cols.findIndex(c => c.inn === S.inn && c.k === k - 1) + 1, 0, { inn: S.inn, k });
  }
  const span = {};
  for (const c of cols) span[c.inn] = (span[c.inn] || 0) + 1;
  const curInn = !S.over && S.half === side ? S.inn : 0;

  let h = '<table class="card"><thead><tr><th class="who" scope="col">Batter</th>';
  for (const [inn, n] of Object.entries(span)) h += `<th scope="col" colspan="${n}"${+inn === curInn ? ' class="cur"' : ''}>${inn}</th>`;
  h += '<th class="tot" scope="col">AB</th><th class="tot" scope="col">R</th><th class="tot" scope="col">H</th><th class="tot" scope="col">RBI</th></tr></thead><tbody>';

  for (let slot = 0; slot < S.size[side]; slot++) {
    const players = g.teams[side].lineup[slot] || [{ name: '', num: '' }];
    const shown = [0, ...(subs[slot] || []).map(e => e.i)];
    const nowAt = live && !S.over && S.half === side && S.up[side] === slot;
    h += `<tr${nowAt ? ' class="up"' : ''}><th class="who" scope="row"><span class="ord">${slot + 1}</span><span class="names">`;
    shown.forEach((pi, j) => {
      const p = players[pi] || players[0], e = j ? subs[slot][j - 1] : null;
      h += `<span class="pl${j < shown.length - 1 ? ' was' : ''}">${e ? `<i>${TYPE[e.ty]}</i> ` : ''}${esc(label(p, slot))}</span>`;
    });
    h += '</span></th>';
    for (const col of cols) {
      const k = `${slot}:${col.inn}:${col.k}`, c = at.get(k);
      const cls = [c && c.end ? 'end' : '', k === next ? 'next' : '', col.inn === curInn ? 'cur' : ''].filter(Boolean).join(' ');
      h += `<td${cls ? ` class="${cls}"` : ''}>${c ? `<button type="button" class="box" data-cell="${c.n}" aria-label="${esc(c.text)}">${cellSvg(c, { count: g.pitches })}</button>` : ''}</td>`;
    }
    const t = { ab: 0, r: 0, h: 0, rbi: 0 };
    shown.forEach(pi => { const b = S.bat[batKey(side, slot, pi)]; if (b) for (const x in t) t[x] += b[x]; });
    h += `<td class="tot">${t.ab}</td><td class="tot">${t.r}</td><td class="tot">${t.h}</td><td class="tot">${t.rbi}</td></tr>`;
  }
  h += '</tbody><tfoot>';
  const rows = [['R', S.line[side]], ['H', S.hInn[side]], ['E', S.eInn[side]], ['LOB', S.lob[side]]];
  const tot = { R: S.R[side], H: S.H[side], E: S.eInn[side].reduce((a, b) => a + (b || 0), 0), LOB: S.lob[side].reduce((a, b) => a + (b || 0), 0) };
  for (const [name, arr] of rows) {
    h += `<tr><th class="who" scope="row">${name}</th>`;
    for (const [inn, n] of Object.entries(span)) {
      const v = arr[inn - 1];
      h += `<td colspan="${n}">${v == null || (name === 'LOB' && S.line[side][inn - 1] == null) ? '' : v}</td>`;
    }
    h += `<td class="tot" colspan="4">${name === 'R' || name === 'H' ? tot[name] : name === 'LOB' ? tot.LOB : tot.E}</td></tr>`;
  }
  return h + '</tfoot></table>';
}

// The inning-by-inning score for both teams, as on a stadium board.
export function lineHtml(S) {
  const g = S.g, n = innings(S);
  let h = '<table class="linescore"><thead><tr><th scope="col"><span class="sr">Team</span></th>';
  for (let i = 1; i <= n; i++) h += `<th scope="col"${!S.over && S.inn === i ? ' class="cur"' : ''}>${i}</th>`;
  h += '<th scope="col" class="rhe">R</th><th scope="col" class="rhe">H</th><th scope="col" class="rhe">E</th></tr></thead><tbody>';
  for (const side of [0, 1]) {
    h += `<tr><th scope="row">${esc(g.teams[side].name || (side ? 'Home' : 'Visitors'))}</th>`;
    for (let i = 1; i <= n; i++) {
      let v = S.line[side][i - 1];
      // The home team didn't need its last turn at bat.
      if (v == null && side === 1 && S.over && !S.ended && i === n && S.line[0][i - 1] != null) v = 'X';
      const now = !S.over && S.inn === i && S.half === side;
      h += `<td${now ? ' class="now"' : ''}>${v ?? ''}</td>`;
    }
    h += `<td class="rhe">${S.R[side]}</td><td class="rhe">${S.H[side]}</td><td class="rhe">${S.E[side]}</td></tr>`;
  }
  return h + '</tbody></table>';
}

export const inningName = (inn, half) => `${half ? 'Bottom' : 'Top'} of the ${ord(inn)}`;
export const who = (g, side, slot, p) => label(player(g, side, slot, p), slot);
