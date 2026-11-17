const B = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
const get = async u => { const r = await fetch(u); return r.ok ? r.json() : { __err: r.status }; };
const d = await get(`${B}/rankings`);
console.log('RANK top keys:', Object.keys(d).join(','));
const polls = d.rankings || [];
console.log('polls:', polls.map(p => `${p.name} | type=${p.type} | short=${p.shortName} | ranks=${(p.ranks||[]).length} | occ=${p.occurrence?.displayValue||''}`).join(' ;; '));
const ap = polls.find(p => /ap/i.test(p.shortName || p.name)) || polls[0];
console.log('AP first 3:', JSON.stringify((ap.ranks || []).slice(0, 3), null, 1).slice(0, 1600));
console.log('AP rank keys:', Object.keys((ap.ranks||[])[0]||{}).join(','));
console.log('AP team keys:', Object.keys((ap.ranks||[])[0]?.team||{}).join(','));
console.log('others:', JSON.stringify(d.others?.slice?.(0,2) || null).slice(0,300));
// does the standings payload carry the conference of a team, and a curated rank?
const s = await get('https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings?level=3');
const c0 = (s.children || [])[0];
console.log('conf keys:', Object.keys(c0 || {}).join(','), '| name:', c0?.name, '| abbr:', c0?.abbreviation, '| id:', c0?.id);
console.log('conf count:', (s.children||[]).length);
console.log('entry team keys:', Object.keys(c0?.standings?.entries?.[0]?.team || {}).join(','));
