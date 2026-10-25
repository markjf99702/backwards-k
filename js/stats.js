// Season stats: each team's games on this device (those Google Drive brought here among them) played back, and its
// players' batting and pitching added up, for a team's page and a player's (team.js). Nothing here is saved: it all
// comes from replay(), and each game is played back once, until it changes (kept by its id and when it changed).
import { replay, batKey, winner, official, decisions, teamName, restDays, ip, halfLabel, saysWhere } from './engine.js';
import { today } from './model.js';
import { fmtDate } from './ui.js';

// A team's name as it's matched: "Tigers", " tigers " and "TIGERS" are the same team. A team is its name in one
// calendar year (a season): next year's Tigers are another season of it, picked on its page.
export const teamKey = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
// A player as he's matched from game to game: by name, or by number when he has no name ('#4'). '' for neither.
export function personKey(p) {
  const n = teamKey(p && p.name), num = String((p && p.num) ?? '').trim();
  return n || (num ? '#' + num : '');
}
const year = g => String(g.date).slice(0, 4);

// A team's page, a season of it ('all' for every year), and one of its players, as an address: #/team/Tigers/2026/Emma.
// The player goes by his name, or #4.
export function teamHref(name, yr = '', who = null) {
  const bits = ['#/team', encodeURIComponent(String(name).trim())];
  if (yr || who) bits.push(yr || 'all');
  if (who) bits.push(encodeURIComponent(who.name ? who.name.trim() : '#' + String(who.num).trim()));
  return bits.join('/');
}
// The player's key from his part of the address.
export const keyFrom = s => (String(s).startsWith('#') ? '#' + String(s).slice(1).trim() : teamKey(s));

// ---------- one game ----------
const BAT = () => ({ g: 0, pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, k: 0, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0 });
const PIT = () => ({ g: 0, w: 0, l: 0, s: 0, outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, hbp: 0, wp: 0, bk: 0, np: 0, str: 0, pg: 0 });
const add = (to, from) => { for (const k in to) to[k] += from[k] || 0; return to; };

// Each game played back once, until it changes.
const kept = new Map();
// One game, played back, as season stats need it: for each team, its result, and each player who was in the game
// (in the batting order, or pitching) with his line for the day and his boxes on the card. null if it can't be.
export function gameLines(g) {
  const k = kept.get(g.id), stamp = `${g.updated}.${g.ev.length}`;
  if (k && k.stamp === stamp) return k.out;
  let S;
  try { S = replay(g); } catch { return null; }
  const d = decisions(S), says = saysWhere(S);
  const sides = [0, 1].map(side => {
    const team = g.teams[side], w = winner(S), fld = 1 - side;
    // A tie, once it's over and counts; a game going on, or called before it counted, has no result yet.
    const result = w === side ? 'W' : w === fld ? 'L' : S.over && S.R[0] === S.R[1] && !(S.ended && !S.why && !official(S)) ? 'T' : '';
    const bat = [];
    for (let slot = 0; slot < S.size[side]; slot++) {
      const list = team.lineup[slot] || [], seen = [0];
      for (const e of g.ev) if (e.t === 'sub' && e.s === side && e.slot === slot && !seen.includes(e.i)) seen.push(e.i);
      for (const i of seen) {
        const p = list[i];
        if (!p) continue;
        const cells = S.cells.filter(c => c.side === side && c.slot === slot && c.p === i);
        const line = add(BAT(), S.bat[batKey(side, slot, i)] || {});
        line.g = 1;
        line.sf = cells.filter(c => c.r === 'SF').length;
        line.sh = cells.filter(c => c.r === 'SAC').length;
        bat.push({ p, key: personKey(p), line, cells });
      }
    }
    const pit = [];
    team.pitchers.forEach((p, i) => {
      const st = S.pitching[side][i];
      if (!st) return;
      const line = add(PIT(), st);
      line.g = 1;
      // (Pitches only from games that count them: without, the count is one a batter.)
      if (!g.pitches) { line.np = 0; line.str = 0; } else line.pg = 1;
      if (d && d.win === side) { line.w = +(i === d.w); line.s = +(i === d.s); } else if (d) line.l = +(i === d.l);
      pit.push({ p, key: personKey(p), line, rest: g.pitches ? restDays(g.limit, st.np) : null, np: st.np });
    });
    return { name: team.name, key: teamKey(team.name), opp: teamName(g, fld), home: side === 1, R: S.R[side], RA: S.R[fld], result, bat, pit };
  });
  // (Whether the game says where its hits went, for a season's spray chart: see saysWhere().)
  const out = { id: g.id, date: g.date, year: year(g), place: g.place, over: S.over, status: halfLabel(S), pitches: g.pitches, spray: says, sides };
  kept.set(g.id, { stamp, out });
  return out;
}

// ---------- the teams ----------
// Every team in the games here with a name, for the home screen, without playing a game back: its name as it was
// written most often, how many games it has in each year, and its latest game's date. Latest season first, then the
// team with the most games in it.
export function teamList(games) {
  const by = new Map();
  for (const g of games.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) for (const t of g.teams) {
    const k = teamKey(t.name);
    if (!k) continue;
    const x = by.get(k) || { key: k, spelt: new Map(), years: {}, last: '' }, as = t.name.trim().replace(/\s+/g, ' ');
    x.years[year(g)] = (x.years[year(g)] || 0) + 1;
    x.spelt.set(as, (x.spelt.get(as) || 0) + 1);
    x.last = g.date;
    by.set(k, x);
  }
  // (Its name as it was written most often, as on its page: see season().)
  const name = x => [...x.spelt].reduce((a, b) => (b[1] >= a[1] ? b : a))[0];
  const top = x => Object.keys(x.years).sort().at(-1);
  return [...by.values()].map(({ spelt, ...x }) => ({ ...x, name: name({ spelt }), year: top(x), n: x.years[top(x)] }))
    .sort((a, b) => (a.year < b.year ? 1 : a.year > b.year ? -1 : b.n - a.n || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0)));
}

// A team's season (yr: '2026', or 'all' for every year; none: its latest), from every game it played here:
// { name, key, years: every year it has games, newest first, yr, games: the game log, newest first,
//   record: { w, l, t }, bat: [player], pit: [player], tot: { bat, pit } }
// A player: { key, name, num, pos: { SS: 3 } (the positions he was put at, and how often), order (where he usually
// bats), bat: the season's line, pit: the pitching line, days: [{ game, line, cells }] and arms: [{ game, line, rest,
// ready }] game by game }. Players with no name or number are added up in one row of their own (key '').
export function season(games, name, yr) {
  const key = teamKey(name), mine = games.filter(g => g.teams.some(t => teamKey(t.name) === key));
  const years = [...new Set(mine.map(year))].sort().reverse();
  const latest = years[0] || String(new Date().getFullYear());
  if (yr !== 'all' && !years.includes(yr)) yr = latest;
  if (yr === 'all' && years.length < 2) yr = latest;
  const list = mine.filter(g => yr === 'all' || year(g) === yr).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created - b.created));
  const people = new Map(), log = [], record = { w: 0, l: 0, t: 0 };
  // A name as it was written most often (and of those, last): "Tigers", even when one game has "tigers".
  const spelt = new Map(), spell = (k, as) => { const m = spelt.get(k) || new Map(); m.set(as, (m.get(as) || 0) + 1); spelt.set(k, m); };
  const most = k => { let best = '', n = 0; for (const [as, c] of spelt.get(k) || []) if (c >= n) { best = as; n = c; } return best; };
  const who = (k, p, as) => {
    let x = people.get(k);
    if (!x) people.set(k, x = { key: k, name: '', num: '', pos: {}, slots: [], days: [], arms: [] });
    if (k) { spell('p:' + k, as); if (p.num) x.num = String(p.num).trim(); }
    return x;
  };
  for (const g of list) {
    const L = gameLines(g);
    if (!L) continue;
    for (const [side, T] of L.sides.entries()) {
      if (T.key !== key) continue;
      const game = { id: L.id, date: L.date, place: L.place, opp: T.opp, home: T.home, R: T.R, RA: T.RA, result: T.result, status: L.status, over: L.over, pitches: L.pitches, spray: L.spray };
      log.push(game);
      if (T.result === 'W') record.w++; else if (T.result === 'L') record.l++; else if (T.result === 'T') record.t++;
      g.teams[side].lineup.forEach((slot, n) => slot.forEach((p, i) => { if (i === 0 && personKey(p)) who(personKey(p), p, p.name ? p.name.trim() : '#' + p.num).slots.push(n); }));
      for (const b of T.bat) {
        const x = who(b.key, b.p, b.p.name ? b.p.name.trim() : '#' + String(b.p.num).trim());
        if (b.p.pos) x.pos[b.p.pos] = (x.pos[b.p.pos] || 0) + 1;
        const day = x.days.find(d => d.game === game);
        if (day) { add(day.line, b.line); day.line.g = 1; day.cells.push(...b.cells); } else x.days.push({ game, line: { ...b.line }, cells: b.cells.slice() });
      }
      for (const a of T.pit) {
        const x = who(a.key, a.p, a.p.name ? a.p.name.trim() : '#' + String(a.p.num).trim());
        const arm = x.arms.find(d => d.game === game);
        if (arm) { add(arm.line, a.line); arm.line.g = 1; arm.np += a.np; } else x.arms.push({ game, line: { ...a.line }, np: a.np, rest: a.rest });
      }
    }
  }
  // Someone who went by his number one day and his name another (#4, then Emma #4): one player, when only one named
  // player on the team wears that number.
  for (const [k, x] of people) {
    if (!k.startsWith('#')) continue;
    const named = [...people.values()].filter(y => y.key && !y.key.startsWith('#') && y.num === k.slice(1));
    if (named.length !== 1) continue;
    const y = named[0];
    for (const d of x.days) { const day = y.days.find(e => e.game === d.game); if (day) { add(day.line, d.line); day.line.g = 1; day.cells.push(...d.cells); } else y.days.push(d); }
    for (const a of x.arms) { const arm = y.arms.find(e => e.game === a.game); if (arm) { add(arm.line, a.line); arm.line.g = 1; arm.np += a.np; } else y.arms.push(a); }
    for (const [p, n] of Object.entries(x.pos)) y.pos[p] = (y.pos[p] || 0) + n;
    y.slots.push(...x.slots);
    people.delete(k);
  }
  // (The team's name from every year's games.)
  for (const g of mine.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) for (const t of g.teams) if (teamKey(t.name) === key) spell('team', t.name.trim().replace(/\s+/g, ' '));
  const at = d => d.game.date + d.game.id;
  const players = [...people.values()].map(x => {
    x.name = x.key ? most('p:' + x.key) : '';
    x.days.sort((a, b) => (at(a) < at(b) ? -1 : 1)); x.arms.sort((a, b) => (at(a) < at(b) ? -1 : 1));
    x.bat = x.days.reduce((t, d) => add(t, d.line), BAT());
    x.pit = x.arms.reduce((t, d) => add(t, d.line), PIT());
    // The day each pitcher can pitch again, by the rest his league's pitch limit asks for after each outing.
    for (const a of x.arms) a.ready = a.rest == null ? null : addDays(a.game.date, a.rest + 1);
    x.order = x.slots.length ? x.slots.reduce((s, n) => s + n, 0) / x.slots.length : Infinity;
    return x;
  });
  const bat = players.filter(x => x.days.length), pit = players.filter(x => x.arms.length);
  const tot = { bat: bat.reduce((t, x) => add(t, x.bat), BAT()), pit: pit.reduce((t, x) => add(t, x.pit), PIT()) };
  tot.bat.g = tot.pit.g = log.length;
  return { name: most('team') || String(name).trim(), key, years, yr, games: log.reverse(), record, bat, pit, tot };
}

// A day so many days after another ('2026-10-24' and 3: '2026-10-27').
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- the numbers worked out from a line (OBR 9.21) ----------
export const avg = b => (b.ab ? b.h / b.ab : null);
// On base: hits, walks and hit by pitch, of at-bats, walks, hit by pitch and sacrifice flies (9.21(f)).
export const obp = b => { const n = b.ab + b.bb + b.hbp + b.sf; return n ? (b.h + b.bb + b.hbp) / n : null; };
// Slugging: total bases, of at-bats (9.21(c)).
export const slg = b => (b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : null);
export const ops = b => (obp(b) == null || slg(b) == null ? null : obp(b) + slg(b));
// Earned runs for every nine innings pitched (9.21(e)).
export const era = p => (p.outs ? (27 * p.er) / p.outs : null);
export const strikes = p => (p.np ? p.str / p.np : null);
// A rate as box scores print it: .375, 1.000; ERA with two places, 2.84; strike % whole, 64%. A dash for none.
export const three = v => (v == null ? '–' : v.toFixed(3).replace(/^0(?=\.)/, ''));
export const two = v => (v == null ? '–' : v.toFixed(2));
export const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`);
export { ip };

// ---------- the season in words, and as a spreadsheet ----------
// So many of something, as said, or nothing for none: "a double", "3 doubles".
const n = (k, one, more) => (!k ? '' : k === 1 ? one : `${k} ${more}`);
// A day's or a season's batting, naming only what isn't zero: "2 for 3, a double, 2 RBI, a walk" (only: without the
// hits and at-bats).
export function batWords(b, only = false) {
  return [only ? '' : `${b.h} for ${b.ab}`, n(b.d, 'a double', 'doubles'), n(b.t, 'a triple', 'triples'), n(b.hr, 'a home run', 'home runs'), n(b.r, 'a run', 'runs'),
    n(b.rbi, 'an RBI', 'RBI'), n(b.bb, 'a walk', 'walks'), b.hbp ? `hit by a pitch ${b.hbp === 1 ? 'once' : `${b.hbp} times`}` : '', n(b.sb, 'a stolen base', 'stolen bases'),
    n(b.k, 'a strikeout', 'strikeouts')].filter(Boolean).join(', ');
}
// A pitching line in words: "12.1 innings, 2-1, 18 strikeouts, 5 walks, a 2.84 ERA".
export function pitchWords(p) {
  const rec = p.w || p.l ? `${p.w}-${p.l}` : '', sv = n(p.s, 'a save', 'saves');
  return [`${ip(p.outs)} inning${p.outs === 3 ? '' : 's'}`, rec, sv, `${p.k} strikeout${p.k === 1 ? '' : 's'}`, `${p.bb} walk${p.bb === 1 ? '' : 's'}`,
    era(p) == null ? '' : `a ${two(era(p))} ERA`, p.np ? `${p.np} pitches` : ''].filter(Boolean).join(', ');
}
const vs = game => `${game.home ? 'vs' : 'at'} ${game.opp}`;
const nGames = n => `${n} game${n === 1 ? '' : 's'}`;
// A player's season as text, for a group chat or the grandparents:
//   Emma Park #4, Tigers, 2026
//   Batting: .375 (15 for 40) in 12 games, with 3 doubles, a home run, 8 runs, 9 RBI. On base .460, slugging .550.
//   Pitching: 4 games, 12.1 innings, 2-1, 18 strikeouts, 5 walks, a 2.84 ERA.
//   Last game, Sat, Oct 24 at Bears: 2 for 3, a double, 2 RBI.
export function seasonText(T, x) {
  const head = `${x.name}${x.num && !x.key.startsWith('#') ? ' #' + x.num : ''}, ${T.name}, ${T.yr === 'all' ? `${T.years.at(-1)}–${T.years[0]}` : T.yr}`;
  const b = x.bat, p = x.pit, last = x.days.at(-1);
  return [
    head,
    x.days.length ? `Batting: ${three(avg(b))} (${b.h} for ${b.ab}) in ${nGames(b.g)}${batWords(b, true) ? `, with ${batWords(b, true)}` : ''}. On base ${three(obp(b))}, slugging ${three(slg(b))}.` : '',
    x.arms.length ? `Pitching: ${nGames(p.g)}, ${pitchWords(p)}.` : '',
    last ? `Last game, ${fmtDate(last.game.date)} ${vs(last.game)}: ${batWords(last.line)}.` : '',
  ].filter(Boolean).join('\n');
}
// A spreadsheet's cell: in quotes when it has a comma, a quote or a line break, and never read as a formula.
const cell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = rows => '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
export const BAT_COLS = ['G', 'PA', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'K', 'HBP', 'SB', 'CS', 'SF', 'SH', 'AVG', 'OBP', 'SLG', 'OPS'];
const batRow = b => [b.g, b.pa, b.ab, b.r, b.h, b.d, b.t, b.hr, b.rbi, b.bb, b.k, b.hbp, b.sb, b.cs, b.sf, b.sh, three(avg(b)), three(obp(b)), three(slg(b)), three(ops(b))];
export const PIT_COLS = ['G', 'W', 'L', 'S', 'IP', 'BF', 'H', 'R', 'ER', 'ERA', 'BB', 'K', 'HR', 'HBP', 'WP', 'BK', 'Pitches', 'Strikes', 'Strike %'];
const pitRow = p => [p.g, p.w, p.l, p.s, ip(p.outs), p.bf, p.h, p.r, p.er, two(era(p)), p.bb, p.k, p.hr, p.hbp, p.wp, p.bk, p.pg ? p.np : '', p.pg ? p.str : '', pct(strikes(p))];
const seasonName = T => `${T.name}, ${T.yr === 'all' ? 'every season' : `${T.yr} season`}`;
const resultOf = game => (game.result ? `${game.result} ${game.R}-${game.RA}` : `${game.status} ${game.R}-${game.RA}`);
// A team's season as a spreadsheet (CSV): its batting, its pitching and its games.
export function teamCsv(T) {
  const nm = x => x.name || 'No name';
  return csv([
    [seasonName(T)], [],
    ['Batting'], ['Player', 'No.', 'Pos', ...BAT_COLS],
    ...T.bat.map(x => [nm(x), x.key.startsWith('#') ? '' : x.num, posList(x), ...batRow(x.bat)]), ['Totals', '', '', ...batRow(T.tot.bat)], [],
    ['Pitching'], ['Player', 'No.', ...PIT_COLS],
    ...T.pit.map(x => [nm(x), x.key.startsWith('#') ? '' : x.num, ...pitRow(x.pit)]), ['Totals', '', ...pitRow(T.tot.pit)], [],
    ['Games'], ['Date', 'Opponent', 'Where', 'Result'],
    ...T.games.slice().reverse().map(game => [game.date, game.opp, game.home ? 'Home' : 'Away', resultOf(game)]),
  ]);
}
// One player's season as a spreadsheet: game by game, batting and then pitching.
export function playerCsv(T, x) {
  return csv([
    [`${x.name}${x.num && !x.key.startsWith('#') ? ' #' + x.num : ''}, ${seasonName(T)}`], [],
    ...(x.days.length ? [['Batting'], ['Date', 'Opponent', 'Result', ...BAT_COLS.slice(1), 'Plays'],
      ...x.days.map(d => [d.game.date, vs(d.game), resultOf(d.game), ...batRow(d.line).slice(1), d.cells.map(c => c.mark).join(' ')]),
      ['Season', '', '', ...batRow(x.bat).slice(1)], []] : []),
    ...(x.arms.length ? [['Pitching'], ['Date', 'Opponent', 'Result', ...PIT_COLS.slice(1), 'Days of rest'],
      ...x.arms.map(a => [a.game.date, vs(a.game), resultOf(a.game), ...pitRow(a.line).slice(1), a.rest ?? '']),
      ['Season', '', '', ...pitRow(x.pit).slice(1)]] : []),
  ]);
}
// The positions a player was put at, the most often first: "SS, P".
export const posList = x => Object.entries(x.pos).sort((a, b) => b[1] - a[1]).map(([p]) => p).join(', ');

// ---------- pitching this week ----------
// Each pitcher who pitched in the last 7 days (from today), with his outings and, under a pitch limit by league age,
// the day he can pitch again: [{ x, arms, ready }], ready null with no rest table.
export function thisWeek(T, now = today()) {
  const from = addDays(now, -6);
  return T.pit.map(x => {
    const arms = x.arms.filter(a => a.game.date >= from && a.game.date <= now);
    const rules = arms.filter(a => a.ready);
    return { x, arms, ready: rules.length ? rules.map(a => a.ready).sort().at(-1) : null };
  }).filter(w => w.arms.length);
}

// ---------- players from earlier games, for the substitution sheets ----------
// The team's players from its other games this season (g's year) who aren't in g: the most games first, then the
// latest. pitchers: those who pitched for it, for New pitcher. Read from the games as saved, without playing them back.
export function earlier(games, g, side, { pitchers = false, max = 12 } = {}) {
  const key = teamKey(g.teams[side].name), yr = year(g);
  if (!key) return [];
  const here = new Set([...g.teams[side].lineup.flat(), ...g.teams[side].pitchers].map(personKey).filter(Boolean));
  const seen = new Map();
  for (const o of games.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.updated - a.updated))) {
    if (o.id === g.id || year(o) !== yr) continue;
    for (const t of o.teams) {
      if (teamKey(t.name) !== key) continue;
      for (const p of pitchers ? t.pitchers : t.lineup.flat()) {
        const k = personKey(p);
        if (!k || here.has(k)) continue;
        const x = seen.get(k) || { p: { name: '', num: String(p.num ?? '').trim() }, n: 0, spelt: new Map() }, as = String(p.name ?? '').trim();
        x.n++;
        x.spelt.set(as, (x.spelt.get(as) || 0) + 1);
        // (His name as it was written most often.)
        x.p.name = [...x.spelt].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
        seen.set(k, x);
      }
    }
  }
  // (Someone who went by his number in one game, and by his name and that number in another, is one player.)
  const worn = new Set();
  for (const [k, x] of seen) if (!k.startsWith('#') && x.p.num) worn.add(x.p.num);
  for (const p of [...g.teams[side].lineup.flat(), ...g.teams[side].pitchers]) if (p.name && String(p.num ?? '').trim()) worn.add(String(p.num).trim());
  return [...seen].filter(([k]) => !k.startsWith('#') || !worn.has(k.slice(1))).map(([, x]) => x)
    .sort((a, b) => b.n - a.n).slice(0, max).map(x => x.p);
}
