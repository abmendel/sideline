const KEY = process.env.RUNDOWN_KEY;
const r = await fetch('https://therundown.io/api/v2/sports', { headers: { 'X-TheRundown-Key': KEY } });
const j = await r.json();
console.log('RUNDOWN SPORTS', JSON.stringify((j.sports || []).map(s => `${s.sport_id}:${s.sport_name}`)));
