// Sideline model v2 — trainer. Walks every completed game in date order: predicts it from what was known
// before tip-off (so every graded prediction is an honest out-of-sample test), then learns from the result.
// Settings (Elo speed, home edge, season carry-over, shrinkage; for soccer the goal model's speed, shot weight
// and draw correction) are chosen by trying a grid and keeping whatever gives the lowest log loss.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SM = require('./predict.js');
const { Phi, logit, sigm, fair, newTeam, features, goalProbs, FEATURES, LEGACY } = SM;

const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const dayOf = iso => String(iso).slice(0, 10).replace(/-/g, '');
const r4 = v => v == null ? null : +(+v).toFixed(4);
const LL = p => -Math.log(Math.min(1 - 1e-6, Math.max(1e-6, p)));

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]);
}
const priorFor = (f, S) => ({ home: S.hfa / 100 * S.sd / 4, elo: S.sd / 4, margin: .5, form: .15, rest: S.rest ? .5 : 0 })[f] ?? 0;

/* =============================================================== US sports */
function gameInputs(kind, g, b, H, A) {
  const inp = {}, t = b && b.t;
  if (!t) return inp;
  const th = t[g.h], ta = t[g.a];
  if (kind === 'nba') {
    const miss = (team, tb) => { if (!tb || !tb[1]) return []; const played = new Set(tb[1].map(p => p[0])); return Object.keys(team.rot || {}).filter(id => !played.has(id)).map(id => ({ id, sit: 1 })); };
    inp.outH = miss(H, th); inp.outA = miss(A, ta);
  } else if (kind === 'nhl') {
    const st = tb => tb && tb[1] && tb[1].length ? tb[1].slice().sort((x, y) => y[3] - x[3])[0][0] : undefined;
    inp.gH = st(th); inp.gA = st(ta);
  } else if (kind === 'mlb') {
    inp.spH = th && th[0] ? th[0][0] : undefined; inp.spA = ta && ta[0] ? ta[0][0] : undefined;
  } else if (kind === 'nfl') {
    if (th && th[3]) inp.qbH = th[3][0]; if (ta && ta[3]) inp.qbA = ta[3][0];
  }
  return inp;
}
function learnFromBox(kind, g, b, H, A, tables) {
  const t = b && b.t; if (!t) return;
  const th = t[g.h], ta = t[g.a];
  if (kind === 'nba') {
    if (th && ta && th[0] && ta[0]) { const v = (g.hs - g.as) / ((th[0] + ta[0]) / 2) * 100; H.net += v; H.ng++; A.net -= v; A.ng++; }
    [[H, th], [A, ta]].forEach(([team, tb]) => {
      if (!tb || !tb[1]) return;
      const mins = {}; tb[1].forEach(([id, min, gs]) => { mins[id] = min; const r = tables.players[id] || (tables.players[id] = [0, 0]); r[0] += min; r[1] += gs; });
      const rot = team.rot || (team.rot = {});
      new Set([...Object.keys(rot), ...Object.keys(mins)]).forEach(id => { const v = (rot[id] || 0) * .8 + (mins[id] || 0) * .2; if (v < 1) delete rot[id]; else rot[id] = v; });
    });
  } else if (kind === 'nhl') {
    if (th && ta && th[0] != null && ta[0] != null) { const v = th[0] - ta[0]; H.sd += v; H.sg++; A.sd -= v; A.sg++; }
    [[H, th], [A, ta]].forEach(([team, tb]) => {
      if (!tb || !tb[1] || !tb[1].length) return;
      let sa = 0, ga = 0;
      tb[1].forEach(([id, s, gg]) => { const r = tables.goalies[id] || (tables.goalies[id] = [0, 0]); r[0] += s; r[1] += gg; sa += s; ga += gg; });
      if (sa > 0) tables.lgSv = tables.lgSv * .995 + (1 - ga / sa) * .005;
      team.lastG = tb[1].slice().sort((x, y) => y[3] - x[3])[0][0];
    });
  } else if (kind === 'mlb') {
    [th, ta].forEach(tb => {
      const s = tb && tb[0]; if (!s || !s[1]) return;
      const [id, outs, er, bb, k, hr] = s, r = tables.pitchers[id] || (tables.pitchers[id] = [0, 0, 0, 0, 0]);
      r[0] += outs; r[1] += er; r[2] += bb; r[3] += k; r[4] += hr;
      const L = tables.lgTot; L[0] += outs; L[1] += er; L[2] += bb; L[3] += k; L[4] += hr;
    });
    const L = tables.lgTot; if (L[0] > 300) { const ip = L[0] / 3; tables.lgFip = L[1] / ip * 9; tables.cFip = tables.lgFip - (13 * L[4] + 3 * L[2] - 2 * L[3]) / ip; }
  } else if (kind === 'nfl') {
    if (th && ta && th[0] && ta[0] && th[1] != null && ta[1] != null) { const v = th[1] / th[0] - ta[1] / ta[0]; H.ypp += v; H.yg++; A.ypp -= v; A.yg++; }
    [[H, th], [A, ta]].forEach(([team, tb]) => {
      const q = tb && tb[3]; if (!q || q[1] < 8) return;
      const [id, att, yds, td, int, sk, sky] = q, db = att + sk, any = yds + 20 * td - 45 * int - sky;
      const r = tables.qbs[id] || (tables.qbs[id] = [0, 0]); r[0] += db; r[1] += any;
      const L = tables.lgQ; L[0] += db; L[1] += any; tables.lgAny = L[1] / L[0];
      team.qb = id;
    });
  }
}
function decayTables(kind, tables) {      // a new season: older player numbers count for less
  const f = (o, k) => Object.values(o).forEach(r => { for (let i = 0; i < r.length; i++) r[i] *= k; });
  if (kind === 'nba') f(tables.players, .5);
  if (kind === 'nhl') f(tables.goalies, .5);
  if (kind === 'mlb') f(tables.pitchers, .6);
  if (kind === 'nfl') f(tables.qbs, .6);
}

export function walkUS(sport, games, box, S, P, feats) {
  const kind = sport, list = feats || FEATURES[kind];
  const all = Object.entries(games).map(([id, g]) => ({ id, ...g })).filter(g => (g.type === 2 || g.type === 3) && g.h && g.a);
  const count = {}; all.forEach(g => { count[g.h] = (count[g.h] || 0) + 1; count[g.a] = (count[g.a] || 0) + 1; });
  const real = id => (count[id] || 0) >= 8;
  const done = all.filter(g => g.done && g.hs != null && g.as != null && real(g.h) && real(g.a)).sort((x, y) => new Date(x.date) - new Date(y.date));
  const seasons = [...new Set(all.map(g => g.season).filter(Boolean))].sort();
  const curSeason = seasons[seasons.length - 1] ?? null;
  const K = S.K * P.k, HFA = S.hfa * P.h, CARRY = P.carry, LAM = S.lambda * P.lam;
  const prior = list.map(f => priorFor(f, S)), n = list.length;
  const tables = { players: {}, goalies: {}, lgSv: .9, pitchers: {}, lgTot: [0, 0, 0, 0, 0], lgFip: 4.2, cFip: 3.1, qbs: {}, lgQ: [0, 0], lgAny: 6 };
  const St = { features: list, rest: S.rest, tables };
  const T = {}, team = (id, season) => {
    let t = T[id]; if (!t) t = T[id] = newTeam(season);
    if (season != null && t.season != null && season !== t.season) { t.elo = 1500 + (t.elo - 1500) * (1 - CARRY); t.msum = 0; t.gp = 0; t.last = []; t.net *= .3; t.ng *= .3; t.sd *= .3; t.sg *= .3; t.ypp *= .3; t.yg *= .3; t.season = season; }
    if (t.season == null) t.season = season;
    return t;
  };
  const AA = Array.from({ length: n }, () => Array(n).fill(0)), bb = Array(n).fill(0);
  let rows = 0, w = prior.slice(), sigma = S.sd, day = null, seenSeason = null;
  const resid = [], wf = [];
  const refit = () => { const lam = LAM * Math.max(1, 200 / Math.max(rows, 1)); const A2 = AA.map((r, i) => r.map((v, j) => v + (i === j ? lam : 0))), b2 = bb.map((v, i) => v + lam * prior[i]); w = solve(A2, b2); };
  for (const g of done) {
    if (g.season != null && seenSeason != null && g.season > seenSeason) decayTables(kind, tables);
    if (g.season != null) seenSeason = Math.max(seenSeason ?? g.season, g.season);
    const H = team(g.h, g.season), A = team(g.a, g.season), d = dayOf(g.date), b = box && box[g.id];
    if (d !== day) { day = d; if (rows >= 40) refit(); if (resid.length >= 40) sigma = Math.sqrt(avg(resid.slice(-1500).map(r => r * r))); }
    const x = features(St, kind, H, A, { date: g.date, neutral: g.neutral, inputs: gameInputs(kind, g, b, H, A) });
    const y = g.hs - g.as, m = w.reduce((s, v, i) => s + v * x[i], 0), p = Phi(m / sigma);
    if (y !== 0) {
      const o = b && b.o, close = o ? fair(o.h[1], o.a[1]) : null, open = o && o.h[0] != null && o.a[0] != null ? fair(o.h[0], o.a[0]) : null;
      wf.push({ id: g.id, date: g.date, d, season: g.season, h: g.h, a: g.a, hs: g.hs, as: g.as, p, y: y > 0 ? 1 : 0, n: rows, mkH: close ? close.h : null, opH: open ? open.h : null });
    }
    resid.push(y - m);
    for (let i = 0; i < n; i++) { bb[i] += x[i] * y; for (let j = 0; j < n; j++) AA[i][j] += x[i] * x[j]; }
    rows++;
    const diff = H.elo + (g.neutral ? 0 : HFA) - A.elo, exp = 1 / (1 + 10 ** (-diff / 400)), res = y > 0 ? 1 : y < 0 ? 0 : .5;
    const winDiff = y > 0 ? diff : -diff, mult = Math.log(Math.abs(y) + 1) * 2.2 / (winDiff * .001 + 2.2);
    const delta = K * Math.max(.5, mult) * (res - exp);
    H.elo += delta; A.elo -= delta;
    [[H, y], [A, -y]].forEach(([t, mg]) => { t.msum += mg; t.gp++; t.last.push(mg); if (t.last.length > 10) t.last.shift(); t.lastDate = g.date; });
    learnFromBox(kind, g, b, H, A, tables);
  }
  if (rows >= 40) refit();
  if (resid.length >= 40) sigma = Math.sqrt(avg(resid.slice(-1500).map(r => r * r)));
  return { w, sigma, T, tables, wf, rows, seasons, curSeason, team, real, list };
}
// the window every version is scored on: everything after the first season's warm-up
const evalRows = (wf, seasons) => { const first = seasons.length > 1 ? seasons[1] : null; return wf.filter(r => r.n >= 300 && (first == null || r.season >= first)); };
export const scoreUS = rows => ({ n: rows.length, logloss: r4(avg(rows.map(r => LL(r.y ? r.p : 1 - r.p)))), acc: r4(avg(rows.map(r => (r.p > .5) === !!r.y ? 1 : 0))), brier: r4(avg(rows.map(r => (r.p - r.y) ** 2))) });

/* ---------- blend with the market: logistic fit, scored on a later holdout ---------- */
function fitLogit(rows, X, iters = 2500) {
  let th = [0, .5, .5, 0];
  const k = th.length, prior = [0, .5, .5, 0];
  for (let it = 0; it < iters; it++) {
    const g = Array(k).fill(0);
    rows.forEach(r => { const x = X(r), p = sigm(x.reduce((s, v, i) => s + v * th[i], 0)), e = p - r.y; for (let i = 0; i < k; i++) g[i] += e * x[i]; });
    const lr = .8 / rows.length; for (let i = 0; i < k; i++) th[i] -= lr * (g[i] + 2 * (th[i] - prior[i]));
  }
  return th;
}
export function fitBlendUS(rows) {
  const R = rows.filter(r => r.mkH != null);
  if (R.length < 150) return { blend: null, holdout: null };
  const X = r => [1, logit(r.p), logit(r.mkH), r.opH != null ? logit(r.mkH) - logit(r.opH) : 0];
  const cut = Math.floor(R.length * .7), train = R.slice(0, cut), test = R.slice(cut);
  const th = fitLogit(train, X), pb = r => sigm(X(r).reduce((s, v, i) => s + v * th[i], 0));
  const sc = f => ({ logloss: r4(avg(test.map(r => LL(r.y ? f(r) : 1 - f(r))))), acc: r4(avg(test.map(r => (f(r) > .5) === !!r.y ? 1 : 0))) });
  const holdout = { n: test.length, model: sc(r => r.p), market: sc(r => r.mkH), blend: sc(pb) };
  const all = fitLogit(R, X);
  return { blend: { a: r4(all[0]), wm: r4(all[1]), wk: r4(all[2]), wv: r4(all[3]), n: R.length }, holdout };
}

export function tuneUS(sport, games, box, S, log) {
  const grid = [];
  for (const k of [.4, .6, 1, 1.6, 2.4]) for (const h of [.3, .6, 1, 1.4]) for (const carry of [.15, .3, .5, .7]) for (const lam of [.25, .5, 1, 2]) grid.push({ k, h, carry, lam });
  let best = null;
  for (const P of grid) {
    const r = walkUS(sport, games, box, S, P);
    const sc = scoreUS(evalRows(r.wf, r.seasons));
    if (!best || sc.logloss < best.sc.logloss) best = { P, sc };
  }
  const legacy = walkUS(sport, games, box, S, { k: 1, h: 1, carry: S.carry, lam: 1 }, LEGACY);
  const old = scoreUS(evalRows(legacy.wf, legacy.seasons));
  log && log(`${sport}: tuned ${JSON.stringify(best.P)} · log loss ${best.sc.logloss} (old ${old.logloss}) · right ${(best.sc.acc * 100).toFixed(1)}% (old ${(old.acc * 100).toFixed(1)}%) on ${best.sc.n} games`);
  return { P: best.P, score: best.sc, old };
}

/* =============================================================== soccer */
export function walkSoccer(lg, games, box, S, P) {
  const all = Object.entries(games).map(([id, g]) => ({ id, ...g })).filter(g => g.h && g.a);
  const count = {}; all.forEach(g => { count[g.h] = (count[g.h] || 0) + 1; count[g.a] = (count[g.a] || 0) + 1; });
  const real = id => (count[id] || 0) >= (S.minGames || 6);
  const done = all.filter(g => g.done && g.hs != null && g.as != null && real(g.h) && real(g.a)).sort((x, y) => new Date(x.date) - new Date(y.date));
  const seasons = [...new Set(all.map(g => g.season).filter(Boolean))].sort();
  const T = {}, team = (id, season) => {
    let t = T[id]; if (!t) t = T[id] = { att: -.08, def: .08, season, gp: 0 };
    if (season != null && t.season != null && season !== t.season) { t.att *= P.carry; t.def *= P.carry; t.season = season; }
    return t;
  };
  let mu = Math.log(1.3), home = .22;
  const wf = [];
  for (const g of done) {
    const H = team(g.h, g.season), A = team(g.a, g.season), b = box && box[g.id];
    const lh = Math.exp(mu + (g.neutral ? 0 : home) + H.att + A.def), la = Math.exp(mu + A.att + H.def);
    const pr = goalProbs(lh, la, P.rho), res = g.hs > g.as ? 'H' : g.hs < g.as ? 'A' : 'D';
    const o = b && b.o, close = o && o.d ? fair(o.h[1], o.a[1], o.d[1]) : null, open = o && o.d && o.h[0] != null && o.a[0] != null && o.d[0] != null ? fair(o.h[0], o.a[0], o.d[0]) : null;
    wf.push({ id: g.id, date: g.date, d: dayOf(g.date), season: g.season, h: g.h, a: g.a, hs: g.hs, as: g.as, pr, res, n: wf.length, mk: close, op: open });
    const th = b && b.t && b.t[g.h], ta = b && b.t && b.t[g.a];
    const yh = th && th[1] != null ? (1 - P.sw) * g.hs + P.sw * .32 * th[1] : g.hs, ya = ta && ta[1] != null ? (1 - P.sw) * g.as + P.sw * .32 * ta[1] : g.as;
    const eh = yh - lh, ea = ya - la, k = P.k * (H.gp < 6 || A.gp < 6 ? 1.6 : 1);
    H.att += k * eh; A.def += k * eh; A.att += k * ea; H.def += k * ea;
    mu += P.k * .05 * (eh + ea); if (!g.neutral) home += P.k * .03 * (eh - ea);
    H.gp++; A.gp++;
  }
  return { T, mu, home, wf, seasons, real };
}
const pOf = (pr, res) => res === 'H' ? pr.h : res === 'D' ? pr.d : pr.a;
const pick3 = pr => pr.h >= pr.a && pr.h >= pr.d ? 'H' : pr.a >= pr.d ? 'A' : 'D';
export const scoreSoccer = (rows, f = r => r.pr) => ({ n: rows.length, logloss: r4(avg(rows.map(r => LL(pOf(f(r), r.res))))), acc: r4(avg(rows.map(r => pick3(f(r)) === r.res ? 1 : 0))) });
const evalSoccer = (wf, seasons) => { const first = seasons.length > 1 ? seasons[1] : null; return wf.filter(r => r.n >= 120 && (first == null || r.season >= first)); };
export function tuneSoccer(lg, games, box, S) {
  let best = null;
  for (const k of [.015, .025, .04, .06, .09]) for (const sw of [0, .35, .7]) for (const rho of [-.15, -.08, 0]) for (const carry of [.5, .75, .9]) {
    const P = { k, sw, rho, carry }, r = walkSoccer(lg, games, box, S, P), sc = scoreSoccer(evalSoccer(r.wf, r.seasons));
    if (sc.n && (!best || sc.logloss < best.sc.logloss)) best = { P, sc };
  }
  return best;
}
export function fitBlend3(rows) {
  const R = rows.filter(r => r.mk);
  if (R.length < 150) return { blend: null, holdout: null };
  const f = (B, r) => SM.blend3(B, r.pr, r.mk, r.op);
  const fit = L => { let best = null; for (let wm = 0; wm <= 1.2001; wm += .1) for (let wk = 0; wk <= 1.4001; wk += .1) for (const wv of [0, .5, 1]) { const B = { wm, wk, wv }, ll = avg(L.map(r => LL(pOf(f(B, r), r.res)))); if (!best || ll < best.ll) best = { B, ll }; } return best.B; };
  const cut = Math.floor(R.length * .7), B = fit(R.slice(0, cut)), test = R.slice(cut);
  const holdout = { n: test.length, model: scoreSoccer(test), market: scoreSoccer(test, r => r.mk), blend: scoreSoccer(test, r => f(B, r)) };
  const all = fit(R);
  return { blend: { wm: r4(all.wm), wk: r4(all.wk), wv: r4(all.wv), n: R.length }, holdout };
}
export { evalRows, evalSoccer, pOf, pick3 };
