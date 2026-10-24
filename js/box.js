// The box score (batting and pitching lines for both teams) and the play-by-play.
import { batKey, pitchStat, pitcherLabel, ip, teamName, label, player, ord } from './engine.js';
import { esc, KL } from './ui.js';

function batting(S, side) {
  const g = S.g, team = g.teams[side];
  const rows = [], tot = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0 };
  for (let slot = 0; slot < S.size[side]; slot++) {
    const seen = new Set([0]);
    for (const e of g.ev) if (e.t === 'sub' && e.s === side && e.slot === slot) seen.add(e.i);
    for (const pi of seen) {
      const b = S.bat[batKey(side, slot, pi)] || { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0 };
      const p = (team.lineup[slot] || [])[pi] || { name: '', num: '' };
      rows.push(`<tr${pi ? ' class="sub"' : ''}><th scope="row">${pi ? '' : `<span class="ord">${slot + 1}</span>`}${esc(label(p, slot))}</th><td>${b.ab}</td><td>${b.r}</td><td>${b.h}</td><td>${b.rbi}</td><td>${b.bb}</td><td>${b.k}</td></tr>`);
      for (const x in tot) tot[x] += b[x];
    }
  }
  return `<table class="stats"><thead><tr><th scope="col">${esc(teamName(g, side))}</th><th scope="col">AB</th><th scope="col">R</th><th scope="col">H</th><th scope="col">RBI</th><th scope="col">BB</th><th scope="col">K</th></tr></thead>
    <tbody>${rows.join('')}</tbody><tfoot><tr><th scope="row">Totals</th><td>${tot.ab}</td><td>${tot.r}</td><td>${tot.h}</td><td>${tot.rbi}</td><td>${tot.bb}</td><td>${tot.k}</td></tr></tfoot></table>`;
}

function pitching(S, side) {
  const g = S.g, used = new Set([0]);
  for (const e of g.ev) if (e.t === 'pch' && e.s === side) used.add(e.i);
  const rows = [...used].map(i => {
    const p = pitchStat(S, side, i);
    return `<tr><th scope="row">${esc(pitcherLabel(g, side, i))}</th><td>${ip(p.outs)}</td><td>${p.h}</td><td>${p.r}</td><td>${p.bb}</td><td>${p.k}</td>${g.pitches ? `<td>${p.np}${p.np ? ` <small>${p.str} strike${p.str === 1 ? '' : 's'}</small>` : ''}</td>` : ''}</tr>`;
  });
  return `<table class="stats"><thead><tr><th scope="col">${esc(teamName(g, side))} pitching</th><th scope="col">IP</th><th scope="col">H</th><th scope="col">R</th><th scope="col">BB</th><th scope="col">K</th>${g.pitches ? '<th scope="col">Pitches</th>' : ''}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// Doubles, triples, homers and steals, the way a newspaper box score lists them.
function extras(S) {
  const g = S.g, lists = { '2B': [], '3B': [], HR: [], SB: [] };
  for (const [k, b] of Object.entries(S.bat)) {
    const [side, slot, p] = k.split('.').map(Number), n = label(player(g, side, slot, p), slot);
    const add = (list, count) => { if (count) lists[list].push(`${esc(n)}${count > 1 ? ' ' + count : ''}`); };
    add('2B', b.d); add('3B', b.t); add('HR', b.hr); add('SB', b.sb);
  }
  const words = { '2B': 'Doubles', '3B': 'Triples', HR: 'Home runs', SB: 'Stolen bases' };
  return Object.entries(words).filter(([k]) => lists[k].length).map(([k, w]) => `<p><b>${w}:</b> ${lists[k].join(', ')}</p>`).join('');
}

export function boxHtml(S) {
  return `<div class="box-grid">
    <div>${batting(S, 0)}${pitching(S, 0)}</div>
    <div>${batting(S, 1)}${pitching(S, 1)}</div>
  </div><div class="extras">${extras(S)}</div>`;
}

// Newest first, in half-innings, so the last few plays are at the top during a game.
export function playsHtml(S, { limit = 0 } = {}) {
  const g = S.g, groups = [];
  for (const p of S.plays) {
    let grp = groups[groups.length - 1];
    if (!grp || grp.inn !== p.inn || grp.half !== p.half) groups.push(grp = { inn: p.inn, half: p.half, list: [] });
    grp.list.push(p);
  }
  if (!groups.length) return '<p class="quiet">Nothing has happened yet. The first pitch is all yours.</p>';
  let n = 0, h = '';
  for (const grp of groups.reverse()) {
    if (limit && n >= limit) break;
    h += `<section class="half"><h3>${grp.half ? 'Bottom' : 'Top'} of the ${ord(grp.inn)} <span>${esc(teamName(g, grp.half))} batting</span></h3><ol>`;
    for (const p of grp.list.slice().reverse()) {
      if (limit && n++ >= limit) break;
      h += `<li class="${p.kind}${p.runs ? ' scored' : ''}">${p.r === 'KL' ? `<span class="pk">${KL}</span>` : ''}${esc(p.text)}${p.runs ? ` <b class="runs">+${p.runs}</b>` : ''}</li>`;
    }
    h += '</ol></section>';
  }
  return h;
}
