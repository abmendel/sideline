// Sideline analytics: spread and total records (against the closing DraftKings line) and player impact rankings.
// Built by the nightly trainer from the stored box scores, lines and walk-forward model; read by the Analytics tab.
import { createRequire } from 'node:module';
const SM = createRequire(import.meta.url)('./predict.js');

const SITE = p => `https://site.api.espn.com/apis/site/v2/sports/${p}`;
const r1 = v => v == null || !isFinite(v) ? null : +(+v).toFixed(1);
const r3 = v => v == null || !isFinite(v) ? null : +(+v).toFixed(3);
const pct = (w, n) => n ? r3(w / n) : null;
const day = iso => Math.floor(new Date(iso).getTime() / 864e5);

/* ---------- teams and current rosters (names, logos, who plays where) ---------- */
async function teamsOf(path, fetchJSON) {
  const d = await fetchJSON(`${SITE(path)}/teams?limit=200`).catch(() => null), out = {};
  (d?.sports?.[0]?.leagues?.[0]?.teams || []).forEach(({ team: t }) => { out[String(t.id)] = { abbr: t.abbreviation || '', name: t.shortDisplayName || t.displayName || '', logo: t.logos?.[0]?.href || '' }; });
  return out;
}
async function rostersOf(path, teamIds, fetchJSON) {
  const out = {};
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < teamIds.length) {
      const tid = teamIds[i++], d = await fetchJSON(`${SITE(path)}/teams/${tid}/roster`).catch(() => null);
      const list = [];
      (d?.athletes || []).forEach(a => { if (a.items) a.items.forEach(x => list.push(x)); else list.push(a); });
      list.forEach(a => { if (a.id) out[String(a.id)] = { name: a.displayName || a.fullName || '', pos: a.position?.abbreviation || '', team: tid }; });
    }
  }));
  return out;
}

/* ---------- spreads and totals ---------- */
function linedGames(games, box, kind) {
  return Object.entries(games).map(([id, g]) => ({ id, ...g, L: box[id]?.L }))
    .filter(g => g.done && g.hs != null && g.as != null && g.L && (kind === 'soccer' || g.type === 2 || g.type === 3))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}
const rec = () => ({ w: 0, l: 0, p: 0 });
const add = (r, x) => { if (x === 'W') r.w++; else if (x === 'L') r.l++; else r.p++; };
const flip = x => x === 'W' ? 'L' : x === 'L' ? 'W' : 'P';
const out3 = r => [r.w, r.l, r.p];

function spreadSeason(list, allGames, wfBy, kind, thr) {
  const priced = kind === 'mlb' || kind === 'nhl';      // ±1.5 run/puck lines carry their own prices, so a cover rate isn't a profit rate
  // previous game day per team, for back-to-backs
  const prevDay = {};
  const order = Object.entries(allGames).map(([id, g]) => ({ id, ...g })).filter(g => g.h && g.a).sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = {};
  order.forEach(g => { [g.h, g.a].forEach(t => { prevDay[g.id + ':' + t] = last[t] ?? null; last[t] = day(g.date); }); });
  const T = {}, team = id => T[id] || (T[id] = { id, ats: rec(), home: rec(), away: rec(), fav: rec(), dog: rec(), b2b: rec(), ou: { o: 0, u: 0, p: 0 }, cover: 0, n: 0, totDiff: 0, tn: 0, seq: [] });
  const L = { n: 0, homeCov: 0, favCov: 0, favN: 0, over: 0, totN: 0, push: 0, move: { n: 0, w: 0 }, model: rec(), strong: rec(), margin: 0 };
  list.forEach(g => {
    const s = g.L[1], T0 = g.L[3], hm = g.hs - g.as;
    if (s != null) {
      const cov = hm + s, res = cov > 0 ? 'W' : cov < 0 ? 'L' : 'P';
      L.n++; if (res === 'W') L.homeCov++; if (res === 'P') L.push++; L.margin += Math.abs(cov);
      if (s !== 0) { L.favN++; if ((s < 0 && res === 'W') || (s > 0 && res === 'L')) L.favCov++; }
      if (g.L[0] != null && Math.abs(g.L[0] - s) >= (kind === 'nba' || kind === 'nfl' ? 1 : .5) && res !== 'P') {   // the line moved toward a side: did that side cover?
        L.move.n++; const towardHome = s < g.L[0]; if ((towardHome && res === 'W') || (!towardHome && res === 'L')) L.move.w++;
      }
      const w = wfBy[g.id], mm = w ? (w.m ?? (w.lh != null ? w.lh - w.la : null)) : null;
      if (!priced && mm != null && res !== 'P') {
        const edge = mm + s, pick = edge > 0 ? 'W' : 'L', r = pick === res ? 'W' : 'L';
        add(L.model, r); if (Math.abs(edge) >= thr) add(L.strong, r);
      }
      [[g.h, res, true], [g.a, flip(res), false]].forEach(([id, r, home]) => {
        const t = team(id), line = home ? s : -s;
        add(t.ats, r); add(home ? t.home : t.away, r); if (line < 0) add(t.fav, r); else if (line > 0) add(t.dog, r);
        const pd = prevDay[g.id + ':' + id]; if (pd != null && day(g.date) - pd <= 1) add(t.b2b, r);
        t.cover += home ? cov : -cov; t.n++; t.seq.push(r);
      });
    }
    if (T0 != null) {
      const tot = g.hs + g.as, ou = tot > T0 ? 'o' : tot < T0 ? 'u' : 'p';
      L.totN++; if (ou === 'o') L.over++;
      [g.h, g.a].forEach(id => { const t = team(id); t.ou[ou]++; t.totDiff += tot - T0; t.tn++; });
    }
  });
  const teams = Object.values(T).filter(t => t.n + t.tn >= 4).map(t => ({
    id: t.id, ats: out3(t.ats), home: out3(t.home), away: out3(t.away), fav: out3(t.fav), dog: out3(t.dog), b2b: out3(t.b2b),
    last10: (() => { const r = rec(); t.seq.slice(-10).forEach(x => add(r, x)); return out3(r); })(), streak: (() => { const q = t.seq.filter(x => x !== 'P'); if (!q.length) return ''; const k = q[q.length - 1]; let n = 0; for (let i = q.length - 1; i >= 0 && q[i] === k; i--) n++; return `${k}${n}`; })(),
    cover: r1(t.n ? t.cover / t.n : null), ou: [t.ou.o, t.ou.u, t.ou.p], totDiff: r1(t.tn ? t.totDiff / t.tn : null)
  }));
  const decided = L.n - L.push;
  return { teams, league: { priced, games: L.n, homeCover: pct(L.homeCov, decided), favCover: pct(L.favCov, L.favN), over: pct(L.over, L.totN), totals: L.totN, push: L.push, avgMiss: r1(L.n ? L.margin / L.n : null),
    lineMove: L.move.n ? { n: L.move.n, pct: pct(L.move.w, L.move.n) } : null,
    model: L.model.w + L.model.l ? { w: L.model.w, l: L.model.l, pct: pct(L.model.w, L.model.w + L.model.l) } : null,
    strong: L.strong.w + L.strong.l ? { w: L.strong.w, l: L.strong.l, pct: pct(L.strong.w, L.strong.w + L.strong.l), thr } : null } };
}
function spreadsBySeason(games, box, wf, kind) {
  const list = linedGames(games, box, kind), wfBy = {};
  (wf || []).forEach(w => { wfBy[w.id] = w; });
  const thr = { nba: 3, nfl: 3 }[kind] ?? .5;
  const seasons = [...new Set(list.map(g => g.season))].filter(s => s != null).sort((a, b) => b - a);
  return seasons.map(s => ({ season: s, ...spreadSeason(list.filter(g => g.season === s), games, wfBy, kind, thr) })).filter(x => x.league.games + x.league.totals >= 20).slice(0, 2);
}

/* ---------- player impact ---------- */
function impactUS(sp, M, roster) {
  const w = f => { const i = (M.features || []).indexOf(f); return i < 0 ? 0 : M.w[i] || 0; };
  const sig = M.sigma || 1, swing = v => r3(SM.Phi(v / sig) - .5), rows = [];
  if (sp === 'nba') {
    const P = M.tables?.players || {}, wa = w('avail');
    Object.entries(roster).forEach(([id, a]) => {
      if (!P[id]) return;
      const cur = M.teams[a.team]?.rot?.[id], any = Math.max(0, ...Object.values(M.teams).map(t => t.rot?.[id] || 0));
      const min = cur ?? any * .8; if (min < 10) return;
      const r = SM.nbaRating(P, id), v = Math.max(0, r - SM.NBA_REPL) * min / 36 * wa;
      rows.push({ id, name: a.name, team: a.team, pos: a.pos, impact: r1(v), win: swing(v), a: r1(r), b: r1(min) });
    });
    return { unit: 'pts', what: 'Points of margin he adds per game over a replacement player', a: 'Game score / 36 min', b: 'Usual minutes', rows };
  }
  if (sp === 'nhl') {
    const G = M.tables?.goalies || {}, wg = w('goalie');
    Object.entries(roster).forEach(([id, a]) => {
      const g = G[id]; if (!g || g[0] < 300 || !/^G/.test(a.pos)) return;
      const q = SM.goalieQ(M, id);
      rows.push({ id, name: a.name, team: a.team, pos: 'G', impact: r3(q), win: swing(q), a: r3(1 - g[1] / g[0]), b: Math.round(g[0]) });
    });
    return { unit: 'goals', what: 'Goals saved per game compared with an average goalie (shrunk toward average until he has faced plenty of shots)', a: 'Save %', b: 'Shots faced (recent, weighted)', rows };
  }
  if (sp === 'mlb') {
    const R = M.tables?.pitchers || {}, ws = w('sp'), lg = M.tables?.lgFip || 4.2, c = M.tables?.cFip || 3.1;
    Object.entries(roster).forEach(([id, a]) => {
      const p = R[id]; if (!p || p[0] < 60) return;
      const v = SM.spValue(M, id), ip = p[0] / 3, fip = (13 * p[4] + 3 * p[2] - 2 * p[3]) / ip + c;
      rows.push({ id, name: a.name, team: a.team, pos: a.pos || 'SP', impact: r3(v), win: swing(v * ws), a: r1(fip), b: r1(ip) });
    });
    return { unit: 'runs', what: 'Runs saved per start compared with a league-average starter (fielding-independent pitching, shrunk until he has thrown enough innings)', a: 'FIP', b: 'Innings (recent, weighted)', rows };
  }
  if (sp === 'nfl') {
    const Q = M.tables?.qbs || {}, wq = w('qb'), lg = M.tables?.lgAny || 6;
    Object.entries(roster).forEach(([id, a]) => {
      const q = Q[id]; if (!q || q[0] < 50 || !/QB/.test(a.pos)) return;
      const v = SM.qbValue(M, id);
      rows.push({ id, name: a.name, team: a.team, pos: 'QB', impact: r1(v * wq), win: swing(v * wq), a: r1(q[1] / q[0]), b: Math.round(q[0]) });
    });
    return { unit: 'pts', what: 'Points per game he is worth compared with an average quarterback, from adjusted net yards per attempt', a: 'ANY/A', b: 'Dropbacks (recent, weighted)', rows };
  }
  return null;
}
// soccer: how a team does against expectation with him in the starting XI versus without him
function impactSoccer(wf, box, names, teamsMeta) {
  const by = {}; (wf || []).forEach(w => { by[w.id] = w; });
  const P = {};                       // player -> { team, with: [], dates }
  const teamMatches = {};             // team -> [{ id, d, res, xi }]
  Object.entries(box).forEach(([id, b]) => {
    const w = by[id]; if (!w || !b.x || w.lh == null) return;
    const gd = w.hs - w.as - (w.lh - w.la);
    [[w.h, gd], [w.a, -gd]].forEach(([t, r]) => { const xi = b.x[t]; if (!xi) return; (teamMatches[t] ||= []).push({ d: w.date, r, xi: new Set(xi) }); });
  });
  Object.entries(teamMatches).forEach(([t, list]) => {
    list.sort((a, b) => new Date(a.d) - new Date(b.d));
    const seen = {};
    list.forEach((m, i) => m.xi.forEach(p => { (seen[p] ||= { first: i, last: i, n: 0 }); seen[p].last = i; seen[p].n++; }));
    Object.entries(seen).forEach(([p, s]) => {
      if (s.n < 10) return;
      let ws = 0, wn = 0, os = 0, on = 0;
      for (let i = s.first; i <= Math.min(list.length - 1, s.last + 3); i++) { const m = list[i]; if (m.xi.has(p)) { ws += m.r; wn++; } else { os += m.r; on++; } }
      if (on < 5) return;
      const v = ws / (wn + 10) - os / (on + 10);
      const cur = P[p];
      if (!cur || s.last >= cur.lastIdx) P[p] = { team: t, v, wn, on, lastIdx: s.last, lastDate: list[s.last].d };
    });
  });
  const rows = Object.entries(P).filter(([, x]) => Date.now() - new Date(x.lastDate) < 400 * 864e5).map(([id, x]) => ({ id, name: names[id]?.[0] || '', team: x.team, pos: names[id]?.[1] || '', impact: r3(x.v), win: null, a: x.wn, b: x.on }));
  return { unit: 'goals', what: 'Goal difference per match against expectation with him in the starting XI, minus without him (shrunk toward zero; expectation from our goal model, so opponent strength is accounted for)', a: 'Starts', b: 'Matches without', rows: rows.filter(r => r.name) };
}

export async function buildAnalytics(sp, S, store, box, model, wf, fetchJSON, extra = {}) {
  const kind = S.draws ? 'soccer' : sp;
  const teams = await teamsOf(S.path, fetchJSON);
  const spreads = spreadsBySeason(store.games, box, wf, kind);
  let players = null;
  if (kind === 'soccer') players = impactSoccer(wf, box, extra.names || {}, teams);
  else {
    const roster = await rostersOf(S.path, Object.keys(teams), fetchJSON);
    players = impactUS(sp, model, roster);
  }
  if (players) {
    players.rows = players.rows.filter(r => teams[r.team]).sort((a, b) => (b.impact ?? -99) - (a.impact ?? -99)).slice(0, 150);
    players.rows.forEach((r, i) => { r.rank = i + 1; });
  }
  return { sport: sp, updated: new Date().toISOString(), teams, spreads, players };
}
