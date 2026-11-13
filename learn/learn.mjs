// Sideline learning model — trains on every completed game and writes data/model-<sport>.json.
// Runs on GitHub Actions (see .github/workflows/learn.yml). Node 20+, no dependencies.
//   node learn/learn.mjs            all sports
//   node learn/learn.mjs nba nhl    some sports
//
// Each run: fetch any game days not yet stored (two seasons back on the first run), refresh the last
// few days and today's slate, snapshot pre-game odds, rebuild Elo ratings, refit the margin model,
// grade it walk-forward (every game predicted using only earlier games) and fit how much to trust
// the model versus the betting market once enough snapshots have results.
import fs from 'node:fs/promises';

const SPORTS = {
  nba: { path: 'basketball/nba', mode: 'day', K: 20, hfa: 100, carry: .25, rest: true, sd: 12, lambda: 8 },
  nfl: { path: 'football/nfl', mode: 'week', K: 20, hfa: 55, carry: .33, rest: true, sd: 13.5, lambda: 8 },
  mlb: { path: 'baseball/mlb', mode: 'day', K: 4, hfa: 24, carry: .33, rest: false, sd: 4.2, lambda: 20 },
  nhl: { path: 'hockey/nhl', mode: 'day', K: 8, hfa: 35, carry: .3, rest: true, sd: 2.35, lambda: 20 }
};
/* Soccer: one model per league, three outcomes (home win, draw, away win) */
const SOCCER = { draws: true, anyType: true, mode: 'day', K: 20, hfa: 60, carry: .3, rest: false, sd: 1.6, lambda: 20, minGames: 6 };
export const SOCCER_LEAGUES = ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'usa.1', 'mex.1', 'uefa.champions'];
SOCCER_LEAGUES.forEach(lg => { SPORTS[lg] = { ...SOCCER, path: `soccer/${lg}`, league: lg }; });
const DATA = new URL('../data/', import.meta.url);
const API = p => `https://site.api.espn.com/apis/site/v2/sports/${p}`;
export const FEATURES = ['home', 'elo', 'margin', 'form', 'rest'];

/* ------------------------------------------------------------------ helpers */
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
const sv = s => s == null ? null : typeof s === 'object' ? num(s.displayValue ?? s.value) : num(s);
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const dayOf = iso => String(iso).slice(0, 10).replace(/-/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const erf = x => { const t = 1 / (1 + .3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const Phi = z => .5 * (1 + erf(z / Math.SQRT2));
const logit = p => Math.log(Math.min(.999, Math.max(.001, p)) / (1 - Math.min(.999, Math.max(.001, p))));
const sigm = z => 1 / (1 + Math.exp(-z));
const implied = ml => ml == null ? null : ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);

export let fetchJSON = async url => {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'sideline-learn/1.0' }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch (e) { if (i === 3) throw e; }
    await sleep(1000 * (i + 1));
  }
  return null;
};
export const setFetch = f => { fetchJSON = f; };

async function readJSON(name, d) { try { return JSON.parse(await fs.readFile(new URL(name, DATA), 'utf8')); } catch { return d; } }
async function writeJSON(name, v) { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(new URL(name, DATA), JSON.stringify(v)); }

/* ------------------------------------------------------------------ data collection */
function gameOf(ev) {
  const c = ev?.competitions?.[0]; if (!c) return null;
  const H = (c.competitors || []).find(x => x.homeAway === 'home'), A = (c.competitors || []).find(x => x.homeAway === 'away');
  if (!H || !A) return null;
  const st = c.status?.type || ev.status?.type || {}, type = ev.season?.type ?? c.season?.type ?? 2;
  const done = !!st.completed;
  return { id: String(ev.id), date: ev.date, season: ev.season?.year ?? null, type, neutral: !!c.neutralSite, h: String(H.team?.id ?? H.id), a: String(A.team?.id ?? A.id),
    hs: done ? sv(H.score) : null, as: done ? sv(A.score) : null, done, state: st.state || (done ? 'post' : 'pre') };
}
function oddsOf(ev) {
  const list = ev?.competitions?.[0]?.odds || []; const o = list.find(x => /draftkings/i.test(x.provider?.name || '')) || list[0];
  if (!o) return null;
  const cur = x => x?.current ?? x?.close ?? x?.open;
  const mlH = num(o.homeTeamOdds?.moneyLine ?? cur(o.moneyline?.home)?.odds), mlA = num(o.awayTeamOdds?.moneyLine ?? cur(o.moneyline?.away)?.odds);
  const mlD = num(o.drawOdds?.moneyLine ?? cur(o.moneyline?.draw)?.odds);
  const pH = implied(mlH), pA = implied(mlA), pD = implied(mlD);
  if (pH != null && pA != null && pD != null) { const t = pH + pA + pD; return { fairH: pH / t, fairD: pD / t, fairA: pA / t, mlH, mlD, mlA }; }
  return pH != null && pA != null ? { fairH: pH / (pH + pA), mlH, mlA } : null;
}
// Tournaments (Champions League) list stages with a start and end date instead of match days: walk every day in the stage.
const spanDays = (a, b) => { const out = [], d = new Date(String(a).slice(0, 10) + 'T12:00:00Z'), e = new Date(String(b).slice(0, 10) + 'T12:00:00Z'); for (let i = 0; d <= e && i < 400; i++, d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString()); return out; };
const calDates = cal => (cal || []).flatMap(x => typeof x === 'string' ? [x] : x?.startDate && x?.endDate && x.startDate.slice(0, 10) !== x.endDate.slice(0, 10) ? spanDays(x.startDate, x.endDate) : x?.startDate ? [x.startDate] : x?.value && /^\d{4}-/.test(x.value) ? [x.value] : []).map(dayOf);
// Some leagues (MLB) send a blacklist: the calendar lists the days WITHOUT games between calendarStartDate and calendarEndDate.
function leagueDays(lg) {
  const listed = calDates(lg?.calendar);
  if (lg?.calendarIsWhitelist !== false || !lg?.calendarStartDate || !lg?.calendarEndDate) return listed;
  const off = new Set(listed), out = [];
  const d = new Date(lg.calendarStartDate.slice(0, 10) + 'T12:00:00Z'), end = new Date(lg.calendarEndDate.slice(0, 10) + 'T12:00:00Z');
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) { const k = ymd(d); if (!off.has(k)) out.push(k); }
  return out;
}

async function collect(sp, S, store, log) {
  const base = API(S.path), today = ymd(new Date()), units = [];
  if (S.mode === 'day') {
    const cur = await fetchJSON(`${base}/scoreboard?limit=200`);
    const curCal = leagueDays(cur?.leagues?.[0]);
    let prevCal = [];
    if (curCal.length) {
      const d = new Date(Date.UTC(+curCal[0].slice(0, 4), +curCal[0].slice(4, 6) - 1, +curCal[0].slice(6, 8)));
      d.setUTCDate(d.getUTCDate() - 270);
      const prev = await fetchJSON(`${base}/scoreboard?dates=${ymd(d)}&limit=200`);
      prevCal = leagueDays(prev?.leagues?.[0]).filter(x => x < curCal[0]);
    }
    const tmw = new Date(); tmw.setUTCDate(tmw.getUTCDate() + 1);
    [...new Set([...prevCal, ...curCal])].filter(x => x <= ymd(tmw)).forEach(d => units.push({ key: d, url: `${base}/scoreboard?dates=${d}&limit=200`, day: d }));
  } else {
    const cur = await fetchJSON(`${base}/scoreboard?limit=200`);
    const year = cur?.leagues?.[0]?.season?.year || new Date().getUTCFullYear();
    for (const y of [year - 1, year]) {
      const probe = y === year ? cur : await fetchJSON(`${base}/scoreboard?dates=${y}&seasontype=2&week=1&limit=200`);
      (probe?.leagues?.[0]?.calendar || []).forEach(t => {
        const st = num(t.value); if (st !== 2 && st !== 3) return;
        (t.entries || []).forEach(e => { if (!e.startDate || dayOf(e.startDate) > today) return; units.push({ key: `${y}-${st}-${e.value}`, url: `${base}/scoreboard?dates=${y}&seasontype=${st}&week=${e.value}&limit=200`, day: dayOf(e.endDate || e.startDate) }); });
      });
    }
  }
  const recent = new Date(); recent.setUTCDate(recent.getUTCDate() - 3);
  const todo = units.filter(u => store.fetched[u.key] !== 'done' || u.day >= ymd(recent));
  log(`${sp}: ${units.length} game ${S.mode}s known, fetching ${todo.length}`);
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < todo.length) {
      const u = todo[i++];
      const sb = await fetchJSON(u.url).catch(() => null);
      if (!sb) continue;
      let allDone = true;
      (sb.events || []).forEach(ev => {
        const g = gameOf(ev); if (!g) return;
        if (!g.done) allDone = false;
        store.games[g.id] = g;
        if (g.state === 'pre') { const o = oddsOf(ev); if (o) store.snaps[g.id] = { ...(store.snaps[g.id] || {}), ...o, at: new Date().toISOString() }; }
      });
      store.fetched[u.key] = allDone && u.day < ymd(recent) ? 'done' : new Date().toISOString();
    }
  }));
}

/* ------------------------------------------------------------------ model */
function solve(A, b) {   // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]);
}
function ridge(rows, lambda, prior) {
  const k = FEATURES.length, A = Array.from({ length: k }, () => Array(k).fill(0)), b = Array(k).fill(0);
  rows.forEach(r => { for (let i = 0; i < k; i++) { b[i] += r.x[i] * r.y; for (let j = 0; j < k; j++) A[i][j] += r.x[i] * r.x[j]; } });
  for (let i = 0; i < k; i++) { A[i][i] += lambda; b[i] += lambda * prior[i]; }   // shrink toward the prior, not toward zero
  return solve(A, b);
}
const dot = (w, x) => w.reduce((s, v, i) => s + v * x[i], 0);
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

function teamFeat(t, date, S) {
  const rest = t.lastDate ? Math.min(3, Math.max(0, Math.floor((new Date(date) - new Date(t.lastDate)) / 864e5) - 1)) : 3;
  return { elo: t.elo, mShr: t.msum / (t.gp + 4), l10: avg(t.last), rest: S.rest ? rest : 0 };
}
function featuresFor(H, A, date, neutral, S) {
  const h = teamFeat(H, date, S), a = teamFeat(A, date, S);
  return [neutral ? 0 : 1, (h.elo - a.elo) / 100, h.mShr - a.mShr, h.l10 - a.l10, h.rest - a.rest];
}
const newTeam = season => ({ elo: 1500, msum: 0, gp: 0, last: [], lastDate: null, season });

export function train(sp, games, snaps, S = SPORTS[sp]) {
  const all = Object.entries(games).map(([id, g]) => ({ id, ...g })).filter(g => (S.anyType || g.type === 2 || g.type === 3) && g.h && g.a);
  const count = {}; all.forEach(g => { count[g.h] = (count[g.h] || 0) + 1; count[g.a] = (count[g.a] || 0) + 1; });
  const real = id => (count[id] || 0) >= (S.minGames || 8);                     // drops all-star and exhibition teams
  const done = all.filter(g => g.done && g.hs != null && g.as != null && real(g.h) && real(g.a)).sort((x, y) => new Date(x.date) - new Date(y.date));
  const seasons = [...new Set(all.map(g => g.season).filter(Boolean))].sort();
  const curSeason = seasons[seasons.length - 1] ?? null;
  const prior = [S.hfa / 100 * S.sd / 4, S.sd / 4, .5, .15, S.rest ? .5 : 0];   // a sensible starting point before any data
  const T = {}, team = (id, season) => {
    let t = T[id];
    if (!t) t = T[id] = newTeam(season);
    if (season != null && t.season != null && season !== t.season) {   // new season: regress Elo, reset form
      t.elo = 1500 + (t.elo - 1500) * (1 - S.carry); t.msum = 0; t.gp = 0; t.last = []; t.season = season;
    }
    if (t.season == null) t.season = season;
    return t;
  };
  const rows = [], wf = [];
  let w = prior.slice(), sigma = S.sd, day = null, resid = [];
  for (const g of done) {
    const H = team(g.h, g.season), A = team(g.a, g.season), d = dayOf(g.date);
    if (d !== day) {                                              // refit once per day on everything before it
      day = d;
      if (rows.length >= 40) { w = ridge(rows, S.lambda * Math.max(1, 200 / rows.length), prior); }
      if (resid.length >= 40) sigma = Math.sqrt(avg(resid.slice(-1500).map(r => r * r)));
    }
    const x = featuresFor(H, A, g.date, g.neutral, S), y = g.hs - g.as;
    const m = dot(w, x), p = Phi(m / sigma);
    const pr = probs3(m, sigma, S), out = y > 0 ? 'H' : y < 0 ? 'A' : 'D';
    const pred = S.draws ? (pr.h >= pr.a && pr.h >= pr.d ? 'H' : pr.a >= pr.d ? 'A' : 'D') : (m > 0 ? 'H' : 'A');
    const sn = snaps[g.id], mk = sn && sn.fairH != null && (!sn.at || sn.at <= g.date) ? sn : null;
    if (S.draws || y !== 0) wf.push({ id: g.id, date: g.date, d, season: g.season, h: g.h, a: g.a, hs: g.hs, as: g.as, pH: pr.h, pD: pr.d, pA: pr.a, pred, res: out, ok: pred === out, conf: Math.max(pr.h, pr.d, pr.a),
      brier: S.draws ? (pr.h - (out === 'H')) ** 2 + (pr.d - (out === 'D')) ** 2 + (pr.a - (out === 'A')) ** 2 : (p - (y > 0 ? 1 : 0)) ** 2, home: y > 0, n: rows.length,
      mk: mk ? { h: mk.fairH, d: mk.fairD ?? null, a: mk.fairA ?? (mk.fairD == null ? 1 - mk.fairH : null) } : null });
    resid.push(y - m);
    rows.push({ x, y, d });
    // Elo update with margin-of-victory multiplier
    const diff = H.elo + (g.neutral ? 0 : S.hfa) - A.elo, exp = 1 / (1 + 10 ** (-diff / 400)), res = y > 0 ? 1 : y < 0 ? 0 : .5;
    const winDiff = y > 0 ? diff : -diff, mult = Math.log(Math.abs(y) + 1) * 2.2 / (winDiff * .001 + 2.2);
    const delta = S.K * Math.max(.5, mult) * (res - exp);
    H.elo += delta; A.elo -= delta;
    [[H, y], [A, -y]].forEach(([t, mg]) => { t.msum += mg; t.gp++; t.last.push(mg); if (t.last.length > 10) t.last.shift(); t.lastDate = g.date; });
  }
  if (rows.length >= 40) w = ridge(rows, S.lambda * Math.max(1, 200 / rows.length), prior);
  if (resid.length >= 40) sigma = Math.sqrt(avg(resid.slice(-1500).map(r => r * r)));
  // teams as they stand before their next game (new-season regression applied if a new season has begun)
  const teams = {};
  Object.keys(T).filter(real).forEach(id => { const t = team(id, curSeason); teams[id] = { elo: +t.elo.toFixed(1), msum: t.msum, gp: t.gp, last: t.last, lastDate: t.lastDate }; });
  // walk-forward report
  const sum = list => list.length ? { n: list.length, acc: +(avg(list.map(r => r.ok ? 1 : 0))).toFixed(4), brier: +(avg(list.map(r => r.brier))).toFixed(4), homeAcc: +(avg(list.map(r => r.home ? 1 : 0))).toFixed(4) } : { n: 0 };
  const scored = wf.filter(r => r.n >= 40);
  const months = {}; scored.forEach(r => { const k = `${r.d.slice(0, 4)}-${r.d.slice(4, 6)}`; (months[k] = months[k] || []).push(r); });
  const cutoff = ymd(new Date(Date.now() - 30 * 864e5));
  const evalOut = { all: sum(scored), season: sum(scored.filter(r => r.season === curSeason)), last30: sum(scored.filter(r => r.d >= cutoff)), months: Object.entries(months).sort().map(([m, l]) => ({ m, ...sum(l) })), ...trackerOf(scored, S) };
  // learned blend of model and market, from games where we saved pre-game odds
  const model = (id1, id2, date, neutral) => { const x = featuresFor(teams[id1] ? { ...teams[id1] } : newTeam(), teams[id2] ? { ...teams[id2] } : newTeam(), date, neutral, S); return dot(w, x); };
  Object.entries(snaps).forEach(([id, s]) => { const g = games[id]; if (g && !g.done && g.state === 'pre' && teams[g.h] && teams[g.a]) s.pModel = +Phi(model(g.h, g.a, g.date, g.neutral) / sigma).toFixed(4); });
  const bl = Object.entries(snaps).map(([id, s]) => ({ s, g: games[id] })).filter(({ s, g }) => g && g.done && g.hs !== g.as && s.pModel != null && s.fairH != null);
  let blend = null;
  if (!S.draws && bl.length >= 100) {
    let a = 0, wm = .5, wk = .5;                                 // logistic regression by gradient descent
    for (let it = 0; it < 3000; it++) {
      let ga = 0, gm = 0, gk = 0;
      bl.forEach(({ s, g }) => { const xm = logit(s.pModel), xk = logit(s.fairH), y = g.hs > g.as ? 1 : 0, p = sigm(a + wm * xm + wk * xk), e = p - y; ga += e; gm += e * xm; gk += e * xk; });
      const lr = .5 / bl.length; a -= lr * ga; wm -= lr * (gm + .5 * (wm - .5)); wk -= lr * (gk + .5 * (wk - .5));
    }
    const acc = f => avg(bl.map(({ s, g }) => ((f(s) > .5) === (g.hs > g.as)) ? 1 : 0));
    blend = { a: +a.toFixed(4), wModel: +wm.toFixed(4), wMarket: +wk.toFixed(4), n: bl.length, accModel: +acc(s => s.pModel).toFixed(4), accMarket: +acc(s => s.fairH).toFixed(4), accBlend: +acc(s => sigm(a + wm * logit(s.pModel) + wk * logit(s.fairH))).toFixed(4) };
  }
  return { sport: sp, version: 1, updated: new Date().toISOString(), features: FEATURES, w: w.map(v => +v.toFixed(4)), sigma: +sigma.toFixed(3), rest: S.rest, games: rows.length, seasons, curSeason, teams, eval: evalOut, blend, snapshots: Object.keys(snaps).length };
}

/* ------------------------------------------------------------------ accuracy tracker
   Everything the dashboards' "Model" page shows: calibration, week-by-week accuracy, the most
   recent graded predictions, accuracy on confident calls and a head-to-head with the betting market. */
function probs3(m, sigma, S) {
  if (!S.draws) { const p = Phi(m / sigma); return { h: p, d: 0, a: 1 - p }; }
  const h = 1 - Phi((.5 - m) / sigma), a = Phi((-.5 - m) / sigma);
  return { h, d: Math.max(0, 1 - h - a), a };
}
function trackerOf(scored, S) {
  const r4 = v => v == null ? null : +v.toFixed(4);
  const edges = S.draws ? [0, .4, .45, .5, .55, .6, .65, .7, 1.01] : [.5, .55, .6, .65, .7, .75, .8, .85, .9, 1.01];
  const calib = edges.slice(0, -1).map((lo, i) => { const L = scored.filter(r => r.conf >= lo && r.conf < edges[i + 1]); return { lo, hi: Math.min(1, edges[i + 1]), n: L.length, p: r4(avg(L.map(r => r.conf))), hit: r4(avg(L.map(r => r.ok ? 1 : 0))) }; }).filter(b => b.n);
  const monday = d => { const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return ymd(t); };
  const wk = {}; scored.forEach(r => (wk[monday(r.d)] ||= []).push(r));
  const weeks = Object.entries(wk).sort().slice(-20).map(([w, L]) => ({ w, n: L.length, acc: r4(avg(L.map(r => r.ok ? 1 : 0))), brier: r4(avg(L.map(r => r.brier))) }));
  const confCut = S.draws ? .55 : .65, conf = scored.filter(r => r.conf >= confCut);
  const withMk = scored.filter(r => r.mk && r.mk.h != null);
  const mkPred = r => S.draws && r.mk.d != null ? (r.mk.h >= r.mk.a && r.mk.h >= r.mk.d ? 'H' : r.mk.a >= r.mk.d ? 'A' : 'D') : (r.mk.h > .5 ? 'H' : 'A');
  const mkBrier = r => S.draws && r.mk.d != null ? (r.mk.h - (r.res === 'H')) ** 2 + (r.mk.d - (r.res === 'D')) ** 2 + (r.mk.a - (r.res === 'A')) ** 2 : (r.mk.h - (r.res === 'H' ? 1 : 0)) ** 2;
  const market = withMk.length ? { n: withMk.length, accModel: r4(avg(withMk.map(r => r.ok ? 1 : 0))), accMarket: r4(avg(withMk.map(r => mkPred(r) === r.res ? 1 : 0))), brierModel: r4(avg(withMk.map(r => r.brier))), brierMarket: r4(avg(withMk.map(mkBrier))), agree: r4(avg(withMk.map(r => mkPred(r) === r.pred ? 1 : 0))) } : null;
  const recent = scored.slice(-40).reverse().map(r => ({ id: r.id, date: r.date, h: r.h, a: r.a, hs: r.hs, as: r.as, pH: r4(r.pH), pD: S.draws ? r4(r.pD) : undefined, pA: r4(r.pA), pred: r.pred, res: r.res, ok: r.ok, mk: r.mk ? r4(r.mk.h) : undefined }));
  const base = S.draws ? { home: r4(avg(scored.map(r => r.res === 'H' ? 1 : 0))), draw: r4(avg(scored.map(r => r.res === 'D' ? 1 : 0))) } : { home: r4(avg(scored.map(r => r.res === 'H' ? 1 : 0))) };
  return { draws: !!S.draws, calib, weeks, confident: { cut: confCut, n: conf.length, acc: r4(avg(conf.map(r => r.ok ? 1 : 0))) }, market, recent, base };
}

/* ------------------------------------------------------------------ main */
async function run(sp, log) {
  const S = SPORTS[sp];
  const store = await readJSON(`${sp}-games.json`, { games: {}, snaps: {}, fetched: {} });
  await collect(sp, S, store, log);
  // keep the two most recent seasons only, so the files stay small year after year
  const keep = new Set([...new Set(Object.values(store.games).map(g => g.season).filter(v => v != null))].sort((a, b) => a - b).slice(-2));
  Object.keys(store.games).forEach(id => { if (store.games[id].season != null && !keep.has(store.games[id].season)) delete store.games[id]; });
  Object.keys(store.snaps).forEach(id => { if (!store.games[id]) delete store.snaps[id]; });
  const model = train(sp, store.games, store.snaps, S);
  await writeJSON(`${sp}-games.json`, store);
  await writeJSON(`model-${sp}.json`, model);
  log(`${sp}: ${model.games} games learned · walk-forward ${(model.eval.all.acc * 100 || 0).toFixed(1)}% (home ${(model.eval.all.homeAcc * 100 || 0).toFixed(1)}%) · this season ${model.eval.season.n || 0} games ${(model.eval.season.acc * 100 || 0).toFixed(1)}% · snapshots ${model.snapshots}${model.blend ? ` · blend ${JSON.stringify(model.blend)}` : ''}`);
  return model;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const want = process.argv.slice(2).filter(s => SPORTS[s]);
  for (const sp of want.length ? want : Object.keys(SPORTS)) {
    try { await run(sp, console.log); } catch (e) { console.error(`${sp}: failed — ${e.message}`); if (!SPORTS[sp].draws) process.exitCode = 1; }   // a soccer league hiccup shouldn't raise the alarm
  }
}
export { run, SPORTS, featuresFor, probs3, oddsOf, Phi, newTeam };
