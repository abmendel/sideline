// temporary: rate-limited probe — markets, past events, quota
const KEY = process.env.RUNDOWN_KEY, B = 'https://therundown.io/api/v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
const get = async p => { const w = 1300 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
  const r = await fetch(B + p, { headers: { 'X-TheRundown-Key': KEY } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  const hdr = {}; r.headers.forEach((v, k) => { if (/limit|quota|plan|credit|usage|remain/i.test(k)) hdr[k] = v; });
  return { s: r.status, j, t: t.slice(0, 200).replace(/\s+/g, ' '), hdr }; };
const today = new Date().toISOString().slice(0, 10);
let r = await get(`/sports/2/events/${today}?market_ids=1,2,3&main_line=true&offset=300`);
console.log('NFL today', r.s, JSON.stringify(r.hdr), 'events', r.j?.events?.length ?? r.t);
const e = r.j?.events?.[0];
if (e) { console.log('  markets', JSON.stringify((e.markets || []).map(m => ({ id: m.market_id, name: m.name, parts: (m.participants || []).map(p => ({ n: p.name, line: p.lines?.[0]?.spread ?? p.lines?.[0]?.total ?? null, books: Object.keys(p.lines?.[0]?.prices || {}) })) }))).slice(0, 1400)); }
for (const d of ['2026-11-14', '2026-10-20', '2026-01-15']) {
  const p = await get(`/sports/4/events/${d}?market_ids=1&main_line=true&offset=300`);
  const ev = p.j?.events?.[0];
  console.log('PAST nba', d, p.s, 'events', p.j?.events?.length ?? p.t.slice(0, 120), ev ? `first ${ev.teams_normalized?.map(x => x.abbreviation).join('@')} books ${JSON.stringify(Object.keys(ev.markets?.[0]?.participants?.[0]?.lines?.[0]?.prices || {}))} status ${ev.score?.event_status}` : '');
}
const ev2 = (await get(`/sports/4/events/2026-11-14?market_ids=1&main_line=true&offset=300`)).j?.events?.[0];
if (ev2) { const c = await get(`/events/${ev2.event_id}/closing`); console.log('CLOSING', c.s, JSON.stringify(c.j).slice(0, 600)); }
const o = await get(`/sports/4/events/${today}/opening?market_ids=1`);
console.log('OPENING', o.s, o.t.slice(0, 200));
const all = await get(`/sports/events/${today}?market_ids=1&main_line=true&offset=300`);
console.log('ALL SPORTS one call', all.s, 'events', all.j?.events?.length ?? all.t.slice(0, 150), all.j?.events ? JSON.stringify([...new Set(all.j.events.map(x => x.sport_id))]) : '');
