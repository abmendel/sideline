// temporary: print the shape of ESPN data for past games (deleted after the model upgrade)
const get = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : { _status: r.status }; } catch (e) { return { _err: e.message }; } };
const cut = (v, n = 2500) => { const s = JSON.stringify(v) ?? "undefined"; return s.length > n ? s.slice(0, n) + '…' : s; };
const strip = (o, depth = 0) => { if (Array.isArray(o)) return o.slice(0, 3).map(x => strip(x, depth + 1)); if (o && typeof o === 'object') { const r = {}; Object.entries(o).forEach(([k, v]) => { if (/^(links|logos?|headshot|\$ref|uid|guid|images?|alternateIds)$/.test(k)) return; r[k] = depth > 6 ? (typeof v === 'object' ? '[obj]' : v) : strip(v, depth + 1); }); return r; } return o; };
const S = { nba: ['basketball/nba', '20260115'], nfl: ['football/nfl', '20251109'], mlb: ['baseball/mlb', '20250715'], nhl: ['hockey/nhl', '20260115'], epl: ['soccer/eng.1', '20260117'] };
for (const [k, [p, d]] of Object.entries(S)) {
  console.log(`\n######## ${k}`);
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${p}/scoreboard?dates=${d}&limit=50`);
  const ev = sb.events?.[0]; if (!ev) { console.log('no events', cut(sb, 300)); continue; }
  const c = ev.competitions[0];
  console.log('SB keys', Object.keys(c).join(','));
  console.log('SB odds', cut(strip(c.odds), 2000));
  console.log('SB competitor keys', Object.keys(c.competitors[0]).join(','), 'probables', cut(strip(c.competitors[0].probables), 800), 'stats', cut(strip(c.competitors[0].statistics), 800), 'leaders', cut(strip(c.competitors[0].leaders?.map(l => ({ n: l.name, a: l.leaders?.[0]?.athlete?.displayName })) ), 400));
  const sm = await get(`https://site.api.espn.com/apis/site/v2/sports/${p}/summary?event=${ev.id}`);
  console.log('SUM keys', Object.keys(sm).join(','));
  console.log('SUM pickcenter', cut(strip(sm.pickcenter), 1500));
  console.log('SUM odds', cut(strip(sm.odds), 600));
  const bt = sm.boxscore?.teams?.[0];
  console.log('BOX team stats', cut((bt?.statistics || []).map(s => `${s.name}|${s.label}|${s.displayValue}`), 1500));
  (sm.boxscore?.players?.[0]?.statistics || []).forEach(g => console.log('BOX players group', g.name || g.type || g.text, '| keys', (g.keys || []).join(','), '| labels', (g.labels || []).join(','), '| n', g.athletes?.length, '| first', cut(strip(g.athletes?.[0]), 500)));
  if (sm.rosters) console.log('ROSTERS', cut(strip(sm.rosters?.[0]?.roster?.slice(0, 2)), 800));
  const core = await get(`https://sports.core.api.espn.com/v2/sports/${p.split('/')[0]}/leagues/${p.split('/')[1]}/events/${ev.id}/competitions/${ev.id}/odds`);
  console.log('CORE odds count', core.count, 'providers', (core.items || []).map(i => i.provider?.name + ':' + i.provider?.id).join(','));
  const dk = (core.items || []).find(i => /draftkings/i.test(i.provider?.name || '')) || core.items?.[0];
  console.log('CORE dk', cut(strip(dk), 2500));
}
// upcoming probables
for (const [k, p] of [['mlb', 'baseball/mlb'], ['nhl', 'hockey/nhl'], ['nfl', 'football/nfl']]) {
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${p}/scoreboard`);
  const ev = sb.events?.find(e => e.status?.type?.state === 'pre') || sb.events?.[0];
  console.log(`\n## upcoming ${k}`, ev?.id, 'probables', cut(strip(ev?.competitions?.[0]?.competitors?.map(c => c.probables)), 1200));
}
const inj = await get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
console.log('\n## nfl injuries', cut(strip(inj.injuries?.[0]?.injuries?.slice(0, 2)), 1200));
const dc = await get('https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/12/depthcharts');
console.log('\n## nfl depth', cut(strip(dc.items?.[0]?.positions?.qb || dc), 1200));
