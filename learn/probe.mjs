// temporary: which sportsbooks does ESPN's odds feed carry, now and for past games?
const get = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : { _status: r.status }; } catch (e) { return { _err: e.message }; } };
for (const [lg, p] of [['nba', 'basketball/nba'], ['nfl', 'football/nfl'], ['nhl', 'hockey/nhl'], ['epl', 'soccer/eng.1']]) {
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${p}/scoreboard`);
  const evs = (sb.events || []).slice(0, 3);
  for (const ev of evs) {
    const core = await get(`https://sports.core.api.espn.com/v2/sports/${p.split('/')[0]}/leagues/${p.split('/')[1]}/events/${ev.id}/competitions/${ev.id}/odds?limit=50`);
    console.log(lg, ev.id, ev.status?.type?.state, 'providers:', (core.items || []).map(i => `${i.provider?.name}#${i.provider?.id}`).join(', '));
    const sm = await get(`https://site.api.espn.com/apis/site/v2/sports/${p}/summary?event=${ev.id}`);
    console.log('   pickcenter:', (sm.pickcenter || []).map(x => x.provider?.name).join(', '), '| odds:', (sm.odds || []).map(x => x.provider?.name).join(', '));
  }
  // a past game from last season
  const old = await get(`https://site.api.espn.com/apis/site/v2/sports/${p}/scoreboard?dates=${lg === 'nfl' ? '20251109' : '20260115'}`);
  const oe = old.events?.[0];
  if (oe) { const core = await get(`https://sports.core.api.espn.com/v2/sports/${p.split('/')[0]}/leagues/${p.split('/')[1]}/events/${oe.id}/competitions/${oe.id}/odds?limit=50`); console.log(lg, 'PAST', oe.id, 'providers:', (core.items || []).map(i => `${i.provider?.name}#${i.provider?.id}`).join(', ')); }
}
const prov = await get('https://sports.core.api.espn.com/v2/providers?limit=100');
console.log('ALL PROVIDERS', prov.count, (prov.items || []).length);
