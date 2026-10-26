// The box score (batting and pitching lines for both teams) and the play-by-play.
import { batKey, pitchStat, pitcherLabel, ip, teamName, label, player, ord, pitchWords, POS_NAME, RESULTS, AUTO, restDays, noCatch, LIMIT_BY, decisions, decisionWords, decider, milestones, clockOf, pitchesIn, toWhere, located, saysWhere, runnersOn } from './engine.js';
import { esc, KL, clockAt, hm } from './ui.js';
import { abbr } from './card.js';
import { sprayField } from './field.js';
import { teamHref } from './stats.js';

// How each substitute first came in, as the card says it: PH, PR, or sub (a change in the field).
const HOW = { ph: ['PH', 'Pinch hitter'], pr: ['PR', 'Pinch runner'], def: ['sub', 'Substitute'] };

// A player's name, as a link to his season with this team (team.js), when links are wanted (a game on this device:
// not a shared link's, nor on paper) and there's a team name, and a name or number to go by.
function linked(S, side, p, html, links) {
  const team = S.g.teams[side].name.trim();
  return links && team && p && (p.name || p.num) ? `<a href="${esc(teamHref(team, String(S.g.date).slice(0, 4), p))}">${html}</a>` : html;
}

// One row for each player who was in each spot (a starter who came back in still has one), substitutes under the
// starter with how they came in. Someone who hasn't batted (or run) yet has dashes, not a row of zeros.
function batting(S, side, links) {
  const g = S.g, team = g.teams[side];
  const rows = [], tot = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0 };
  for (let slot = 0; slot < S.size[side]; slot++) {
    const seen = new Map([[0, null]]);
    for (const e of g.ev) if (e.t === 'sub' && e.s === side && e.slot === slot && !seen.has(e.i)) seen.set(e.i, e.ty);
    for (const [pi, ty] of seen) {
      const b = S.bat[batKey(side, slot, pi)];
      const p = (team.lineup[slot] || [])[pi] || { name: '', num: '' };
      const how = ty && HOW[ty] ? `<abbr class="how" title="${HOW[ty][1]}">${HOW[ty][0]}</abbr> ` : '';
      const cells = Object.keys(tot).map(x => `<td>${b ? b[x] : '<span aria-label="none">–</span>'}</td>`).join('');
      const ps = p.pos ? ` <small class="ps">${esc(p.pos)}</small>` : '';
      rows.push(`<tr${pi ? ' class="sub"' : ''}><th scope="row">${pi ? how : `<span class="ord">${slot + 1}</span>`}${linked(S, side, p, esc(label(p, slot)), links)}${ps}</th>${cells}</tr>`);
      if (b) for (const x in tot) tot[x] += b[x];
    }
  }
  return `<table class="stats"><thead><tr><th scope="col">${esc(teamName(g, side))}</th>${['AB', 'R', 'H', 'RBI', 'BB', 'K'].map(k => `<th scope="col">${abbr(k)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody><tfoot><tr><th scope="row">Totals</th><td>${tot.ab}</td><td>${tot.r}</td><td>${tot.h}</td><td>${tot.rbi}</td><td>${tot.bb}</td><td>${tot.k}</td></tr></tfoot></table>`;
}

// (W, L or S beside a name: the win, the loss or the save, once the game is won.)
const DEC = { w: ['W', 'Winning pitcher'], l: ['L', 'Losing pitcher'], s: ['S', 'Save'] };
function pitching(S, side, links) {
  const g = S.g, used = new Set([0]), d = decisions(S);
  for (const e of g.ev) if (e.t === 'pch' && e.s === side) used.add(e.i);
  const rows = [...used].map(i => {
    const p = pitchStat(S, side, i), k = d && (side === d.win ? (i === d.w ? 'w' : i === d.s ? 's' : '') : i === d.l ? 'l' : '');
    return `<tr><th scope="row">${linked(S, side, g.teams[side].pitchers[i], esc(pitcherLabel(g, side, i)), links)}${k ? ` <abbr class="dec" title="${DEC[k][1]}">${DEC[k][0]}</abbr>` : ''}</th><td>${ip(p.outs)}</td><td>${p.h}</td><td>${p.r}</td><td>${p.er}</td><td>${p.bb}</td><td>${p.k}</td><td>${p.hr}</td><td>${p.bf}</td>${g.pitches ? `<td>${p.np}-${p.str}</td>` : ''}</tr>`;
  });
  // Pitches and strikes as a newspaper prints them: 106-69.
  return `<table class="stats"><thead><tr><th scope="col">${esc(teamName(g, side))} pitching</th>${['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'BF', ...(g.pitches ? ['P-S'] : [])].map(k => `<th scope="col">${abbr(k)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// Names in game order, each once, with how many times when it's more than one: "Velez 2, Brennan".
function names(pairs) {
  const m = new Map();
  for (const [n, k] of pairs) m.set(n, (m.get(n) || 0) + k);
  return [...m].filter(([, k]) => k).map(([n, k]) => n + (k > 1 ? ' ' + k : '')).join(', ');
}

// What a pinch hitter did, for the notes: "Kowalski singled for Ruiz in the 7th."
const PAST = {
  '1B': 'singled', '2B': 'doubled', '3B': 'tripled', HR: 'homered', BB: 'walked', IBB: 'was walked intentionally',
  HBP: 'was hit by a pitch', E: 'reached on an error', FC: 'reached on a fielder’s choice', CI: 'reached on catcher’s interference',
  KD: 'struck out and reached on a dropped third strike', K: 'struck out', KL: 'struck out looking', GO: 'grounded out',
  FO: 'flied out', LO: 'lined out', PU: 'popped out', SF: 'hit a sacrifice fly', SAC: 'sacrificed',
  DP: 'grounded into a double play', TP: 'hit into a triple play',
};
// Who pinch-hit and pinch-ran for whom, and when: [pinch hitters, pinch runners], each a list of sentences.
function pinch(S, side) {
  const g = S.g, out = { ph: [], pr: [] }, cur = {}, been = {};
  g.ev.forEach((e, j) => {
    if (e.t !== 'sub' || e.s !== side) return;
    const was = cur[e.slot] ?? 0, seen = been[e.slot] ||= new Set([0]), back = seen.has(e.i);
    cur[e.slot] = e.i; seen.add(e.i);
    if (back || !out[e.ty]) return; // someone coming back in isn't pinch-hitting or running for the first time
    const who = label(player(g, side, e.slot, e.i), e.slot), them = label(player(g, side, e.slot, was), e.slot);
    const inn = ord((S.plays.find(p => p.i === j) || { inn: 1 }).inn);
    if (e.ty === 'pr') return out.pr.push(`${who} ran for ${them} in the ${inn}`);
    const c = S.cells.find(x => x.side === side && x.slot === e.slot && x.ev > j);
    out.ph.push(`${who} ${c && c.p === e.i && PAST[c.r] ? PAST[c.r] : 'came in to bat'} for ${them} in the ${inn}`);
  });
  return [out.ph.join('; '), out.pr.join('; ')];
}

// The notes under one team's box score, the way a newspaper prints them: once the game is over, what it did that the
// game will be remembered for (a no-hitter, the cycle: see milestones()), then its pinch hitters and runners, courtesy
// runners (the runs and steals they made are the players' they ran for), who left the game and came back (a
// continuous order), extra-base hits, sacrifices, hit batters, steals, runners left on base and errors, then its
// pitchers' wild pitches, hit batters and balks, and under a pitch limit by league age, the days of rest each pitcher
// needs and who can't catch today (Little League Regulation VI). Lines with nothing to say are left out.
function notes(S, side) {
  const g = S.g, cells = S.cells.filter(c => c.side === side), who = c => label(player(g, side, c.slot, c.p), c.slot);
  const of = r => names(cells.filter(c => c.r === r).map(c => [who(c), 1]));
  const bats = Object.entries(S.bat).filter(([k]) => k.startsWith(side + '.')).map(([k, b]) => {
    const [, slot, p] = k.split('.').map(Number);
    return [label(player(g, side, slot, p), slot), b];
  });
  const arms = [...new Set([0, ...g.ev.filter(e => e.t === 'pch' && e.s === side).map(e => e.i)])].map(i => [pitcherLabel(g, side, i), pitchStat(S, side, i)]);
  const hit = S.cells.filter(c => c.side !== side && c.r === 'HBP');
  // By position, in words: "3B" beside the triples would read as one.
  const errs = names(S.errs[side].map(f => [f === 'CI' ? 'catcher’s interference' : POS_NAME[f] || 'fielder not given', 1]));
  const [ph, pr] = pinch(S, side);
  // A continuous order: who left the game (her spot skipped), and who came back, with the inning.
  const left = back => S.left[side].filter(x => x.back === back).map(x => `${label(player(g, side, x.slot, x.p), x.slot)} (${ord(x.inn)})`).join(', ');
  const lines = [
    ['Pinch hitters', ph], ['Pinch runners', pr], ['Courtesy runners', S.crs[side].map(x => `${x.name} ran for ${x.for} in the ${ord(x.inn)}`).join('; ')],
    ['Left the game', left(false)], ['Back in the game', left(true)], ['Doubles', of('2B')], ['Triples', of('3B')], ['Home runs', of('HR')], ['Sacrifice flies', of('SF')], ['Sacrifice bunts', of('SAC')],
    ['Hit by a pitch', of('HBP')], ['Stolen bases', names(bats.map(([n, b]) => [n, b.sb]))], ['Caught stealing', names(bats.map(([n, b]) => [n, b.cs]))],
    ['Left on base', String(S.lob[side].reduce((a, b) => a + (b || 0), 0))], ['Errors', errs],
    ['Wild pitches', names(arms.map(([n, p]) => [n, p.wp]))],
    // (Extra innings that start with a runner on second: his run is unearned, OBR 7.01(b).)
    ['Unearned runs, from the runner put on second', names(arms.map(([n, p]) => [n, p.ur || 0]))],
    ['Hit batters', names(hit.map(c => [`${pitcherLabel(g, side, c.pi)} (${label(player(g, c.side, c.slot, c.p), c.slot)})`, 1]))],
    ['Balks', names(arms.map(([n, p]) => [n, p.bk]))],
    ...rest(S, arms),
  ];
  const feats = milestones(S).filter(m => m.side === side).map(m => `<p class="feat">${esc(m.text)}</p>`).join('');
  return feats + lines.filter(([, t]) => t).map(([w, t]) => `<p><b>${w}:</b> ${esc(t)}.</p>`).join('') + proof(S, side);
}

// The scorer's proof of a team's box score (OBR 9.03(c)), last under its notes: every trip to the plate ended as a run,
// a runner left on base or an out. "Proof: 38 trips to the plate = 5 runs + 6 left on base + 27 outs." During a game it
// counts the half-inning going on, with its runners still on, and says so far. The runner put on second to start an
// extra inning is counted too, though he didn't bat; runs a game was picked up with aren't, nor the innings before.
function proof(S, side) {
  const cells = S.cells.filter(c => c.side === side), auto = cells.filter(c => c.auto).length;
  if (!cells.length) return '';
  const few = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`, sum = a => a.reduce((x, y) => x + (y || 0), 0);
  const now = side === S.half && !S.between && !S.over ? runnersOn(S).length : 0;
  const trips = few(cells.length - auto, 'trip') + ' to the plate' + (auto ? ` and ${few(auto, 'runner')} put on second` : '');
  const ends = [few(sum(S.line[side]), 'run'), `${sum(S.lob[side]) + (now ? S.waved : 0)} left on base`, now ? `${now} on base now` : '', few(cells.filter(c => c.outN).length, 'out')];
  return `<p class="proof">Proof${S.over ? '' : ' so far'}: ${trips} = ${ends.filter(Boolean).join(' + ')}.</p>`;
}

// Under a pitch limit by league age, with pitches counted: each pitcher's days of rest, and in Little League, those who
// threw 41 or more and can't catch today.
function rest(S, arms) {
  const L = S.g.limit, thrown = arms.filter(([, p]) => p.np);
  if (!L || !LIMIT_BY[L.by] || !S.g.pitches || !thrown.length) return [];
  return [
    [`Days of rest (${LIMIT_BY[L.by]}, ${L.age.replace('-', '–')})`, thrown.map(([n, p]) => { const d = restDays(L, p.np); return `${n} ${d ? `${d} day${d > 1 ? 's' : ''}` : 'none'}`; }).join(', ')],
    ['Can’t catch today (41 or more pitches)', thrown.filter(([, p]) => noCatch(L, p.np)).map(([n]) => n).join(', ')],
  ];
}

// How one player's day is going, for the batter sheet: each trip to the plate in order (its inning, mark and words),
// and a line that adds up, naming only what isn't zero: "1 for 2, a walk, a run, 2 stolen bases".
export function dayOf(S, side, slot, p) {
  const trips = S.cells.filter(c => c.side === side && c.slot === slot && c.p === p)
    .map(c => ({ inn: c.inn, r: c.r, mark: c.mark, words: (RESULTS[c.r] || (c.auto ? AUTO : { label: '' })).label.toLowerCase() + (c.f && RESULTS[c.r]?.kind === 'hit' ? ` to ${toWhere(c.f[0])}` : '') }));
  const b = S.bat[batKey(side, slot, p)];
  if (!b) return { trips, line: '' };
  const n = (k, one, many) => k && (k === 1 ? one : `${k} ${many}`);
  const line = [`${b.h} for ${b.ab}`, n(b.r, 'a run', 'runs'), n(b.rbi, 'an RBI', 'RBI'), n(b.bb, 'a walk', 'walks'),
    n(b.hbp, 'hit by a pitch', 'times hit by a pitch'), n(b.sb, 'a stolen base', 'stolen bases'), n(b.k, 'a strikeout', 'strikeouts')];
  return { trips, line: line.filter(Boolean).join(', ') };
}

// links: each name a link to the player's season (for a game on this device).
export function boxHtml(S, { links = false } = {}) {
  // Scored from partway through: the lines are from then on, and the runs before are only in the score.
  const j = S.joined, from = j ? `<p class="joined">Scored from the ${j.half ? 'bottom' : 'top'} of the ${ord(j.inn)}. The batting and pitching lines are from then on; the ${j.r[0] + j.r[1] === 1 ? 'run' : 'runs'} before (${esc(teamName(S.g, 0))} ${j.r[0]}, ${esc(teamName(S.g, 1))} ${j.r[1]}) count in the score.</p>` : '';
  return `${from}<div class="box-grid">${[0, 1].map(side => `
    <div>${batting(S, side, links)}${pitching(S, side, links)}
      <div class="extras">${notes(S, side)}</div>
      ${spray(S, c => c.side === side, `Where the ${teamName(S.g, side)} hit it`)}
    </div>`).join('')}
  </div>${clockLine(S)}`;
}

// ---------- spray charts ----------
// Where the balls went, once the game says where its hits went (saysWhere(), in engine.js): each ball in play whose
// fielder is known (located()), a hit by where it went and anything else by who fielded it first (6-3 at short).

// The play in a few words, for the chart's dots: "Ruiz, 3rd: single to left", "Okafor, 1st: ground out, 6-3". who:
// what goes before the inning, the batter's name unless it's said.
export function ballWords(c, who) {
  const R = RESULTS[c.r], what = R.label.toLowerCase();
  return `${who}, ${ord(c.inn)}: ${R.kind === 'hit' ? `${what} to ${toWhere(c.f[0])}` : `${what}, ${c.mark}`}`;
}
// A box's ball, as a spray chart draws it, with the words for its dot. now: the box to pick out.
export const ball = (c, title, now = false) => ({ n: c.f[0], hit: RESULTS[c.r].kind === 'hit', hr: c.r === 'HR', title, now });
// A spray chart of the boxes that pass which (a team's, or a batter's), with its title, a key, and its hits in words.
// now: the box to pick out. '' when the game doesn't say where hits went, or none of these balls is placed.
export function spray(S, which, title, { now = null } = {}) {
  if (!saysWhere(S)) return '';
  return sprayFigure(S.cells.filter(c => which(c) && located(c)).map(c => ball(c, ballWords(c, label(player(S.g, c.side, c.slot, c.p), c.slot)), c === now)), title);
}
// The chart itself, from its balls (see ball()). '' for none.
export function sprayFigure(balls, title) {
  if (!balls.length) return '';
  const hits = new Map();
  for (const b of balls) if (b.hit) hits.set(b.n, (hits.get(b.n) || 0) + 1);
  const many = (k, one, more = one + 's') => `${k} ${k === 1 ? one : more}`;
  // (In words too: where the hits went, field by field, and how many balls weren't hits.)
  const others = balls.filter(b => !b.hit).length;
  const words = [hits.size ? `Hits: ${[...hits].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([n, k]) => `${k} to ${toWhere(n)}`).join(', ')}.` : 'No hits placed.',
    others ? `${many(others, 'other ball')} in play.` : ''].filter(Boolean).join(' ');
  const key = `<span class="key"><svg viewBox="-8 -8 16 16" aria-hidden="true"><circle class="dot hit" r="6"/></svg>Hit</span><span class="key"><svg viewBox="-8 -8 16 16" aria-hidden="true"><circle class="dot" r="6"/></svg>Out, error or fielder’s choice</span>`;
  return `<figure class="spray"><figcaption>${esc(title)}</figcaption>${sprayField(balls, `${title}. ${words}`)}<p class="spray-key">${key}</p><p class="spray-words">${esc(words)}</p></figure>`;
}
// When the game started and how long it took, as a box score ends: "First pitch 7:10 pm · Time 2:31 · Delay 0:45". The
// time of the game is from the first pitch to the last out (or to where it was ended), without the time it stopped
// for delays. A game picked up partway through has when the scoring started, and no time of its own.
function clockLine(S) {
  const c = clockOf(S);
  if (!c) return '';
  const bits = [`${S.joined ? 'Scored from' : 'First pitch'} ${clockAt(S.g, 0)}`];
  if (c.time != null && !S.joined) bits.push(`<abbr title="The time of the game, without delays">Time</abbr> ${hm(c.time)}`);
  if (c.delays >= 30) bits.push(`Delay ${hm(c.delays)}`);
  return `<p class="clock">${bits.join(' · ')}</p>`;
}

// In half-innings: newest first during a game, so the last few plays are at the top, and from the first pitch on
// once it's over. Each play is led by its mark on the card, in a column of its own (6-3, F8, a backwards K; for a
// runner's play, its first runner's: SB, WP, CS 2-6), so the shorthand is learnt beside the words. Under each at-bat,
// the count it ended on and how many pitches (each one in words in its title); under the end of each half-inning, its
// runs, hits, errors and runners left on.
export function playsHtml(S, { limit = 0 } = {}) {
  const g = S.g, groups = [];
  for (const p of S.plays) {
    let grp = groups[groups.length - 1];
    if (!grp || grp.inn !== p.inn || grp.half !== p.half) groups.push(grp = { inn: p.inn, half: p.half, list: [] });
    grp.list.push(p);
  }
  if (!groups.length) return `<p class="quiet">${g.ev.some(e => e.t === 'p') ? 'No plays yet: the first at-bat is still going.' : 'Nothing has happened yet. The first pitch is all yours.'}</p>`;
  const back = !S.over || limit, order = list => (back ? list.slice().reverse() : list);
  // Once the game is won: the play that won it, and the win, the loss and the save, after the last play (or, newest
  // first, before it).
  const won = decider(S), dec = decisionWords(S), decided = (won ? `<p class="decider">${esc(won)}</p>` : '') + (dec ? `<p class="decided">${esc(dec)}</p>` : '');
  let n = 0, h = back ? decided : '';
  for (const grp of order(groups)) {
    if (limit && n >= limit) break;
    // (With the time it started, from its first play.)
    const at = clockAt(g, S.starts[grp.inn + '.' + grp.half]);
    h += `<section class="half"><h3>${grp.half ? 'Bottom' : 'Top'} of the ${ord(grp.inn)} <span>${esc(teamName(g, grp.half))} batting${at ? ` · ${at}` : ''}</span></h3><ol>`;
    for (const p of order(grp.list)) {
      if (limit && n++ >= limit) break;
      const cell = p.kind === 'pa' && S.cells[p.cell], c = g.pitches && cell, np = c ? pitchesIn(c.seq) : 0;
      const more = c && c.seq ? `<small class="pc" title="${esc(cap(pitchWords(c.seq)))}">${c.count[0]}-${c.count[1]} · ${np} pitch${np === 1 ? '' : 'es'}</small>`
        : p.sum ? `<small>${esc(p.sum)}</small>` : '';
      const mk = cell ? markCol(cell.r, cell.mark) : p.kind === 'run' ? markCol('', p.mark) : '';
      h += `<li class="${p.kind}${p.runs ? ' scored' : ''}">${mk}<span class="pw">${esc(p.text)}${p.runs ? ` <b class="runs">+${p.runs}</b>` : ''}${more}</span></li>`;
    }
    h += '</ol></section>';
  }
  return back ? h : h + decided;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// A play's mark for its column: a backwards K, or the mark with a line break only where it has a space ("SAC" over
// "1-3", never "SAC 1-" over "3"). The words beside it say it too, so a screen reader hears the play once.
const markCol = (code, m) => `<b class="pm" aria-hidden="true">${code === 'KL' ? KL : String(m || '').split(' ').filter(Boolean).map(w => `<span>${esc(w)}</span>`).join(' ')}</b>`;
