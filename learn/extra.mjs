// Extra public data for the model, fetched by the nightly trainer and cached in data/extra/.
//   NFL     expected points added (EPA) per play for each team in each game — nflverse (github.com/nflverse)
//   NHL     expected goals from the location of every unblocked shot — the NHL's own play-by-play (api-web.nhle.com)
//   Soccer  expected goals (xG) per match where published — football-data.co.uk
// Each loader returns { espnGameId: [home value, away value] }. A source that can't be reached is skipped.
import fs from 'node:fs/promises';
const DIR = new URL('../data/extra/', import.meta.url);
const read = async (n, d) => { try { return JSON.parse(await fs.readFile(new URL(n, DIR), 'utf8')); } catch { return d; } };
const write = async (n, v) => { await fs.mkdir(DIR, { recursive: true }); await fs.writeFile(new URL(n, DIR), JSON.stringify(v)); };
const text = async u => { try { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (sideline model trainer)' } }); return r.ok ? await r.text() : null; } catch { return null; } };
const json = async u => { const t = await text(u); try { return t ? JSON.parse(t) : null; } catch { return null; } };
function csv(t) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const r3 = v => +(+v).toFixed(3);

/* ---------- NFL: EPA per play ---------- */
async function nfl(store, log) {
  const out = await read('nfl-epa.json', {});
  const seasons = [...new Set(Object.values(store.games).map(g => g.season).filter(Boolean))];
  const missing = Object.entries(store.games).some(([id, g]) => g.done && !out[id] && Date.now() - new Date(g.date) > 36 * 3600e3 && Date.now() - new Date(g.date) < 21 * 864e5);
  if (Object.keys(out).length && !missing) return out;
  const games = await text('https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv');
  if (!games) { log('nfl: nflverse not reachable, keeping what is cached'); return out; }
  const G = {}; csv(games).forEach(g => { if (g.espn) G[g.game_id] = g; });
  let n = 0;
  for (const s of seasons) {
    const t = await text(`https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${s}.csv`); if (!t) continue;
    const by = {}; csv(t).forEach(r => { (by[r.game_id] ||= {})[r.team] = r; });
    Object.entries(by).forEach(([gid, teams]) => {
      const g = G[gid]; if (!g) return;
      const v = ab => { const r = teams[ab]; if (!r) return null; const plays = (+r.attempts || 0) + (+r.sacks_suffered || 0) + (+r.carries || 0); return plays > 20 ? ((+r.passing_epa || 0) + (+r.rushing_epa || 0)) / plays : null; };
      const h = v(g.home_team), a = v(g.away_team);
      if (h != null && a != null) { out[String(g.espn)] = [r3(h), r3(a)]; n++; }
    });
  }
  await write('nfl-epa.json', out);
  log(`nfl: EPA per play for ${Object.keys(out).length} games (nflverse)`);
  return out;
}

/* ---------- NHL: expected goals from shot locations ---------- */
const NB = 12;
async function nhl(store, log, cap = 2600) {
  const S = await read('nhl-shots.json', { games: {}, miss: {} });
  const want = Object.entries(store.games).filter(([id, g]) => g.done && (g.type === 2 || g.type === 3) && !S.games[id] && (S.miss[id] || 0) < 3 && Date.now() - new Date(g.date) > 12 * 3600e3)
    .sort((x, y) => new Date(y[1].date) - new Date(x[1].date)).slice(0, cap);
  if (want.length) {
    // the league's schedule, a week at a time, to find each game's NHL id by start time and final score
    const weeks = new Set(want.map(([, g]) => { const d = new Date(g.date); d.setUTCDate(d.getUTCDate() - 1); const k = Math.floor(d.getTime() / (7 * 864e5)); return k; }));
    const sched = [];
    const wk = [...weeks]; let wi = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { while (wi < wk.length) { const k = wk[wi++]; for (const off of [0, 6]) { const d = new Date(k * 7 * 864e5 + off * 864e5).toISOString().slice(0, 10); const j = await json(`https://api-web.nhle.com/v1/schedule/${d}`); (j?.gameWeek || []).forEach(day => (day.games || []).forEach(x => sched.push(x))); } } }));
    const seen = new Set(), list = sched.filter(x => !seen.has(x.id) && seen.add(x.id));
    let i = 0, got = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (i < want.length) {
        const [id, g] = want[i++], t = new Date(g.date).getTime();
        const m = list.filter(x => Math.abs(new Date(x.startTimeUTC).getTime() - t) < 4 * 3600e3 && x.homeTeam?.score === g.hs && x.awayTeam?.score === g.as);
        if (m.length !== 1) { S.miss[id] = (S.miss[id] || 0) + 1; continue; }
        const p = await json(`https://api-web.nhle.com/v1/gamecenter/${m[0].id}/play-by-play`);
        if (!p?.plays?.length) { S.miss[id] = (S.miss[id] || 0) + 1; continue; }
        const hb = Array(NB).fill(0), ab = Array(NB).fill(0), hg = Array(NB).fill(0), ag = Array(NB).fill(0), home = p.homeTeam?.id;
        p.plays.forEach(e => {
          if (!/^(shot-on-goal|goal|missed-shot)$/.test(e.typeDescKey) || e.periodDescriptor?.periodType === 'SO') return;
          const d = e.details || {}; if (d.xCoord == null) return;
          const b = d.zoneCode === 'O' ? Math.min(NB - 2, Math.floor(Math.hypot(89 - Math.abs(d.xCoord), d.yCoord || 0) / 6)) : NB - 1;
          const isHome = d.eventOwnerTeamId === home; (isHome ? hb : ab)[b]++; if (e.typeDescKey === 'goal') (isHome ? hg : ag)[b]++;
        });
        S.games[id] = [hb, ab, hg, ag]; got++;
      }
    }));
    await write('nhl-shots.json', S);
    log(`nhl: shot locations for ${Object.keys(S.games).length} games (+${got} this run)`);
  }
  // goal rate by distance, from every stored game; a game's expected goals = its shots × those rates
  const att = Array(NB).fill(0), gl = Array(NB).fill(0);
  Object.values(S.games).forEach(([hb, ab, hg, ag]) => { for (let b = 0; b < NB; b++) { att[b] += hb[b] + ab[b]; gl[b] += hg[b] + ag[b]; } });
  const rate = att.map((n, b) => (gl[b] + 2) / (n + 40)), out = {};
  Object.entries(S.games).forEach(([id, [hb, ab]]) => { out[id] = [r3(hb.reduce((s, n, b) => s + n * rate[b], 0)), r3(ab.reduce((s, n, b) => s + n * rate[b], 0))]; });
  return out;
}

/* ---------- soccer: expected goals where football-data publishes them ---------- */
const FD = { 'eng.1': 'E0', 'esp.1': 'SP1', 'ger.1': 'D1', 'ita.1': 'I1', 'fra.1': 'F1' };
async function soccer(lg, store, log) {
  const code = FD[lg]; if (!code) return {};
  const cache = await read(`${lg}-xg.json`, { at: 0, map: {} });
  if (Date.now() - cache.at < 20 * 3600e3) return cache.map;
  const yr = new Date().getUTCFullYear() % 100, rows = [];
  for (const y of [yr - 1, yr]) { const t = await text(`https://www.football-data.co.uk/mmz4281/${y}${y + 1}/${code}.csv`); if (t) csv(t).forEach(r => { if (r.HxG && r.AxG && r.Date) rows.push(r); }); }
  if (!rows.length) return cache.map;
  const dayOf = s => { const [d, m, y] = s.split('/'); return Date.UTC(+(y.length === 2 ? '20' + y : y), +m - 1, +d) / 864e5; };
  rows.forEach(r => { r._d = dayOf(r.Date); });
  const games = Object.entries(store.games).filter(([, g]) => g.done && g.hs != null).map(([id, g]) => ({ id, ...g, _d: Math.floor(new Date(g.date).getTime() / 864e5) }));
  const cand = g => rows.filter(r => Math.abs(r._d - g._d) <= 1 && +r.FTHG === g.hs && +r.FTAG === g.as);
  // learn which football-data name is which ESPN team from matches that line up one-to-one
  const votes = {}; games.forEach(g => { const c = cand(g); if (c.length !== 1) return; [[g.h, c[0].HomeTeam], [g.a, c[0].AwayTeam]].forEach(([id, nm]) => { ((votes[id] ||= {})[nm] = (votes[id][nm] || 0) + 1); }); });
  const name = {}; Object.entries(votes).forEach(([id, v]) => { name[id] = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]; });
  const map = {}; games.forEach(g => { const r = rows.find(r => Math.abs(r._d - g._d) <= 1 && r.HomeTeam === name[g.h] && r.AwayTeam === name[g.a]); if (r) map[g.id] = [+r.HxG, +r.AxG]; });
  await write(`${lg}-xg.json`, { at: Date.now(), map });
  log(`${lg}: expected goals for ${Object.keys(map).length} matches (football-data.co.uk)`);
  return map;
}

export async function loadExtra(sp, S, store, log) {
  try { return sp === 'nfl' ? await nfl(store, log) : sp === 'nhl' ? await nhl(store, log) : S.draws ? await soccer(sp, store, log) : {}; }
  catch (e) { log(`${sp}: extra data skipped — ${e.message}`); return {}; }
}
/* hourly snapshots of what was known before each game (injury report, announced starters), written by learn/ledger.mjs */
export async function loadSnaps(sp) { return read(`snap-${sp}.json`, {}); }
export async function saveSnaps(sp, snaps) { const cut = Date.now() - 500 * 864e5; Object.keys(snaps).forEach(k => { if (new Date(snaps[k].d).getTime() < cut) delete snaps[k]; }); await write(`snap-${sp}.json`, snaps); }
