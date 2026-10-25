// The box score (batting and pitching lines for both teams) and the play-by-play.
import { batKey, pitchStat, pitcherLabel, ip, teamName, label, player, ord, pitchWords, POS, RESULTS } from './engine.js';
import { esc, KL } from './ui.js';
import { abbr } from './card.js';

// How each substitute first came in, as the card says it: PH, PR, or sub (a change in the field).
const HOW = { ph: ['PH', 'Pinch hitter'], pr: ['PR', 'Pinch runner'], def: ['sub', 'Substitute'] };

// One row for each player who was in each spot (a starter who came back in still has one), substitutes under the
// starter with how they came in.
function batting(S, side) {
  const g = S.g, team = g.teams[side];
  const rows = [], tot = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0 };
  for (let slot = 0; slot < S.size[side]; slot++) {
    const seen = new Map([[0, null]]);
    for (const e of g.ev) if (e.t === 'sub' && e.s === side && e.slot === slot && !seen.has(e.i)) seen.set(e.i, e.ty);
    for (const [pi, ty] of seen) {
      const b = S.bat[batKey(side, slot, pi)] || { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0 };
      const p = (team.lineup[slot] || [])[pi] || { name: '', num: '' };
      const how = ty && HOW[ty] ? `<abbr class="how" title="${HOW[ty][1]}">${HOW[ty][0]}</abbr> ` : '';
      rows.push(`<tr${pi ? ' class="sub"' : ''}><th scope="row">${pi ? how : `<span class="ord">${slot + 1}</span>`}${esc(label(p, slot))}</th><td>${b.ab}</td><td>${b.r}</td><td>${b.h}</td><td>${b.rbi}</td><td>${b.bb}</td><td>${b.k}</td></tr>`);
      for (const x in tot) tot[x] += b[x];
    }
  }
  return `<table class="stats"><thead><tr><th scope="col">${esc(teamName(g, side))}</th>${['AB', 'R', 'H', 'RBI', 'BB', 'K'].map(k => `<th scope="col">${abbr(k)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody><tfoot><tr><th scope="row">Totals</th><td>${tot.ab}</td><td>${tot.r}</td><td>${tot.h}</td><td>${tot.rbi}</td><td>${tot.bb}</td><td>${tot.k}</td></tr></tfoot></table>`;
}

function pitching(S, side) {
  const g = S.g, used = new Set([0]);
  for (const e of g.ev) if (e.t === 'pch' && e.s === side) used.add(e.i);
  const rows = [...used].map(i => {
    const p = pitchStat(S, side, i);
    return `<tr><th scope="row">${esc(pitcherLabel(g, side, i))}</th><td>${ip(p.outs)}</td><td>${p.h}</td><td>${p.r}</td><td>${p.bb}</td><td>${p.k}</td>${g.pitches ? `<td>${p.np}${p.np ? ` <small>${p.str} strike${p.str === 1 ? '' : 's'}</small>` : ''}</td>` : ''}</tr>`;
  });
  return `<table class="stats"><thead><tr><th scope="col">${esc(teamName(g, side))} pitching</th>${['IP', 'H', 'R', 'BB', 'K'].map(k => `<th scope="col">${abbr(k)}</th>`).join('')}${g.pitches ? '<th scope="col">Pitches</th>' : ''}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// Names in game order, each once, with how many times when it's more than one: "Velez 2, Brennan".
function names(pairs) {
  const m = new Map();
  for (const [n, k] of pairs) m.set(n, (m.get(n) || 0) + k);
  return [...m].filter(([, k]) => k).map(([n, k]) => n + (k > 1 ? ' ' + k : '')).join(', ');
}

// The notes under one team's box score, the way a newspaper prints them: its extra-base hits, sacrifices, hit
// batters, steals, runners left on base and errors, then its pitchers' wild pitches, hit batters, balks and batters
// faced. Lines with nothing to say are left out.
function notes(S, side) {
  const g = S.g, cells = S.cells.filter(c => c.side === side), who = c => label(player(g, side, c.slot, c.p), c.slot);
  const of = r => names(cells.filter(c => c.r === r).map(c => [who(c), 1]));
  const bats = Object.entries(S.bat).filter(([k]) => k.startsWith(side + '.')).map(([k, b]) => {
    const [, slot, p] = k.split('.').map(Number);
    return [label(player(g, side, slot, p), slot), b];
  });
  const arms = [...new Set([0, ...g.ev.filter(e => e.t === 'pch' && e.s === side).map(e => e.i)])].map(i => [pitcherLabel(g, side, i), pitchStat(S, side, i)]);
  const hit = S.cells.filter(c => c.side !== side && c.r === 'HBP');
  const errs = names(S.errs[side].map(f => [f === 'CI' ? 'catcher’s interference' : POS[f] || 'fielder not given', 1]));
  const lines = [
    ['Doubles', of('2B')], ['Triples', of('3B')], ['Home runs', of('HR')], ['Sacrifice flies', of('SF')], ['Sacrifice bunts', of('SAC')],
    ['Hit by a pitch', of('HBP')], ['Stolen bases', names(bats.map(([n, b]) => [n, b.sb]))], ['Caught stealing', names(bats.map(([n, b]) => [n, b.cs]))],
    ['Left on base', String(S.lob[side].reduce((a, b) => a + (b || 0), 0))], ['Errors', errs],
    ['Wild pitches', names(arms.map(([n, p]) => [n, p.wp]))],
    ['Hit batters', names(hit.map(c => [`${pitcherLabel(g, side, c.pi)} (${label(player(g, c.side, c.slot, c.p), c.slot)})`, 1]))],
    ['Balks', names(arms.map(([n, p]) => [n, p.bk]))], ['Batters faced', arms.filter(([, p]) => p.bf).map(([n, p]) => `${n} ${p.bf}`).join(', ')],
  ];
  return lines.filter(([, t]) => t).map(([w, t]) => `<p><b>${w}:</b> ${esc(t)}.</p>`).join('');
}

// How one player's day is going, for the batter sheet: each trip to the plate in order (its inning, mark and words),
// and a line that adds up, naming only what isn't zero: "1 for 2, a walk, a run, 2 stolen bases".
export function dayOf(S, side, slot, p) {
  const trips = S.cells.filter(c => c.side === side && c.slot === slot && c.p === p)
    .map(c => ({ inn: c.inn, r: c.r, mark: c.mark, words: (RESULTS[c.r] || { label: '' }).label.toLowerCase() }));
  const b = S.bat[batKey(side, slot, p)];
  if (!b) return { trips, line: '' };
  const n = (k, one, many) => k && (k === 1 ? one : `${k} ${many}`);
  const line = [`${b.h} for ${b.ab}`, n(b.r, 'a run', 'runs'), n(b.rbi, 'an RBI', 'RBI'), n(b.bb, 'a walk', 'walks'),
    n(b.hbp, 'hit by a pitch', 'times hit by a pitch'), n(b.sb, 'a stolen base', 'stolen bases'), n(b.k, 'a strikeout', 'strikeouts')];
  return { trips, line: line.filter(Boolean).join(', ') };
}

export function boxHtml(S) {
  return `<div class="box-grid">${[0, 1].map(side => `
    <div>${batting(S, side)}${pitching(S, side)}
      <div class="extras">${notes(S, side)}</div>
    </div>`).join('')}
  </div>`;
}

// In half-innings: newest first during a game, so the last few plays are at the top, and from the first pitch on
// once it's over. Under each at-bat, the count it ended on and how many pitches (each one in words in its title);
// under the end of each half-inning, its runs, hits, errors and runners left on.
export function playsHtml(S, { limit = 0 } = {}) {
  const g = S.g, groups = [];
  for (const p of S.plays) {
    let grp = groups[groups.length - 1];
    if (!grp || grp.inn !== p.inn || grp.half !== p.half) groups.push(grp = { inn: p.inn, half: p.half, list: [] });
    grp.list.push(p);
  }
  if (!groups.length) return `<p class="quiet">${g.ev.some(e => e.t === 'p') ? 'No plays yet: the first at-bat is still going.' : 'Nothing has happened yet. The first pitch is all yours.'}</p>`;
  const back = !S.over || limit, order = list => (back ? list.slice().reverse() : list);
  let n = 0, h = '';
  for (const grp of order(groups)) {
    if (limit && n >= limit) break;
    h += `<section class="half"><h3>${grp.half ? 'Bottom' : 'Top'} of the ${ord(grp.inn)} <span>${esc(teamName(g, grp.half))} batting</span></h3><ol>`;
    for (const p of order(grp.list)) {
      if (limit && n++ >= limit) break;
      const c = p.kind === 'pa' && g.pitches && S.cells[p.cell], np = c ? c.seq.length : 0;
      const more = np ? `<small class="pc" title="${esc(cap(pitchWords(c.seq)))}">${c.count[0]}-${c.count[1]} · ${np} pitch${np === 1 ? '' : 'es'}</small>`
        : p.sum ? `<small>${esc(p.sum)}</small>` : '';
      h += `<li class="${p.kind}${p.runs ? ' scored' : ''}">${p.r === 'KL' ? `<span class="pk">${KL}</span>` : ''}${esc(p.text)}${p.runs ? ` <b class="runs">+${p.runs}</b>` : ''}${more}</li>`;
    }
    h += '</ol></section>';
  }
  return h;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
