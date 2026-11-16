// temporary: what does TheRundown's free plan return, and can its games be matched to ESPN's?
const KEY = process.env.RUNDOWN_KEY;
console.log('key present:', !!KEY, KEY ? KEY.length + ' chars' : '');
const HOSTS = ['https://therundown-therundown-v1.p.rapidapi.com', 'https://api.apilayer.com/therundown', 'https://api.therundown.io/v2', 'https://api.therundown.io/v1'];
const tryGet = async (u, h = {}) => { try { const r = await fetch(u, { headers: h }); const t = await r.text(); return { s: r.status, t: t.slice(0, 700).replace(/\s+/g, ' ') }; } catch (e) { return { s: 'ERR', t: e.message }; } };
for (const base of HOSTS) {
  const h = base.includes('rapidapi') ? { 'x-rapidapi-key': KEY, 'x-rapidapi-host': 'therundown-therundown-v1.p.rapidapi.com' }
    : base.includes('apilayer') ? { apikey: KEY } : { 'x-api-key': KEY };
  const r = await tryGet(`${base}/sports`, h);
  console.log('\n== ', base, r.s, r.t.slice(0, 400));
}
