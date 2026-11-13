// Box scores and betting lines for every completed game, stored compactly in data/box/<sport>-<season>.json.
// Filled a batch at a time by the nightly trainer (newest games first) and then kept up to date.
// What is kept per game:
//   o   DraftKings (or ESPN BET) moneylines at the open and close: { h: [open, close], a: [...], d: [...] }
//   t   per team id: the few numbers the model uses
//       nba  [possessions, players: [[id, minutes, game score, starter]]]
//       nhl  [shots, goalies: [[id, shots against, goals against, minutes]]]
//       mlb  [starter: [id, outs, earned runs, walks, strikeouts, home runs, hits]]
//       nfl  [plays, yards, turnovers, qb: [id, attempts, yards, td, int, sacks, sack yards]]
//       soccer [shots, shots on target]
import fs from 'node:fs/promises';

const DATA = new URL('../data/box/', import.meta.url);
const SITE = p => `https://site.api.espn.com/apis/site/v2/sports/${p}`;
const CORE = p => { const [s, l] = p.split('/'); return `https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}`; };
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
const pair = v => { const m = /^\s*(\d+)\s*[-/]\s*(\d+)/.exec(String(v ?? '')); return m ? [+m[1], +m[2]] : [null, null]; };
const am = v => { const n = num(typeof v === 'object' ? v?.american ?? v?.odds ?? v?.alternateDisplayValue : v); return n == null || Math.abs(n) < 100 ? null : n; };
const kindOf = path => path.startsWith('soccer/') ? 'soccer' : path.split('/')[1];

export async function loadBox(sp) {
  const out = {};
  let files = [];
  const re = new RegExp(`^${sp.replace(/\./g, '\\.')}-\\d{4}\\.json$`);
  try { files = (await fs.readdir(DATA)).filter(f => re.test(f)); } catch {}
  for (const f of files) { try { Object.assign(out, JSON.parse(await fs.readFile(new URL(f, DATA), 'utf8'))); } catch {} }
  return out;
}
async function saveBox(sp, box, games) {
  await fs.mkdir(DATA, { recursive: true });
  const by = {};
  Object.entries(box).forEach(([id, b]) => { const s = games[id]?.season ?? b.s; if (s == null) return; (by[s] ||= {})[id] = { ...b, s }; });
  for (const [s, o] of Object.entries(by)) {
    const name = new URL(`${sp}-${s}.json`, DATA), txt = JSON.stringify(o);
    let old = null; try { old = await fs.readFile(name, 'utf8'); } catch {}
    if (old !== txt) await fs.writeFile(name, txt);
  }
}

/* ---------- odds: summary pickcenter first, the core odds feed when that is empty ---------- */
function oddsFromPick(pc) {
  const list = pc || [], o = list.find(x => /draftkings/i.test(x.provider?.name || '')) || list.find(x => !/live/i.test(x.provider?.name || '')) || null;
  if (!o) return null;
  const ml = o.moneyline || {};
  const side = (k, cur) => [am(ml[k]?.open?.odds), am(ml[k]?.close?.odds) ?? am(cur)];
  const r = { h: side('home', o.homeTeamOdds?.moneyLine), a: side('away', o.awayTeamOdds?.moneyLine) };
  if (o.drawOdds || ml.draw) r.d = side('draw', o.drawOdds?.moneyLine);
  return r.h[1] != null && r.a[1] != null ? r : null;
}
function oddsFromCore(items) {
  const list = (items || []).filter(x => !/live/i.test(x.provider?.name || ''));
  const o = list.find(x => /draft ?kings/i.test(x.provider?.name || '')) || list.find(x => /espn ?bet/i.test(x.provider?.name || '')) || list[0];
  if (!o) return null;
  const side = t => t ? [am(t.open?.moneyLine), am(t.close?.moneyLine) ?? am(t.current?.moneyLine) ?? am(t.moneyLine)] : [null, null];
  const r = { h: side(o.homeTeamOdds), a: side(o.awayTeamOdds) };
  if (o.drawOdds) r.d = side(o.drawOdds);
  return r.h[1] != null && r.a[1] != null ? r : null;
}

/* ---------- box score extraction ---------- */
function teamStats(sm) {
  const t = {};
  (sm.boxscore?.teams || []).forEach(x => { const m = {}; (x.statistics || []).forEach(s => { m[s.name] = s.displayValue; }); t[String(x.team?.id)] = m; });
  return t;
}
function groups(sm) {
  const t = {};
  (sm.boxscore?.players || []).forEach(x => { t[String(x.team?.id)] = x.statistics || []; });
  return t;
}
const statOf = (g, a, key) => { const i = (g.keys || []).indexOf(key); return i < 0 ? null : a.stats?.[i]; };
function extract(kind, sm) {
  const TS = teamStats(sm), PG = groups(sm), out = {};
  const ids = Object.keys(TS).length ? Object.keys(TS) : Object.keys(PG);
  for (const id of ids) {
    const ts = TS[id] || {}, gs = PG[id] || [];
    if (kind === 'nba') {
      const [, fga] = pair(ts['fieldGoalsMade-fieldGoalsAttempted']), [, fta] = pair(ts['freeThrowsMade-freeThrowsAttempted']);
      const oreb = num(ts.offensiveRebounds), tov = num(ts.totalTurnovers ?? ts.turnovers);
      const poss = fga != null && fta != null ? +(fga + .44 * fta - (oreb || 0) + (tov || 0)).toFixed(1) : null;
      const g = gs[0], pl = [];
      (g?.athletes || []).forEach(a => {
        if (a.didNotPlay || !a.stats?.length) return;
        const v = k => num(statOf(g, a, k)) || 0, min = v('minutes'); if (!min) return;
        const [fgm, fgaP] = pair(statOf(g, a, 'fieldGoalsMade-fieldGoalsAttempted')), [ftm, ftaP] = pair(statOf(g, a, 'freeThrowsMade-freeThrowsAttempted'));
        const gsc = v('points') + .4 * (fgm || 0) - .7 * (fgaP || 0) - .4 * ((ftaP || 0) - (ftm || 0)) + .7 * v('offensiveRebounds') + .3 * v('defensiveRebounds') + v('steals') + .7 * v('assists') + .7 * v('blocks') - .4 * v('fouls') - v('turnovers');
        pl.push([String(a.athlete?.id), min, +gsc.toFixed(1), a.starter ? 1 : 0]);
      });
      out[id] = [poss, pl];
    } else if (kind === 'nhl') {
      const g = gs.find(x => (x.keys || []).includes('saves') && (x.keys || []).includes('shotsAgainst'));
      const gl = (g?.athletes || []).map(a => { const toi = String(statOf(g, a, 'timeOnIce') || '0:00').split(':'); return [String(a.athlete?.id), num(statOf(g, a, 'shotsAgainst')) || 0, num(statOf(g, a, 'goalsAgainst')) || 0, +((+toi[0] || 0) + (+toi[1] || 0) / 60).toFixed(1)]; }).filter(x => x[3] > 0);
      out[id] = [num(ts.shotsTotal), gl];
    } else if (kind === 'mlb') {
      const g = gs.find(x => (x.keys || []).includes('earnedRuns'));
      const a = (g?.athletes || []).find(x => x.starter) || g?.athletes?.[0];
      if (a) {
        const ip = String(statOf(g, a, 'fullInnings.partInnings') || '0'), [w, f] = ip.split('.'), outs = (+w || 0) * 3 + (+f || 0);
        out[id] = [[String(a.athlete?.id), outs, num(statOf(g, a, 'earnedRuns')) || 0, num(statOf(g, a, 'walks')) || 0, num(statOf(g, a, 'strikeouts')) || 0, num(statOf(g, a, 'homeRuns')) || 0, num(statOf(g, a, 'hits')) || 0]];
      } else out[id] = [null];
    } else if (kind === 'nfl') {
      const g = gs.find(x => x.name === 'passing');
      let qb = null;
      (g?.athletes || []).forEach(a => {
        const [, att] = pair(statOf(g, a, 'completions/passingAttempts')), [sk, sky] = pair(statOf(g, a, 'sacks-sackYardsLost'));
        const row = [String(a.athlete?.id), att || 0, num(statOf(g, a, 'passingYards')) || 0, num(statOf(g, a, 'passingTouchdowns')) || 0, num(statOf(g, a, 'interceptions')) || 0, sk || 0, sky || 0];
        if (!qb || row[1] > qb[1]) qb = row;
      });
      out[id] = [num(ts.totalOffensivePlays), num(ts.totalYards), num(ts.turnovers), qb];
    } else {
      out[id] = [num(ts.totalShots), num(ts.shotsOnTarget)];
    }
  }
  return out;
}

/* ---------- fill in a batch of games that have no box score yet (newest first) ---------- */
export async function backfill(sp, S, store, fetchJSON, log, cap = 1200) {
  const kind = kindOf(S.path), box = await loadBox(sp);
  const want = Object.entries(store.games).filter(([id, g]) => g.done && (S.anyType || g.type === 2 || g.type === 3) && (!box[id] || (box[id].miss && box[id].miss < 3 && Date.now() - new Date(g.date) < 30 * 864e5))).sort((x, y) => new Date(y[1].date) - new Date(x[1].date)).slice(0, cap);
  let got = 0, odds = 0, i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < want.length) {
      const [id, g] = want[i++];
      const sm = await fetchJSON(`${SITE(S.path)}/summary?event=${id}`).catch(() => null);
      if (!sm) { box[id] = { miss: (box[id]?.miss || 0) + 1, s: g.season }; continue; }
      let o = oddsFromPick(sm.pickcenter) || oddsFromPick(sm.odds);
      if (!o) { const co = await fetchJSON(`${CORE(S.path)}/events/${id}/competitions/${id}/odds?limit=20`).catch(() => null); o = oddsFromCore(co?.items); }
      const t = extract(kind, sm);
      box[id] = { t, ...(o ? { o } : {}), s: g.season };
      got++; if (o) odds++;
    }
  }));
  await saveBox(sp, box, store.games);
  const total = Object.values(store.games).filter(g => g.done && (S.anyType || g.type === 2 || g.type === 3)).length, have = Object.values(box).filter(b => b.t).length;
  log(`${sp}: box scores ${have}/${total} games (+${got} this run, ${odds} with lines)`);
  return box;
}
export { extract, oddsFromPick, oddsFromCore };
