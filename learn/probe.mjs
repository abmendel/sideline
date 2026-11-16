// temporary: which free public data sources can the GitHub jobs reach, and what do they hold?
const head = async (u, n = 400) => { try { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 sideline' } }); const t = r.ok ? await r.text() : ''; return `${r.status} ${t.length}b :: ${t.slice(0, n).replace(/\s+/g, ' ')}`; } catch (e) { return 'ERR ' + e.message; } };
const size = async u => { try { const r = await fetch(u, { method: 'HEAD', redirect: 'follow' }); return `${r.status} ${r.headers.get('content-length')}b`; } catch (e) { return 'ERR ' + e.message; } };
console.log('FD E0 2526', await head('https://www.football-data.co.uk/mmz4281/2526/E0.csv', 900));
console.log('FD E0 2627', await head('https://www.football-data.co.uk/mmz4281/2627/E0.csv', 900));
console.log('FD USA', await head('https://www.football-data.co.uk/new/USA.csv', 500));
console.log('FD MEX', await head('https://www.football-data.co.uk/new/MEX.csv', 300));
for (const u of ['stats_team/stats_team_week_2025.csv', 'stats_team/stats_team_week_2026.csv', 'team_stats/stats_team_week_2025.csv', 'player_stats/stats_team_week_2025.csv', 'schedules/games.csv'])
  console.log('NFLV', u, await head(`https://github.com/nflverse/nflverse-data/releases/download/${u}`, 1200));
console.log('NFLV games', await head('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', 600));
for (const y of [2025, 2026]) console.log('NFLV pbp', y, await size(`https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${y}.csv.gz`));
const sch = await (await fetch('https://api-web.nhle.com/v1/schedule/2026-01-15')).json().catch(e => ({ err: e.message }));
const g = sch.gameWeek?.[0]?.games?.[0];
console.log('NHL schedule', JSON.stringify({ n: sch.gameWeek?.[0]?.games?.length, id: g?.id, away: g?.awayTeam?.abbrev, home: g?.homeTeam?.abbrev, err: sch.err }));
if (g) { const p = await (await fetch(`https://api-web.nhle.com/v1/gamecenter/${g.id}/play-by-play`)).json(); const shots = (p.plays || []).filter(x => /shot|goal/.test(x.typeDescKey)); console.log('NHL pbp plays', p.plays?.length, 'shots', shots.length, JSON.stringify(shots.slice(0, 2)), 'homeId', p.homeTeam?.id, p.homeTeam?.abbrev); }
console.log('METEO', await head('https://api.open-meteo.com/v1/forecast?latitude=43.07&longitude=-89.4&hourly=temperature_2m,wind_speed_10m,precipitation&forecast_days=1', 300));
console.log('MLB', await head('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-07-15', 300));
for (const p of ['basketball/nba', 'hockey/nhl', 'football/nfl']) { const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${p}/injuries`)).json().catch(() => ({})); const t = d.injuries?.[0], i = t?.injuries?.[0]; console.log('INJ', p, d.injuries?.length, 'teams; team id', t?.id, JSON.stringify({ status: i?.status, athlete: i?.athlete?.id, links: (i?.athlete?.links || []).slice(0, 1).map(l => l.href), team: i?.athlete?.team?.id })); }
