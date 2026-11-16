// Moneylines from several sportsbooks (DraftKings, FanDuel, BetMGM) via TheRundown's free plan.
// Used by the hourly record: a consensus "fair" chance across books is a sharper benchmark than one book,
// and each pick can show the best available price. The key lives in the RUNDOWN_KEY repository secret.
// Free plan: 1 request a second, 20,000 data points a day, 200,000 a month, so this fetches moneylines only,
// only for days with games still to start, and only every other hour.
import fs from 'node:fs/promises';
const DATA = new URL('../data/', import.meta.url);
const KEY = process.env.RUNDOWN_KEY || '';
const BOOKS = { 19: 'dk', 23: 'fd', 22: 'mgm' };
export const BOOK_NAMES = { dk: 'DraftKings', fd: 'FanDuel', mgm: 'BetMGM' };
const SPORT_ID = { nba: 4, nfl: 2, mlb: 3, nhl: 6, 'eng.1': 11, 'esp.1': 14, 'ger.1': 13, 'ita.1': 15, 'fra.1': 12, 'usa.1': 10, 'mex.1': 34, 'uefa.champions': 16 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const read = async (n, d) => { try { return JSON.parse(await fs.readFile(new URL(n, DATA), 'utf8')); } catch { return d; } };
let last = 0, remaining = Infinity;
const NAMES = {};
async function call(path) {
  await sleep(Math.max(0, 1250 - (Date.now() - last))); last = Date.now();
  const r = await fetch('https://therundown.io/api/v2' + path, { headers: { 'X-TheRundown-Key': KEY } });
  const rem = +r.headers.get('x-datapoints-monthly-remaining'), day = +r.headers.get('x-datapoints-remaining');
  if (isFinite(rem)) remaining = Math.min(rem, isFinite(day) ? day : rem);
  return r.ok ? r.json() : null;
}
const same = (espn, rd) => { const a = norm(espn.displayName), b = norm(`${rd.name} ${rd.mascot || ''}`), c = norm(rd.name), s = norm(espn.shortDisplayName);
  return a === b || a === c || (espn.abbreviation && espn.abbreviation === rd.abbreviation && (a.includes(c) || c.includes(s))) || (c.length >= 5 && (a.includes(c) || c.includes(a))) || (s.length >= 5 && c.includes(s)); };

/* books for the upcoming games of one league: { espnEventId: { dk: [home, away, draw?], fd: [...], mgm: [...] } } */
async function fetchLeague(lg, evs, log) {
  const sid = SPORT_ID[lg], now = Date.now();
  const up = evs.filter(ev => { const t = new Date(ev.date).getTime(); return t > now && t - now < 40 * 3600e3; });
  if (!sid || !up.length) return {};
  const out = {};
  for (const d of [...new Set(up.map(ev => new Date(ev.date).toISOString().slice(0, 10)))]) {
    if (remaining < 4000) { log(`${lg}: odds budget nearly used up, skipping`); break; }
    const j = await call(`/sports/${sid}/events/${d}?market_ids=1&affiliate_ids=19,22,23&main_line=true`).catch(() => null);
    (j?.events || []).forEach(re => {
      const T = re.teams_normalized || re.teams || [], rh = T.find(t => t.is_home), ra = T.find(t => t.is_away); if (!rh || !ra) return;
      const t = new Date(re.event_date).getTime();
      const ev = up.find(e => { const c = e.competitions?.[0]?.competitors || [], h = c.find(x => x.homeAway === 'home'), a = c.find(x => x.homeAway === 'away');
        return h && a && Math.abs(new Date(e.date).getTime() - t) < 6 * 3600e3 && same(h.team, rh) && same(a.team, ra); });
      const m = (re.markets || []).find(x => x.market_id === 1 && (x.period_id ?? 0) === 0); if (!ev || !m) return;
      const price = (p, aff) => { const v = p?.lines?.[0]?.prices?.[aff]?.price; return typeof v === 'number' && Math.abs(v) >= 100 && Math.abs(v) < 20000 ? Math.round(v) : null; };
      const ph = m.participants.find(p => p.id === rh.team_id), pa = m.participants.find(p => p.id === ra.team_id), pd = m.participants.find(p => p.type === 'TYPE_RESULT');
      const rec = {};
      Object.entries(BOOKS).forEach(([aff, k]) => { const h = price(ph, aff), a = price(pa, aff), dr = pd ? price(pd, aff) : null; if (h != null && a != null && (!pd || dr != null)) rec[k] = pd ? [h, a, dr] : [h, a]; });
      if (Object.keys(rec).length) { out[String(ev.id)] = rec; const c = ev.competitions[0].competitors; NAMES[String(ev.id)] = [c.find(x => x.homeAway === 'home').team.abbreviation || '', c.find(x => x.homeAway === 'away').team.abbreviation || '']; }
    });
  }
  return out;
}
/* called once per sport by the hourly record; leagues: [[leagueKey, events]] */
export async function loadBooks(file, leagues, log) {
  const store = await read(`books-${file}.json`, { updated: null, ev: {}, names: {} }); store.names ||= {};
  const upIds = new Set(leagues.flatMap(([, evs]) => evs.filter(e => new Date(e.date) > new Date()).map(e => String(e.id))));
  Object.keys(store.ev).forEach(id => { if (!upIds.has(id)) { delete store.ev[id]; delete store.names[id]; } });           // started or gone: the record keeps its own copy
  const due = !store.updated || Date.now() - new Date(store.updated) > 110 * 60e3;
  if (KEY && due && upIds.size) {
    try { let n = 0; for (const [lg, evs] of leagues) { const got = await fetchLeague(lg, evs, log); Object.assign(store.ev, got); Object.keys(got).forEach(id => { store.names[id] = NAMES[id]; }); n += Object.keys(got).length; }
      store.updated = new Date().toISOString(); log(`${file}: sportsbook prices for ${n} upcoming games (DraftKings, FanDuel, BetMGM)`); }
    catch (e) { log(`${file}: sportsbook prices skipped — ${e.message}`); }
  }
  await fs.writeFile(new URL(`books-${file}.json`, DATA), JSON.stringify(store));
  return store.ev;
}
const imp = ml => ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);
/* consensus fair chances across books (each book's margin removed first), and the best price per side */
export function consensus(rec) {
  const ks = Object.keys(rec || {}); if (!ks.length) return null;
  const fair = ks.map(k => { const p = rec[k].map(imp), t = p.reduce((s, v) => s + v, 0); return p.map(v => v / t); });
  const avg = fair[0].map((_, i) => fair.reduce((s, f) => s + f[i], 0) / fair.length);
  const best = avg.map((_, i) => ks.map(k => ({ b: k, ml: rec[k][i] })).sort((x, y) => y.ml - x.ml)[0]);
  return { n: ks.length, h: avg[0], a: avg[1], d: avg[2] ?? null, best: { h: best[0], a: best[1], d: best[2] ?? null } };
}
