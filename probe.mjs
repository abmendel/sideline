const B = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const get = async u => { const r = await fetch(u); return r.ok ? await r.json() : { __err: r.status }; };
for (const q of ['?limit=900', '?limit=900&groups=80', '?limit=900&group=80']) {
  const d = await get(`${B}/teams${q}`);
  const l = (d.sports?.[0]?.leagues?.[0]?.teams || []).map(x => x.team);
  console.log('teams' + q, '→', l.length, l.slice(0, 3).map(t => t.displayName).join(' / '));
}
// the FBS set from standings, with the fields the page needs
const s = await get('https://site.api.espn.com/apis/v2/sports/football/college-football/standings?level=3');
const rows = [];
(s.children || []).forEach(c => (c.standings?.entries || []).forEach(e => rows.push({ id: e.team?.id, name: e.team?.displayName, abbr: e.team?.abbreviation, logo: e.team?.logos?.[0]?.href, conf: c.name })));
console.log('standings teams:', rows.length, '| sample:', JSON.stringify(rows[0]));
console.log('missing logo:', rows.filter(r => !r.logo).length, '| missing abbr:', rows.filter(r => !r.abbr).length);
// how many games a week, and what a week URL with groups returns
for (const w of [1, 8, 12]) {
  const d = await get(`${B}/scoreboard?dates=2026&seasontype=2&week=${w}&groups=80&limit=200`);
  console.log(`week ${w}:`, (d.events || []).length, 'events');
}
const d = await get(`${B}/scoreboard?dates=2026&seasontype=2&week=12&groups=80&limit=200`);
const ev = (d.events || []).find(e => (e.competitions?.[0]?.odds || []).length);
console.log('events with odds:', (d.events || []).filter(e => (e.competitions?.[0]?.odds || []).length).length);
console.log('odds sample:', JSON.stringify(ev?.competitions?.[0]?.odds?.[0] || null).slice(0, 400));
console.log('provider names:', JSON.stringify([...new Set((d.events||[]).flatMap(e => (e.competitions?.[0]?.odds||[]).map(o => o.provider?.name)))]));
