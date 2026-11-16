// temporary: what does TheRundown return on this plan? (prints shapes only, never the key)
const KEY = process.env.RUNDOWN_KEY || '';
console.log('key present:', KEY.length > 0, 'length', KEY.length);
const get = async p => { try { const r = await fetch('https://therundown.io/api/v2' + p, { headers: { 'X-TheRundown-Key': KEY } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t: t.slice(0, 300), h: Object.fromEntries([...r.headers].filter(([k]) => /rate|limit|remaining|datapoint|usage/i.test(k))) }; } catch (e) { return { status: 'ERR ' + e.message }; } };
const cut = (v, n = 1800) => { const s = JSON.stringify(v) ?? ''; return s.length > n ? s.slice(0, n) + '…' : s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const aff = await get('/affiliates'); console.log('AFFILIATES', (aff.j?.affiliates || []).map(a => a.affiliate_id + ':' + a.affiliate_name).join(' | '));
for (const [name, id, off] of [['nba', 4, 1], ['nhl', 6, 1], ['nfl', 2, 1], ['epl', 11, 6]]) {
  await sleep(1300);
  const d = new Date(Date.now() + off * 864e5).toISOString().slice(0, 10);
  const r = await get(`/sports/${id}/events/${d}?market_ids=1,2,3&main_line=true`);
  const evs = r.j?.events || [];
  console.log(name.toUpperCase(), d, r.status, 'events', evs.length, 'cost', r.h['x-datapoints'], r.h['x-datapoints-breakdown'], r.j ? '' : r.t);
  const e = evs.find(x => (x.markets || []).length) || evs[0];
  if (e) { console.log('  teams', cut((e.teams || []).map(t => ({ name: t.name, mascot: t.mascot, abbr: t.abbreviation, away: t.is_away, home: t.is_home })), 400), 'date', e.event_date, 'status', e.score?.event_status);
    console.log('  teams_normalized', cut(e.teams_normalized, 500));
    console.log('  market names', (e.markets || []).map(m => `${m.market_id ?? m.id}:${m.name}`).join(' | '));
    console.log('  market[0]', cut((e.markets || [])[0], 3200)); }
  if (name === 'nba' && e) { await sleep(1300); const o = await get(`/events/${e.event_id}/openers?market_ids=1`); console.log('  OPENERS', o.status, cut(o.j, 700), o.j ? '' : o.t); await sleep(1300); const c = await get(`/events/${e.event_id}/closing?market_ids=1`); console.log('  CLOSING', c.status, cut(c.j, 500), c.j ? '' : c.t); }
}
