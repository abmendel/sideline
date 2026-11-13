// Sideline pick record — the permanent history behind the Picks tab.
// Runs every hour on GitHub Actions (.github/workflows/ledger.yml) and writes data/ledger-<sport>.json:
//   picks    the model's side in every game, refreshed until the game starts, then locked and graded
//   day      pick of the day (pick of the week for the NFL): the single most likely winner
//   parlays  each day's suggested parlay: the four most likely winners that have a DraftKings line
// The dashboards merge this file into what they show, so the record is the same on every device,
// survives site updates and fills in even on days nobody opens the site.
//   node learn/ledger.mjs            all sports
//   node learn/ledger.mjs nba soccer some sports
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { SPORTS, SOCCER_LEAGUES, featuresFor, probs3, oddsOf, Phi, newTeam, fetchJSON } from './learn.mjs';
const SM = createRequire(import.meta.url)('./predict.js');

const DATA = new URL('../data/', import.meta.url);
const API = p => `https://site.api.espn.com/apis/site/v2/sports/${p}`;
const TZ = 'America/Chicago';
const KEEP_DAYS = 200;
const dayKey = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d)).replace(/-/g, '');
const etDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d)).replace(/-/g, '');
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
const sv = s => s == null ? null : typeof s === 'object' ? num(s.displayValue ?? s.value) : num(s);
const logit = p => Math.log(Math.min(.99, Math.max(.01, p)) / (1 - Math.min(.99, Math.max(.01, p))));
const r4 = v => v == null ? null : +(+v).toFixed(4);
const slim = t => t ? { id: String(t.id ?? ''), abbreviation: t.abbreviation || '', shortDisplayName: t.shortDisplayName || t.displayName || t.name || '', displayName: t.displayName || t.name || '', logo: t.logo || t.logos?.[0]?.href || '' } : null;

async function readJSON(name, d) { try { return JSON.parse(await fs.readFile(new URL(name, DATA), 'utf8')); } catch { return d; } }
async function writeJSON(name, v) { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(new URL(name, DATA), JSON.stringify(v)); }

const compsOf = ev => { const c = ev?.competitions?.[0]; const cs = c?.competitors || []; return { c, home: cs.find(x => x.homeAway === 'home'), away: cs.find(x => x.homeAway === 'away') }; };
const stateOf = ev => { const st = ev?.competitions?.[0]?.status?.type || ev?.status?.type || {}; return st.completed ? 'post' : st.state || 'pre'; };
const oddStatus = ev => /postpon|cancel|suspend|delay|forfeit|abandon/i.test(ev?.competitions?.[0]?.status?.type?.name || ev?.status?.type?.name || '');
const started = (e, now) => new Date(e.date) <= now;
let LIVE = {};                                   // event id -> scoreboard event seen this run
const locked = (e, now) => !!e && (!!e.result || started(e, now) || (LIVE[e.evId] && stateOf(LIVE[e.evId]) !== 'pre'));

/* opening line (margin removed) from the scoreboard's DraftKings odds */
function openOf(ev) {
  const list = ev?.competitions?.[0]?.odds || [], o = list.find(x => /draftkings/i.test(x.provider?.name || '')) || list[0], ml = o?.moneyline || {};
  const f = SM.fair(num(ml.home?.open?.odds), num(ml.away?.open?.odds), ml.draw ? num(ml.draw?.open?.odds) : null);
  return f;
}
/* what the v2 model needs to know about who plays: starters from the scoreboard, injuries from ESPN */
const INJ = {};
async function injuriesFor(sp) {
  if (INJ[sp]) return INJ[sp];
  const d = await fetchJSON(`${API(SPORTS[sp].path)}/injuries`).catch(() => null), out = {};
  (d?.injuries || []).forEach(t => (t.injuries || []).forEach(i => {
    const a = i.athlete || {}, link = (a.links || []).map(l => l.href).find(h => /\/id\/\d+/.test(h || '')) || '', pid = (link.match(/\/id\/(\d+)/) || [])[1] || a.id;
    const tid = String(a.team?.id || t.id || ''); if (!pid || !tid) return;
    (out[tid] ||= []).push({ id: String(pid), sit: SM.SIT(i.status || i.type?.description || ''), pos: a.position?.abbreviation || '' });
  }));
  return INJ[sp] = out;
}
function inputsFor(sp, ev, M, inj) {
  const { home, away } = compsOf(ev), h = String(home.team?.id ?? home.id), a = String(away.team?.id ?? away.id), inp = {};
  const prob = c => { const p = (c?.probables || []).find(x => /starting/i.test(x.name || '') || /^(SP|SG)$/.test(x.abbreviation || '')) || c?.probables?.[0]; return p?.athlete?.id ? String(p.athlete.id) : undefined; };
  if (sp === 'mlb') { inp.spH = prob(home); inp.spA = prob(away); }
  if (sp === 'nhl') { inp.gH = prob(home); inp.gA = prob(away); }
  if (sp === 'nba' && inj) { inp.outH = (inj[h] || []).filter(x => x.sit > 0); inp.outA = (inj[a] || []).filter(x => x.sit > 0); }
  if (sp === 'nfl' && inj) { const out = t => { const q = M.teams[t]?.qb; return q && (inj[t] || []).some(x => x.id === String(q) && x.sit >= .8); }; if (out(h)) inp.qbH = null; if (out(a)) inp.qbA = null; }
  return inp;
}
/* the model's numbers for one game, the same recipe the dashboards use: learned model blended with DraftKings (margin removed) */
function rate(ev, M, S, inp) {
  const { c, home, away } = compsOf(ev); if (!home || !away) return null;
  const h = String(home.team?.id ?? home.id), a = String(away.team?.id ?? away.id);
  const o = oddsOf(ev);
  if (M && M.version >= 2) {
    if (S.draws) {
      const pm = SM.predictSoccer(M, h, a, { neutral: !!c?.neutralSite }), mk = o && o.fairD != null ? { h: o.fairH, d: o.fairD, a: o.fairA } : null;
      if (!pm && !mk) return null;
      const p = pm && mk ? SM.blend3(M.blend, pm, mk, openOf(ev)) : (pm || mk);
      return { home, away, p, pm, mk, o };
    }
    const r = SM.predictUS(M, h, a, { date: ev.date, neutral: !!c?.neutralSite, inputs: inp || {} }), mkH = o?.fairH ?? null, op = openOf(ev);
    if (!r && mkH == null) return null;
    const pH = !r ? mkH : SM.blend2(M.blend, r.p, mkH, op ? op.h : null);
    return { home, away, p: { h: pH, a: 1 - pH }, pm: r && { h: r.p, a: 1 - r.p }, mk: mkH == null ? null : { h: mkH, a: 1 - mkH }, o };
  }
  let pm = null;
  if (M && (M.teams[h] || M.teams[a])) {
    const x = featuresFor(M.teams[h] || newTeam(), M.teams[a] || newTeam(), ev.date, !!c?.neutralSite, S);
    const m = M.w.reduce((s, v, i) => s + v * x[i], 0);
    pm = S.draws ? probs3(m, M.sigma, S) : { h: Phi(m / M.sigma) };
  }
  if (S.draws) {
    const mk = o && o.fairD != null ? { h: o.fairH, d: o.fairD, a: o.fairA } : null;
    if (!pm && !mk) return null;
    const p = pm && mk ? { h: (pm.h + mk.h) / 2, d: (pm.d + mk.d) / 2, a: (pm.a + mk.a) / 2 } : (pm || mk);
    return { home, away, p, pm, mk, o };
  }
  const mkH = o?.fairH ?? null;
  if (pm == null && mkH == null) return null;
  const B = M?.blend;
  const pH = pm == null ? mkH : mkH == null ? pm.h : B ? 1 / (1 + Math.exp(-(B.a + B.wModel * logit(pm.h) + B.wMarket * logit(mkH)))) : (pm.h + mkH) / 2;
  return { home, away, p: { h: pH, a: 1 - pH }, pm: pm && { h: pm.h, a: 1 - pm.h }, mk: mkH == null ? null : { h: mkH, a: 1 - mkH }, o };
}

/* the 'Best value' parlay: the four biggest edges over DraftKings' fair price, one per game */
function saveValueParlay(L, list, now) {
  const legs = list.slice().sort((x, y) => y.edge - x.edge).slice(0, 4);
  if (legs.length < 2) return 0;
  const pk = dayKey(legs.slice().sort((x, y) => new Date(x.date) - new Date(y.date))[0].date), cur = L.vparlays[pk];
  if (cur && cur.legs.some(l => locked(l, now))) return 0;
  const nx = { key: pk, legs: legs.map(({ edge, day, week, ...l }) => l) }, sig = P => P ? P.legs.map(l => l.evId + ':' + l.side + ':' + l.p + ':' + l.ml).join('|') : '';
  if (sig(cur) === sig(nx)) return 0;
  L.vparlays[pk] = { ...nx, savedAt: now.toISOString() }; return 1;
}
/* grade a saved entry from a finished game's competitors */
function grade(e, ev) {
  if (e.result || stateOf(ev) !== 'post' || oddStatus(ev)) return false;
  const { home, away } = compsOf(ev); const hs = sv(home?.score), as = sv(away?.score);
  if (hs == null || as == null) return false;
  const res = hs > as ? 'home' : as > hs ? 'away' : 'draw';
  e.result = res === e.side ? 'W' : 'L';
  if (res === 'draw' && e.side !== 'draw' && !e.lg) e.result = 'P';      // a US tie (NFL) is a push
  const me = e.side === 'away' ? [as, hs] : [hs, as];
  e.final = e.lg ? `${e.home?.abbreviation || ''} ${hs}–${as} ${e.away?.abbreviation || ''}` : `${e.team?.abbreviation || ''} ${me[0]}–${me[1]} ${e.opp?.abbreviation || ''}`;
  return true;
}

async function scoreboards(path, dates) {
  const out = [];
  for (const d of dates) { const sb = await fetchJSON(`${API(path)}/scoreboard?dates=${d}&limit=300`); (sb?.events || []).forEach(ev => out.push(ev)); }
  return out;
}

async function runSport(sp, log) {
  const S = SPORTS[sp], now = new Date();
  const L = await readJSON(`ledger-${sp}.json`, { picks: {}, day: {}, parlays: {} }); L.vparlays ||= {};
  const M = await readJSON(`model-${sp}.json`, null);
  const upcoming = [0, 1, 2].map(i => etDay(new Date(now.getTime() + i * 864e5)));
  const open = Object.values(L.picks).filter(e => !e.result && new Date(e.date) < now);
  const back = [...new Set(open.flatMap(e => [etDay(e.date), etDay(new Date(new Date(e.date).getTime() - 864e5))]))].slice(-20);
  let evs = await scoreboards(S.path, [...new Set([...back, ...upcoming])]);
  if (S.mode === 'week') { const cur = await fetchJSON(`${API(S.path)}/scoreboard?limit=300`); (cur?.events || []).forEach(ev => evs.push(ev)); }
  const byId = {}; evs.forEach(ev => { byId[String(ev.id)] = ev; });
  evs = Object.values(byId); LIVE = byId;
  let ch = 0;
  // 1. every game's pick: refresh while the game is still ahead
  const fresh = [], vfresh = [];
  const inj = (sp === 'nba' || sp === 'nfl') && M && M.version >= 2 ? await injuriesFor(sp) : null;
  evs.forEach(ev => {
    const id = String(ev.id), cur = L.picks[id];
    if (stateOf(ev) !== 'pre' || oddStatus(ev) || started(ev, now)) return;
    if (locked(cur, now)) return;
    const r = rate(ev, M, S, M && M.version >= 2 ? inputsFor(sp, ev, M, inj) : null); if (!r) return;
    const side = r.p.h >= r.p.a ? 'home' : 'away', t = side === 'home' ? r.home : r.away, op = side === 'home' ? r.away : r.home;
    const e = { evId: id, day: dayKey(ev.date), date: ev.date, side, team: slim(t.team), opp: slim(op.team), p: r4(r.p[side[0]]), model: r4(r.pm?.[side[0]]), market: r4(r.mk?.[side[0]]), ml: (side === 'home' ? r.o?.mlH : r.o?.mlA) ?? null, result: null, final: '' };
    if (S.mode === 'week') e.week = `${ev.season?.year}-${ev.season?.type}-${ev.week?.number}`;
    if (r.mk) { const vs = ['home', 'away'].map(sd => ({ sd, edge: r.p[sd[0]] - r.mk[sd[0]] })).sort((x, y) => y.edge - x.edge)[0], vt = vs.sd === 'home' ? r.home : r.away, vo = vs.sd === 'home' ? r.away : r.home, vml = vs.sd === 'home' ? r.o?.mlH : r.o?.mlA;
      if (vs.edge > .01 && vml != null) vfresh.push({ evId: id, day: e.day, week: e.week, date: ev.date, side: vs.sd, team: slim(vt.team), opp: slim(vo.team), p: r4(r.p[vs.sd[0]]), market: r4(r.mk[vs.sd[0]]), edge: vs.edge, ml: vml, result: null, final: '' }); }
    if (!cur || cur.side !== e.side || Math.abs(cur.p - e.p) >= .002 || cur.ml !== e.ml || cur.date !== e.date) { L.picks[id] = e; ch++; }
    fresh.push(L.picks[id]);
  });
  // 2. pick of the day (week for the NFL) and the day's parlay, from games not yet started
  const groups = {};
  fresh.forEach(e => (groups[S.mode === 'week' ? e.week : e.day] ||= []).push(e));
  Object.entries(groups).forEach(([k, list]) => {
    const prev = L.day[k];
    if (!locked(prev, now)) {
      const top = list.slice().sort((x, y) => y.p - x.p)[0];
      if (top && (!prev || prev.evId !== top.evId || prev.p !== top.p || prev.ml !== top.ml)) { L.day[k] = { key: k, ...top }; ch++; }
    }
    const legs = list.filter(e => e.ml != null).sort((x, y) => y.p - x.p).slice(0, 4);
    if (legs.length >= 2) {
      const pk = dayKey(legs[0].date), cur = L.parlays[pk];
      const sig = P => P ? P.legs.map(l => l.evId + ':' + l.p + ':' + l.ml).join('|') : '';
      const nxt = { key: pk, legs: legs.map(e => ({ evId: e.evId, date: e.date, side: e.side, team: e.team, opp: e.opp, p: e.p, ml: e.ml, result: null, final: '' })) };
      if (!(cur && cur.legs.some(l => locked(l, now))) && sig(cur) !== sig(nxt)) { L.parlays[pk] = { ...nxt, savedAt: now.toISOString() }; ch++; }
    }
  });
  const vgroups = {}; vfresh.forEach(e => (vgroups[S.mode === 'week' ? e.week : e.day] ||= []).push(e));
  Object.values(vgroups).forEach(list => { ch += saveValueParlay(L, list, now); });
  Object.entries(L.day).forEach(([k, d]) => { const e = L.picks[d.evId]; if (e && !locked(d, now) && (S.mode === 'week' ? e.week : e.day) !== k) { delete L.day[k]; ch++; } });   // a game moved to another day
  // 3. grade everything that has finished
  const all = [...Object.values(L.picks), ...Object.values(L.day), ...Object.values(L.parlays).flatMap(P => P.legs), ...Object.values(L.vparlays).flatMap(P => P.legs)];
  all.forEach(e => { const ev = byId[e.evId]; if (ev && grade(e, ev)) ch++; });
  // 4. keep the file a sensible size
  const cut = dayKey(new Date(now.getTime() - KEEP_DAYS * 864e5));
  Object.keys(L.picks).forEach(k => { if (L.picks[k].day < cut) { delete L.picks[k]; ch++; } });
  [L.parlays, L.vparlays].forEach(o => Object.keys(o).forEach(k => { if (k < cut) { delete o[k]; ch++; } }));
  Object.keys(L.day).forEach(k => { if ((L.day[k].day || k) < cut) { delete L.day[k]; ch++; } });
  if (ch) { L.updated = now.toISOString(); await writeJSON(`ledger-${sp}.json`, L); }
  const g = Object.values(L.picks).filter(e => e.result === 'W' || e.result === 'L'), w = g.filter(e => e.result === 'W').length;
  log(`${sp}: ${Object.keys(L.picks).length} picks saved (${w}–${g.length - w} graded), ${Object.keys(L.day).length} picks of the ${S.mode === 'week' ? 'week' : 'day'}, ${Object.keys(L.parlays).length} parlays · ${ch} changes`);
}

/* Soccer: one file for every trained league. Every match gets the most likely result (home · draw · away);
   pick of the day and parlays use teams to win, from matches with a DraftKings line, like the dashboard. */
async function runSoccer(log) {
  const now = new Date();
  const L = await readJSON('ledger-soccer.json', { picks: {}, day: {}, parlays: {} }); L.vparlays ||= {};
  const upcoming = [0, 1, 2].map(i => etDay(new Date(now.getTime() + i * 864e5)));
  const byId = {}, lgOf = {};
  for (const lg of SOCCER_LEAGUES) {
    const S = SPORTS[lg], M = await readJSON(`model-${lg}.json`, null);
    const open = Object.values(L.picks).filter(e => e.lg === lg && !e.result && new Date(e.date) < now);
    const back = [...new Set(open.flatMap(e => [etDay(e.date), etDay(new Date(new Date(e.date).getTime() - 864e5))]))].slice(-10);
    const evs = await scoreboards(S.path, [...new Set([...back, ...upcoming])]);
    evs.forEach(ev => { byId[String(ev.id)] = ev; lgOf[String(ev.id)] = { lg, S, M }; });
  }
  LIVE = byId;
  let ch = 0;
  const cands = [];
  Object.values(byId).forEach(ev => {
    const id = String(ev.id), { lg, S, M } = lgOf[id], cur = L.picks[id];
    if (stateOf(ev) !== 'pre' || oddStatus(ev) || started(ev, now)) return;
    const r = rate(ev, M, S); if (!r) return;
    const side = r.p.h >= r.p.a && r.p.h >= r.p.d ? 'home' : r.p.a >= r.p.d ? 'away' : 'draw', k = side === 'draw' ? 'd' : side[0];
    if (!locked(cur, now)) {
      const e = { evId: id, lg, day: dayKey(ev.date), date: ev.date, side, home: slim(r.home.team), away: slim(r.away.team), p: r4(r.p[k]), ml: (side === 'home' ? r.o?.mlH : side === 'away' ? r.o?.mlA : r.o?.mlD) ?? null, result: null, final: '' };
      if (!cur || cur.side !== e.side || Math.abs(cur.p - e.p) >= .002 || cur.ml !== e.ml || cur.date !== e.date) { L.picks[id] = e; ch++; }
    }
    if (r.mk) [['home', r.home, r.away], ['away', r.away, r.home]].forEach(([s, t, op]) => {
      const kk = s[0], ml = s === 'home' ? r.o?.mlH : r.o?.mlA;
      cands.push({ evId: id, lg, day: dayKey(ev.date), date: ev.date, side: s, team: slim(t.team), opp: slim(op.team), p: r4(r.p[kk]), model: r4(r.pm?.[kk]), market: r4(r.mk[kk]), ml: ml ?? null, result: null, final: '' });
    });
  });
  const groups = {}; cands.forEach(c => (groups[c.day] ||= []).push(c));
  Object.values(groups).forEach(list => { const best = {}; list.filter(c => c.ml != null && c.market != null && c.p - c.market > .01).forEach(c => { const e = { ...c, edge: c.p - c.market }; if (!best[c.evId] || e.edge > best[c.evId].edge) best[c.evId] = e; }); ch += saveValueParlay(L, Object.values(best), now); });
  Object.entries(groups).forEach(([k, list]) => {
    list.sort((x, y) => y.p - x.p);
    const prev = L.day[k], top = list[0];
    if (!locked(prev, now) && top && (!prev || prev.evId !== top.evId || prev.side !== top.side || prev.p !== top.p)) { L.day[k] = { key: k, ...top }; ch++; }
    const uniq = []; list.filter(c => c.ml != null).forEach(c => { if (!uniq.some(u => u.evId === c.evId)) uniq.push(c); });
    const legs = uniq.slice(0, 4), cur = L.parlays[k];
    if (legs.length >= 2 && !(cur && cur.legs.some(l => locked(l, now)))) {
      const sig = P => P ? P.legs.map(l => l.evId + ':' + l.side + ':' + l.p + ':' + l.ml).join('|') : '';
      const nxt = { key: k, legs: legs.map(c => ({ evId: c.evId, lg: c.lg, date: c.date, side: c.side, team: c.team, opp: c.opp, p: c.p, ml: c.ml, result: null, final: '' })) };
      if (sig(cur) !== sig(nxt)) { L.parlays[k] = { ...nxt, savedAt: now.toISOString() }; ch++; }
    }
  });
  Object.entries(L.day).forEach(([k, d]) => { const e = L.picks[d.evId]; if (e && !locked(d, now) && e.day !== k) { delete L.day[k]; ch++; } });
  // grading: every-match picks score home · draw · away; day picks and parlay legs need the team to win
  const gradeTeam = (e, ev) => {
    if (e.result || stateOf(ev) !== 'post' || oddStatus(ev)) return false;
    const { home, away } = compsOf(ev); const hs = sv(home?.score), as = sv(away?.score); if (hs == null || as == null) return false;
    const me = e.side === 'home' ? [hs, as] : [as, hs];
    e.result = me[0] > me[1] ? 'W' : 'L'; if (me[0] === me[1]) e.draw = true;
    e.final = `${e.team?.abbreviation || ''} ${me[0]}–${me[1]} ${e.opp?.abbreviation || ''}`; return true;
  };
  Object.values(L.picks).forEach(e => { const ev = byId[e.evId]; if (ev && grade(e, ev)) ch++; });
  [...Object.values(L.day), ...Object.values(L.parlays).flatMap(P => P.legs), ...Object.values(L.vparlays).flatMap(P => P.legs)].forEach(e => { const ev = byId[e.evId]; if (ev && gradeTeam(e, ev)) ch++; });
  const cut = dayKey(new Date(now.getTime() - KEEP_DAYS * 864e5));
  Object.keys(L.picks).forEach(k => { if (L.picks[k].day < cut) { delete L.picks[k]; ch++; } });
  [L.parlays, L.vparlays, L.day].forEach(o => Object.keys(o).forEach(k => { if (k < cut) { delete o[k]; ch++; } }));
  if (ch) { L.updated = now.toISOString(); await writeJSON('ledger-soccer.json', L); }
  const g = Object.values(L.picks).filter(e => e.result), w = g.filter(e => e.result === 'W').length;
  log(`soccer: ${Object.keys(L.picks).length} picks saved (${w}–${g.length - w} graded), ${Object.keys(L.day).length} picks of the day, ${Object.keys(L.parlays).length} parlays · ${ch} changes`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const want = process.argv.slice(2);
  const list = want.length ? want : ['nba', 'nfl', 'mlb', 'nhl', 'soccer'];
  for (const sp of list) {
    try { if (sp === 'soccer') await runSoccer(console.log); else await runSport(sp, console.log); }
    catch (e) { console.error(`${sp}: failed — ${e.stack || e.message}`); process.exitCode = 1; }
  }
}
export { runSport, runSoccer, rate, grade, dayKey };
