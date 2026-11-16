// temporary: what does TheRundown return on this plan? (prints shapes only, never the key)
const KEY = process.env.RUNDOWN_KEY || '';
console.log('key present:', KEY.length > 0, 'length', KEY.length);
const get = async p => { try { const r = await fetch('https://therundown.io/api/v2' + p, { headers: { 'X-TheRundown-Key': KEY } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t: t.slice(0, 300), h: Object.fromEntries([...r.headers].filter(([k]) => /rate|limit|remaining|datapoint|usage/i.test(k))) }; } catch (e) { return { status: 'ERR ' + e.message }; } };
const cut = (v, n = 1800) => { const s = JSON.stringify(v) ?? ''; return s.length > n ? s.slice(0, n) + '…' : s; };
const aff = await get('/affiliates'); console.log('AFFILIATES', aff.status, cut(aff.j, 1500), aff.j ? '' : aff.t);
const sp = await get('/sports'); console.log('SPORTS', sp.status, cut((sp.j?.sports || []).map(s => s.sport_id + ':' + s.sport_name), 900));
const today = new Date().toISOString().slice(0, 10);
for (const [name, id] of [['nba', 4], ['nfl', 2], ['nhl', 6]]) {
  const r = await get(`/sports/${id}/events/${today}?market_ids=1,2,3&main_line=true`);
  const evs = r.j?.events || [];
  console.log(name.toUpperCase(), r.status, 'events', evs.length, 'headers', JSON.stringify(r.h), r.j ? 'top keys ' + Object.keys(r.j) : r.t);
  if (evs[0]) { const e = evs[0]; console.log('  event keys', Object.keys(e).join(','));
    console.log('  event (trimmed)', cut({ ...e, markets: undefined }, 1400));
    console.log('  markets', cut((e.markets || []).slice(0, 2), 2600));
    console.log('  market names', (e.markets || []).map(m => `${m.market_id ?? m.id}:${m.name}`).join(' | ')); }
}
const noBooks = await get(`/sports/4/events/${today}?market_ids=1&affiliate_ids=19,23,22&main_line=true`);
console.log('WITH affiliate_ids', noBooks.status, noBooks.j ? (noBooks.j.events || []).length : noBooks.t);
