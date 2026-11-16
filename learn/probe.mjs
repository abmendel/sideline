// temporary: what TheRundown's free plan gives us — sports, sportsbooks, and one day of events
const KEY = process.env.RUNDOWN_KEY, B = 'https://therundown.io/api/v2';
const get = async (p) => { try { const r = await fetch(B + p, { headers: { 'X-TheRundown-Key': KEY } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t: t.slice(0, 300).replace(/\s+/g, ' '), rl: ['x-ratelimit-remaining', 'x-ratelimit-limit', 'x-plan', 'x-quota-remaining'].map(h => r.headers.get(h)).filter(Boolean).join('|') }; } catch (e) { return { s: 'ERR', t: e.message }; } };
const sp = await get('/sports');
console.log('SPORTS', sp.s, sp.rl, JSON.stringify(sp.j?.sports || sp.j).slice(0, 700));
const aff = await get('/affiliates');
console.log('AFFILIATES', aff.s, JSON.stringify((aff.j?.affiliates || []).map(a => `${a.affiliate_id}:${a.affiliate_name}`)).slice(0, 1200));
const today = new Date().toISOString().slice(0, 10);
for (const [name, id] of [['NBA', 4], ['NFL', 2], ['NHL', 6], ['MLB', 3], ['EPL', 10]]) {
  const r = await get(`/sports/${id}/events/${today}?market_ids=1,2,3&main_line=true&offset=300`);
  const ev = r.j?.events?.[0];
  console.log(`\n== ${name}(${id})`, r.s, r.rl, 'events', r.j?.events?.length ?? r.t.slice(0, 160));
  if (ev) {
    console.log('  keys', Object.keys(ev).join(','));
    console.log('  teams', JSON.stringify(ev.teams || ev.teams_normalized || ev.participants).slice(0, 400));
    console.log('  when', ev.event_date || ev.date_event, 'id', ev.event_id, 'score', JSON.stringify(ev.score).slice(0, 220));
    const L = ev.lines || ev.markets || ev.odds;
    console.log('  lines', JSON.stringify(L).slice(0, 1100));
  }
}
const old = await get(`/sports/4/events/2026-01-15?market_ids=1,2,3&main_line=true&offset=300`);
console.log('\nPAST NBA 2026-01-15', old.s, 'events', old.j?.events?.length ?? old.t.slice(0, 200));
if (old.j?.events?.[0]) { const e = old.j.events[0]; console.log('  past sample', JSON.stringify({ id: e.event_id, d: e.event_date, t: e.teams_normalized?.map(x => x.abbreviation), lines: Object.keys(e.lines || {}) }).slice(0, 400)); const cl = await get(`/events/${e.event_id}/closing`); console.log('  closing', cl.s, JSON.stringify(cl.j).slice(0, 500)); }
