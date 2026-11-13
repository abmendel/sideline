/* Sideline prediction model — shared by the trainer (learn/learn.mjs), the hourly pick record
   (learn/ledger.mjs) and every dashboard page, so all three compute exactly the same numbers.
   Plain script: in a page it defines window.SidelineModel; in Node it sets module.exports.

   US sports (NBA, NFL, MLB, NHL) — expected home margin = Σ weight × feature, win chance = Φ(margin / σ).
     home     1 at the home team's venue, 0 on a neutral site
     elo      Elo difference / 100 (margin-of-victory Elo, regressed toward average each new season)
     margin   season scoring margin per game, shrunk toward 0 early in a season
     form     average margin over the last 10 games
     rest     days of rest (capped at 3)
     net      NBA: points per 100 possessions margin (pace-adjusted efficiency), shrunk
     avail    NBA: value of rotation players missing (game score per 36 above replacement × usual minutes)
     shots    NHL: shot differential per game, shrunk
     goalie   NHL: starting goalie's goals saved above average per 30 shots, shrunk toward average
     sp       MLB: starting pitcher's runs saved per start (fielding-independent pitching vs league), shrunk
     ypp      NFL: yards-per-play margin, shrunk
     qb       NFL: starting quarterback's adjusted net yards per attempt above average, shrunk
   Soccer — each team has an attack and a defence rating; expected goals λ = exp(μ + home + attack + opponent's
   defence leakiness); results come from two Poisson goal counts with the Dixon–Coles low-score correction.
   Both are then blended with the betting market: logit p = a + wm·logit(model) + wk·logit(market) + wv·line move. */
(function (root) {
  'use strict';
  const erf = x => { const t = 1 / (1 + .3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  const Phi = z => .5 * (1 + erf(z / Math.SQRT2));
  const clamp = (p, lo = .001) => Math.min(1 - lo, Math.max(lo, p));
  const logit = p => { p = clamp(p); return Math.log(p / (1 - p)); };
  const sigm = z => 1 / (1 + Math.exp(-z));
  const avg = a => a && a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  const implied = ml => ml == null ? null : ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);

  const FEATURES = {
    nba: ['home', 'elo', 'margin', 'form', 'rest', 'net', 'avail'],
    nhl: ['home', 'elo', 'margin', 'form', 'rest', 'shots', 'goalie'],
    mlb: ['home', 'elo', 'margin', 'form', 'sp'],
    nfl: ['home', 'elo', 'margin', 'form', 'rest', 'ypp', 'qb']
  };
  const LEGACY = ['home', 'elo', 'margin', 'form', 'rest'];
  const kindOf = sport => /^(nba|nhl|mlb|nfl)$/.test(sport) ? sport : 'soccer';
  // how likely a listed player is to sit, by injury-report status
  const SIT = s => /out|suspen|injured reserve|\bir\b/i.test(s || '') ? 1 : /doubt/i.test(s || '') ? .8 : /question|day-to-day|game.?time/i.test(s || '') ? .4 : /probable/i.test(s || '') ? .1 : 0;

  const newTeam = season => ({ elo: 1500, msum: 0, gp: 0, last: [], lastDate: null, season,
    net: 0, ng: 0, rot: {}, sd: 0, sg: 0, lastG: null, ypp: 0, yg: 0, qb: null });

  /* ---------- player / starter ratings (tables live in the model file) ---------- */
  const NBA_REPL = 8;                // game score per 36 minutes of a replacement-level player
  const nbaRating = (P, id) => { const r = P[id]; return r ? (r[1] + NBA_REPL / 36 * 400) / (r[0] + 400) * 36 : NBA_REPL; };
  function nbaMissing(M, team, out) {          // out: [{ id, sit 0..1 }]
    if (!team || !out || !out.length) return 0;
    const P = (M.tables && M.tables.players) || {};
    return out.reduce((s, o) => { const min = team.rot ? team.rot[o.id] || 0 : 0; return min < 8 ? s : s + Math.max(0, nbaRating(P, o.id) - NBA_REPL) * min / 36 * (o.sit == null ? 1 : o.sit); }, 0);
  }
  const goalieQ = (M, id) => { const G = (M.tables && M.tables.goalies) || {}, g = id && G[id], lg = (M.tables && M.tables.lgSv) || .9; if (!g) return 0; return (lg * g[0] - g[1]) / (g[0] + 900) * 30; };
  function spValue(M, id) {
    const T = M.tables || {}, R = T.pitchers || {}, p = id && R[id], lg = T.lgFip || 4.2, c = T.cFip || 3.1;
    if (!p) return -.15;                                                   // unknown starter: a bit below average
    const ip = p[0] / 3, fip = ip > 0 ? (13 * p[4] + 3 * p[2] - 2 * p[3]) / ip + c : lg;
    const shr = (fip * ip + (lg + .35) * 40) / (ip + 40);
    return (lg - shr) * 5.4 / 9;
  }
  function qbValue(M, id) {
    const T = M.tables || {}, Q = T.qbs || {}, q = id && Q[id], lg = T.lgAny || 6;
    const prior = lg - 1.2, n = q ? q[0] : 0, y = q ? q[1] : 0;
    return (y + prior * 180) / (n + 180) - lg;
  }

  /* ---------- feature vector for one game ---------- */
  function teamFeat(t, date, rest) {
    const r = t.lastDate ? Math.min(3, Math.max(0, Math.floor((new Date(date) - new Date(t.lastDate)) / 864e5) - 1)) : 3;
    return { elo: t.elo, mShr: t.msum / (t.gp + 4), l10: avg(t.last), rest: rest ? r : 0 };
  }
  // ctx: { date, neutral, inputs: { outH, outA, gH, gA, spH, spA, qbH, qbA } }
  function features(M, kind, H, A, ctx) {
    const list = M.features || FEATURES[kind] || LEGACY, inp = ctx.inputs || {};
    const h = teamFeat(H, ctx.date, M.rest), a = teamFeat(A, ctx.date, M.rest);
    return list.map(f => {
      switch (f) {
        case 'home': return ctx.neutral ? 0 : 1;
        case 'elo': return (h.elo - a.elo) / 100;
        case 'margin': return h.mShr - a.mShr;
        case 'form': return h.l10 - a.l10;
        case 'rest': return h.rest - a.rest;
        case 'net': return H.net / (H.ng + 6) - A.net / (A.ng + 6);
        case 'avail': return nbaMissing(M, A, inp.outA) - nbaMissing(M, H, inp.outH);
        case 'shots': return H.sd / (H.sg + 8) - A.sd / (A.sg + 8);
        case 'goalie': return goalieQ(M, inp.gH || H.lastG) - goalieQ(M, inp.gA || A.lastG);
        case 'sp': return spValue(M, inp.spH) - spValue(M, inp.spA);
        case 'ypp': return H.ypp / (H.yg + 4) - A.ypp / (A.yg + 4);
        case 'qb': return qbValue(M, inp.qbH === undefined ? H.qb : inp.qbH) - qbValue(M, inp.qbA === undefined ? A.qb : inp.qbA);
        default: return 0;
      }
    });
  }
  const teamOf = (M, id) => (M.teams && M.teams[String(id)]) || null;
  // { m: expected home margin, p: home win chance, x, parts: { feature: contribution } }
  function predictUS(M, homeId, awayId, ctx) {
    const kind = kindOf(M.sport), H = teamOf(M, homeId), A = teamOf(M, awayId);
    if (!H || !A || !M.w) return null;
    const x = features(M, kind, H, A, ctx || {}), parts = {};
    let m = 0;
    (M.features || LEGACY).forEach((f, i) => { const v = (M.w[i] || 0) * x[i]; parts[f] = v; m += v; });
    return { m, p: Phi(m / (M.sigma || 1)), x, parts };
  }

  /* ---------- soccer: Poisson goals with Dixon–Coles ---------- */
  const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
  function goalProbs(lh, la, rho) {
    let h = 0, d = 0, a = 0;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
      let p = pois(i, lh) * pois(j, la);
      if (i === 0 && j === 0) p *= 1 - lh * la * rho; else if (i === 0 && j === 1) p *= 1 + lh * rho; else if (i === 1 && j === 0) p *= 1 + la * rho; else if (i === 1 && j === 1) p *= 1 - rho;
      if (i > j) h += p; else if (i === j) d += p; else a += p;
    }
    const t = h + d + a; return { h: h / t, d: d / t, a: a / t };
  }
  const soccerTeam = (M, id) => teamOf(M, id) || { att: -.1, def: .1 };
  function predictSoccer(M, homeId, awayId, ctx) {
    if (!M || !M.teams || M.mu == null) return null;
    if (!teamOf(M, homeId) && !teamOf(M, awayId)) return null;
    const H = soccerTeam(M, homeId), A = soccerTeam(M, awayId), home = ctx && ctx.neutral ? 0 : M.home;
    const lh = Math.exp(M.mu + home + H.att + A.def), la = Math.exp(M.mu + A.att + H.def);
    return { ...goalProbs(lh, la, M.rho || 0), lh, la };
  }

  /* ---------- blend with the betting market ---------- */
  // mk: { fairH, fairD?, fairA?, openH?, openD?, openA? } (fair = margin removed)
  function fair(mlH, mlA, mlD) {
    const pH = implied(mlH), pA = implied(mlA), pD = implied(mlD);
    if (pH == null || pA == null) return null;
    if (pD != null) { const t = pH + pA + pD; return { h: pH / t, d: pD / t, a: pA / t }; }
    return { h: pH / (pH + pA), a: pA / (pH + pA) };
  }
  function blend2(B, pm, mkH, openH) {
    if (mkH == null) return pm;
    if (!B) return (pm + mkH) / 2;
    const mv = openH != null ? logit(mkH) - logit(openH) : 0;
    return sigm(B.a + B.wm * logit(pm) + B.wk * logit(mkH) + (B.wv || 0) * mv);
  }
  function blend3(B, pm, mk, open) {
    if (!mk) return pm;
    const wm = B ? B.wm : .5, wk = B ? B.wk : .5, wv = B ? B.wv || 0 : 0;
    const k = ['h', 'd', 'a'], s = {};
    k.forEach(o => { const mv = open && open[o] ? Math.log(clamp(mk[o])) - Math.log(clamp(open[o])) : 0; s[o] = Math.exp(wm * Math.log(clamp(pm[o])) + wk * Math.log(clamp(mk[o])) + wv * mv + (B && B.b ? B.b[o] || 0 : 0)); });
    const t = s.h + s.d + s.a; return { h: s.h / t, d: s.d / t, a: s.a / t };
  }

  const api = { FEATURES, LEGACY, kindOf, SIT, Phi, logit, sigm, implied, fair, newTeam, features, predictUS, predictSoccer, goalProbs, blend2, blend3,
    nbaRating, nbaMissing, goalieQ, spValue, qbValue, NBA_REPL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SidelineModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
