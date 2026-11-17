// temporary: college basketball shape on ESPN
const P = 'basketball/mens-college-basketball';
const g = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : { _s: r.status }; } catch (e) { return { _e: e.message }; } };
const cut = (v, n = 400) => JSON.stringify(v ?? null).slice(0, n);
const sb = await g(`https://site.api.espn.com/apis/site/v2/sports/${P}/scoreboard?limit=400`);
console.log('SB default events', sb.events?.length, 'leagues', cut(sb.leagues?.[0] && { id: sb.leagues[0].id, name: sb.leagues[0].name, groups: sb.leagues[0].groups?.length, cal: (sb.leagues[0].calendar || []).length, season: sb.leagues[0].season?.year, type: sb.leagues[0].season?.type }, 400));
const sb50 = await g(`https://site.api.espn.com/apis/site/v2/sports/${P}/scoreboard?groups=50&limit=900`);
console.log('SB groups=50 events', sb50.events?.length);
const ev = sb50.events?.[0] || sb.events?.[0];
if (ev) {
  const c = ev.competitions[0], t = c.competitors[0];
  console.log('EV keys', Object.keys(ev).join(','), '| comp keys', Object.keys(c).join(','));
  console.log('TEAM', cut({ id: t.team?.id, abbr: t.team?.abbreviation, short: t.team?.shortDisplayName, disp: t.team?.displayName, loc: t.team?.location, rank: t.curatedRank?.current, conf: t.team?.conferenceId, rec: t.records?.map(r => r.summary), logo: !!t.team?.logo }, 600));
  console.log('ODDS', cut(c.odds, 500), '| neutral', c.neutralSite, '| notes', cut(c.notes, 200));
  const sm = await g(`https://site.api.espn.com/apis/site/v2/sports/${P}/summary?event=${ev.id}`);
  console.log('SUM keys', Object.keys(sm).join(','));
  console.log('BOXteam stats', cut((sm.boxscore?.teams?.[0]?.statistics || []).map(s => s.name), 700));
  const pg = sm.boxscore?.players?.[0]?.statistics?.[0];
  console.log('BOXplayers keys', cut(pg?.keys, 400), '| n', pg?.athletes?.length, '| a0', cut(pg?.athletes?.[0] && { id: pg.athletes[0].athlete?.id, st: pg.athletes[0].starter, s: pg.athletes[0].stats }, 300));
  console.log('PICKCENTER', cut((sm.pickcenter || []).map(x => x.provider?.name), 200), '| predictor', !!sm.predictor, '| winprob', sm.winprobability?.length);
}
const st = await g(`https://site.api.espn.com/apis/v2/sports/${P}/standings?level=3`);
console.log('STANDINGS lvl3', st.children?.length ?? cut(st, 200), 'first', cut(st.children?.[0] && { id: st.children[0].id, name: st.children[0].name, teams: st.children[0].standings?.entries?.length }, 300));
const rk = await g(`https://site.api.espn.com/apis/site/v2/sports/${P}/rankings`);
console.log('RANKINGS', cut(rk.rankings?.map(r => ({ n: r.name, t: r.ranks?.length })), 300));
const tm = await g(`https://site.api.espn.com/apis/site/v2/sports/${P}/teams?limit=500`);
console.log('TEAMS', tm.sports?.[0]?.leagues?.[0]?.teams?.length ?? cut(tm, 200));
const nw = await g(`https://site.api.espn.com/apis/site/v2/sports/${P}/news?limit=8`);
console.log('NEWS', nw.articles?.length);
const core = await g(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/${ev?.id}/competitions/${ev?.id}/odds?limit=20`);
console.log('CORE odds', core.count, cut((core.items || []).map(i => i.provider?.name), 200));
