// The scorecard: one row per spot in the batting order, one column per inning, and in each box a small diamond
// with the batter's trip around the bases drawn the way it's done on paper.
import { RESULTS, columns, innings, label, player, batKey, ord, pitcherLabel } from './engine.js';
import { esc } from './ui.js';

// The diamond in a 60 x 60 box: home, first, second, third.
const PT = [[30, 51], [49, 32], [30, 13], [11, 32], [30, 51]];
// Where the note for reaching each base goes: beside the base path that ends there, outside the diamond (at third,
// below the circled out number).
const NOTE = [null, [46, 50, 'start'], [58, 17, 'end'], [2, 22, 'start'], [2, 50, 'start']];
// Picked off a base: inside the diamond by that base, so it's clear of the note for how they got there.
const INSIDE = [null, [41, 34, 'end'], [30, 26, 'middle'], [19, 34, 'start']];
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
  } else if (c.outN && c.outAt && c.outAt <= c.reach && c.outHow) s += note(c.outAt, c.outHow, INSIDE); // picked off
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
    s += `<text class="mk${m.length > 4 ? ' sm' : ''}" x="58" y="58">${esc(m)}</text>`;
  }
  if (c.outN) s += `<circle class="on" cx="7.5" cy="7.5" r="5.6"/><text class="onn" x="7.5" y="10.3">${c.outN}</text>`;
  if (count && c.seq) s += `<text class="ct" x="58" y="8">${c.count[0]}-${c.count[1]}</text>`;
  for (let i = 0; i < Math.min(c.rbi, 4); i++) s += `<circle class="rbi" cx="${4 + i * 4.6}" cy="53.5" r="1.7"/>`;
  return s + '</svg>';
}
// Just the first word fits in the box ("CS", not "CS 2-6"); tapping the box tells the rest.
function note(b, t, at = NOTE) {
  const [x, y, anchor] = at[b];
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
const BACK = 'back'; // someone who was in the spot before, coming back in

// As on paper: a heavy line along the top of the first box a new pitcher faced, and down the left of a substitute's
// first box. Gives the boxes' numbers, with the pitcher's name for the first.
function changes(S, side) {
  const g = S.g, mine = S.cells.filter(c => c.side === side), pch = new Map(), sub = new Set();
  g.ev.forEach((e, j) => {
    // (A change before anyone on this side batted has nothing to mark.)
    if (e.t === 'pch' && e.s !== side && mine.some(c => c.ev < j)) {
      const c = mine.find(c => c.ev > j);
      if (c) pch.set(c.n, pitcherLabel(g, e.s, e.i));
    }
    if (e.t === 'sub' && e.s === side) {
      const c = mine.find(c => c.ev > j && c.slot === e.slot && c.p === e.i);
      if (c) sub.add(c.n);
    }
  });
  return { pch, sub };
}

// A box in words, the way it reads on paper: the inning, the play, what happened after, the out, the RBIs and the
// count. "1st inning. Brennan doubles. To third on Lindqvist's ground out. Count: 1 ball, 2 strikes."
function boxWords(c, count) {
  const few = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return [`${ord(c.inn)} inning.`, c.text, ...c.story, c.outN ? `${ord(c.outN)} out.` : '', c.rbi ? `${c.rbi} RBI.` : '',
    count ? `Count: ${few(c.count[0], 'ball')}, ${few(c.count[1], 'strike')}.` : ''].filter(Boolean).join(' ');
}
// A heading's short form, with its words for a screen reader and a mouse pointer.
const WORDS = { AB: 'At bats', R: 'Runs', H: 'Hits', RBI: 'Runs batted in', BB: 'Walks', K: 'Strikeouts', IP: 'Innings pitched', HR: 'Home runs', BF: 'Batters faced', 'P-S': 'Pitches and strikes' };
export const abbr = k => `<abbr title="${WORDS[k]}">${k}</abbr>`;

// The card for one team. live: mark where the next batter goes.
export function cardHtml(S, side, { live = true } = {}) {
  const g = S.g, cols = columns(S, side), subs = subsOf(g, side), marks = changes(S, side);
  const innOf = new Map(S.plays.filter(p => p.kind === 'sub').map(p => [p.i, p.inn]));
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
  for (const [inn, n] of Object.entries(span)) h += `<th scope="col" colspan="${n}"${+inn === curInn ? ' class="cur"' : ''}><span class="sr">Inning </span>${inn}</th>`;
  h += `${['AB', 'R', 'H', 'RBI'].map(k => `<th class="tot" scope="col">${abbr(k)}</th>`).join('')}</tr></thead><tbody>`;

  for (let slot = 0; slot < S.size[side]; slot++) {
    const players = g.teams[side].lineup[slot] || [{ name: '', num: '' }];
    const shown = [0, ...(subs[slot] || []).map(e => e.i)];
    const nowAt = live && !S.over && S.half === side && S.up[side] === slot;
    h += `<tr${nowAt ? ' class="up"' : ''}><th class="who" scope="row"><span class="ord">${slot + 1}</span><span class="names">`;
    shown.forEach((pi, j) => {
      const p = players[pi] || players[0], e = j ? subs[slot][j - 1] : null;
      const inn = e && innOf.get(g.ev.indexOf(e));
      const ty = e && (shown.slice(0, j).includes(pi) ? BACK : TYPE[e.ty]);
      h += `<span class="pl${j < shown.length - 1 ? ' was' : ''}">${e ? `<i>${ty}${inn ? ' ' + ord(inn) : ''}</i> ` : ''}${esc(label(p, slot))}</span>`;
    });
    h += `</span>${nowAt ? '<span class="sr">, at bat</span>' : ''}</th>`;
    for (const col of cols) {
      const k = `${slot}:${col.inn}:${col.k}`, c = at.get(k);
      const who = c && marks.pch.get(c.n), from = who ? `${who} pitching from here` : '';
      const cls = [c && who ? 'pch' : '', c && marks.sub.has(c.n) ? 'sub' : '', c && c.end ? 'end' : '', k === next ? 'next' : '', col.inn === curInn ? 'cur' : ''].filter(Boolean).join(' ');
      const up = k === next ? `<span class="sr">${esc(label(player(g, side, slot, S.pl[side][slot] || 0), slot))} is up</span>` : '';
      h += `<td${cls ? ` class="${cls}"` : ''}${from ? ` title="${esc(from)}"` : ''}>${c ? `<button type="button" class="box" data-cell="${c.n}" aria-label="${esc(boxWords(c, g.pitches) + (from ? ` ${from}.` : ''))}">${cellSvg(c, { count: g.pitches })}</button>` : up}</td>`;
    }
    const t = { ab: 0, r: 0, h: 0, rbi: 0 };
    new Set(shown).forEach(pi => { const b = S.bat[batKey(side, slot, pi)]; if (b) for (const x in t) t[x] += b[x]; });
    h += `<td class="tot">${t.ab}</td><td class="tot">${t.r}</td><td class="tot">${t.h}</td><td class="tot">${t.rbi}</td></tr>`;
  }
  h += '</tbody><tfoot>';
  const rows = [['R', S.line[side]], ['H', S.hInn[side]], ['E', S.eInn[side]], ['LOB', S.lob[side]]];
  const tot = { R: S.R[side], H: S.H[side], E: S.eInn[side].reduce((a, b) => a + (b || 0), 0), LOB: S.lob[side].reduce((a, b) => a + (b || 0), 0) };
  for (const [name, arr] of rows) {
    h += `<tr><th class="who" scope="row"${name === 'E' ? ' title="Errors by the other team while these batters were up"' : ''}>${name}</th>`;
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
      // The home team didn't need its last turn at bat: it was ahead when the game ended after the top of an inning.
      if (v == null && side === 1 && S.over && S.between && S.half === 0 && i === S.inn && S.R[1] > S.R[0]) v = 'X';
      const now = !S.over && S.inn === i && S.half === side;
      h += `<td${now ? ' class="now"' : ''}>${v ?? ''}</td>`;
    }
    h += `<td class="rhe">${S.R[side]}</td><td class="rhe">${S.H[side]}</td><td class="rhe">${S.E[side]}</td></tr>`;
  }
  return h + '</tbody></table>';
}

export const inningName = (inn, half) => `${half ? 'Bottom' : 'Top'} of the ${ord(inn)}`;
export const who = (g, side, slot, p) => label(player(g, side, slot, p), slot);
