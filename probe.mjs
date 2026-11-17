const B = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const get = async u => { const r = await fetch(u); return r.ok ? await r.json() : { __err: r.status }; };
const show = (k, v) => console.log(k + ':', v);

// how many games come back with and without the FBS group filter
for (const q of ['', '&groups=80', '&groups=81', '&limit=200&groups=80']) {
  const d = await get(`${B}/scoreboard?dates=20261114${q}&limit=200`);
  show(`sb[${q}]`, (d.events || []).length + ' events, err=' + (d.__err || ''));
}
const d = await get(`${B}/scoreboard?dates=20261114&groups=80&limit=200`);
const ev = (d.events || [])[0] || {};
show('event keys', Object.keys(ev).join(','));
const c = ev.competitions?.[0] || {};
show('comp keys', Object.keys(c).join(','));
show('competitor keys', Object.keys(c.competitors?.[0] || {}).join(','));
show('curatedRank', JSON.stringify(c.competitors?.map(x => x.curatedRank)));
show('team keys', Object.keys(c.competitors?.[0]?.team || {}).join(','));
show('odds', JSON.stringify(c.odds || []).slice(0, 700));
show('weeks', JSON.stringify({ week: d.week, season: d.season, leagueCal: (d.leagues?.[0]?.calendar || []).length }).slice(0, 400));
show('groups meta', JSON.stringify(d.leagues?.[0]?.groups || null).slice(0, 200));

// teams
const t = await get(`${B}/teams?limit=900`);
const list = (t.sports?.[0]?.leagues?.[0]?.teams || []).map(x => x.team);
show('teams', list.length + ' first=' + JSON.stringify(list[0]).slice(0, 220));

// standings by conference
const s = await get('https://site.api.espn.com/apis/v2/sports/football/college-football/standings?level=3');
show('standings children', (s.children || []).length);
show('conf sizes', (s.children || []).map(x => (x.standings?.entries || []).length).join(','));
show('sample confs', (s.children || []).slice(0, 8).map(x => `${x.id}:${x.name}`).join(' | '));
show('stat names', ((s.children || [])[0]?.standings?.entries?.[0]?.stats || []).map(x => x.name).join(','));

// rankings
const r = await get(`${B}/rankings`);
const polls = (r.rankings || []).filter(p => (p.ranks || []).length);
show('polls', polls.map(p => `${p.shortName}/${p.type}/${p.ranks.length}`).join(' '));
show('week', polls[0]?.occurrence?.displayValue);
show('top5', polls[0]?.ranks?.slice(0, 5).map(x => `${x.current} ${x.team.location} (${x.recordSummary}) prev ${x.previous} pts ${x.points} fpv ${x.firstPlaceVotes}`).join(' | '));
const byTeam = {}; (s.children || []).forEach(x => (x.standings?.entries || []).forEach(e => byTeam[String(e.team?.id)] = x.name));
show('ranked in a conference', (polls[0]?.ranks || []).filter(x => byTeam[String(x.team.id)]).length + '/' + (polls[0]?.ranks || []).length);

// box score shape for the model
const sum = await get(`${B}/summary?event=${ev.id}`);
show('summary keys', Object.keys(sum).join(','));
const bx = sum.boxscore || {};
show('boxscore teams stats', (bx.teams?.[0]?.statistics || []).map(x => x.name).slice(0, 40).join(','));
show('player cats', (bx.players?.[0]?.statistics || []).map(x => x.name).join(','));
show('providers', JSON.stringify((sum.pickcenter || []).map(p => p.provider?.name)));
show('winprob', (sum.winprobability || []).length);
show('drives', Object.keys(sum.drives || {}).join(','));
show('leaders', JSON.stringify((sum.leaders || []).map(x => x.team?.id)).slice(0, 120));
