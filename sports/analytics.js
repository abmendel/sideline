/* Sideline Analytics tab: spreads, totals and player impact.
   Reads data/analytics-<sport>.json (soccer: one file per league), written every night by the trainer
   (learn/analytics.mjs). The page calls SidelineAnalytics.render() when the tab opens. */
(() => {
  'use strict';
  const SPORT = (location.pathname.match(/\/(\w+)\.html$/) || [])[1] || 'nba';
  const SOCCER = SPORT === 'soccer';
  const LEAGUES = [['eng.1', 'Premier League'], ['esp.1', 'LaLiga'], ['ger.1', 'Bundesliga'], ['ita.1', 'Serie A'], ['fra.1', 'Ligue 1'], ['usa.1', 'MLS'], ['mex.1', 'Liga MX'], ['uefa.champions', 'Champions League']];
  const B2B = SPORT === 'nba' || SPORT === 'nhl';
  const UNIT = { nba: 'pts', nfl: 'pts', mlb: 'runs', nhl: 'goals', soccer: 'goals' }[SPORT];
  const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const A = { view: store.get(`sideline.${SPORT}.an.view`, 'spreads'), season: 0, lg: store.get('sideline.soccer.an.lg', 'eng.1'), sort: null, dir: -1, team: '', q: '', data: {}, busy: {} };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
  const sgn = (v, d = 1) => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d);
  const rec = r => r && r[0] + r[1] + r[2] ? `${r[0]}–${r[1]}${r[2] ? '–' + r[2] : ''}` : '—';
  const rate = r => r && r[0] + r[1] ? r[0] / (r[0] + r[1]) : null;
  const IC = {
    sp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16M12 4v16"/><circle cx="12" cy="12" r="9"/></svg>',
    tot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 15l6-6 6 6"/><path d="M6 20h12M6 4h12"/></svg>',
    pl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>'
  };
  const key = () => SOCCER ? A.lg : SPORT;

  async function load(k) {
    if (A.data[k] || A.busy[k]) return A.busy[k];
    const get = u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    A.busy[k] = Promise.all([get(`../data/analytics-${k}.json?t=${Math.floor(Date.now() / 6e5)}`), get(`https://raw.githubusercontent.com/abmendel/sideline/main/data/analytics-${k}.json`)])
      .then(list => { A.data[k] = list.filter(Boolean).sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0] || { missing: true }; A.busy[k] = null; });
    return A.busy[k];
  }
  const teamIn = (D, id) => { const t = D.teams[id] || {}; return `${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}<span>${esc(t.name || t.abbr || id)}</span>`; };
  const bar = (v, lo = .3, hi = .7) => v == null ? '' : `<div class="probbar" style="height:6px;margin-top:4px;min-width:70px"><i style="width:${Math.max(3, Math.min(100, (v - lo) / (hi - lo) * 100)).toFixed(1)}%;background:${v >= .524 ? 'var(--good)' : v < .476 ? 'var(--bad)' : 'var(--dim)'}"></i></div>`;
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${esc(v)}" class="${String(v) === String(cur) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  const head = (icon, title, sub, extra = '') => `<div class="ph"><span class="pic">${icon}</span><h3>${esc(title)}</h3>${sub ? `<span class="sub">${sub}</span>` : ''}<span class="spacer"></span>${extra}</div>`;
  const seasonLabel = s => SPORT === 'nfl' || SPORT === 'mlb' ? String(s) : `${s - 1}–${String(s).slice(2)}`;

  function sortRows(rows, cols, defKey) {
    const k = A.sort && cols.some(c => c.k === A.sort) ? A.sort : defKey, c = cols.find(x => x.k === k);
    return rows.slice().sort((a, b) => A.dir * (((c.v(a) ?? -1e9)) - ((c.v(b) ?? -1e9))));
  }
  const th = (cols, defKey) => cols.map(c => { const on = (A.sort || defKey) === c.k; return `<th class="sortable ${on ? 'sorted' : ''}" data-sk="${c.k}" title="${esc(c.tip || '')}">${esc(c.l)}${on ? (A.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`; }).join('');

  function spreadsView(D) {
    const S = D.spreads?.[A.season] || D.spreads?.[0];
    if (!S) return `<div class="panel glass">${head(IC.sp, 'Against the spread', '')}<p class="muted" style="margin:0">Spread data for this ${SOCCER ? 'league' : 'sport'} fills in after the next nightly update.</p></div>`;
    const L = S.league;
    const tiles = `<div class="mc-tiles">
      <div><b>${pct(L.homeCover)}</b><span>Home teams covered · ${L.games.toLocaleString()} games</span></div>
      <div><b>${pct(L.favCover)}</b><span>Favorites covered</span></div>
      ${L.lineMove ? `<div><b>${pct(L.lineMove.pct)}</b><span>Covered when the line moved toward them · ${L.lineMove.n}</span></div>` : ''}
      ${L.model ? `<div><b>${pct(L.model.pct)}</b><span>Our model's side · ${L.model.w}–${L.model.l}</span></div>` : ''}
      ${L.strong ? `<div><b>${pct(L.strong.pct)}</b><span>Model edges of ${L.strong.thr}+ ${UNIT} · ${L.strong.w}–${L.strong.l}</span></div>` : ''}
      <div><b>${L.avgMiss ?? '—'}</b><span>Average miss vs the spread (${UNIT})</span></div></div>`;
    const cols = [
      { k: 'ats', l: 'ATS', v: r => rate(r.ats), tip: 'Record against the closing spread' },
      { k: 'home', l: 'Home', v: r => rate(r.home) }, { k: 'away', l: 'Away', v: r => rate(r.away) },
      { k: 'fav', l: 'As favorite', v: r => rate(r.fav) }, { k: 'dog', l: 'As underdog', v: r => rate(r.dog) },
      ...(B2B ? [{ k: 'b2b', l: 'Back-to-back', v: r => rate(r.b2b), tip: 'Second game in two days' }] : []),
      { k: 'last10', l: 'Last 10', v: r => rate(r.last10) },
      { k: 'cover', l: 'Avg cover', v: r => r.cover, tip: `Average ${UNIT} by which they beat (+) or missed (−) the spread` }];
    const rows = sortRows(S.teams.filter(r => r.ats[0] + r.ats[1] + r.ats[2]), cols, 'ats').map((r, i) => `<tr><td><div class="teamcell"><span class="seed">${i + 1}</span>${teamIn(D, r.id)}</div></td>
      <td><b>${rec(r.ats)}</b>${bar(rate(r.ats))}</td><td>${rec(r.home)}</td><td>${rec(r.away)}</td><td>${rec(r.fav)}</td><td>${rec(r.dog)}</td>${B2B ? `<td>${rec(r.b2b)}</td>` : ''}
      <td>${rec(r.last10)}<div class="sub" style="font-size:11px">${esc(r.streak || '')}</div></td><td class="${r.cover > 0 ? 'pos' : r.cover < 0 ? 'neg' : ''}">${sgn(r.cover)}</td></tr>`).join('');
    return `<div class="panel glass" style="margin-bottom:16px">${head(IC.sp, SPORT === 'mlb' ? 'Against the run line' : SPORT === 'nhl' ? 'Against the puck line' : 'Against the spread', `${seasonLabel(S.season)} · closing ${SOCCER ? 'handicap' : SPORT === 'mlb' ? 'run line' : SPORT === 'nhl' ? 'puck line' : 'spread'}, DraftKings (ESPN BET for some older games)`)}${tiles}
      <p class="note" style="margin:12px 0 0">${L.priced ? `In ${SPORT === 'mlb' ? 'baseball the run line' : 'hockey the puck line'} is almost always ±1.5 and each side carries its own price (the favorite at −1.5 usually pays plus money), so a cover rate isn't the same as a profit rate. Use these records to see which teams win or lose by margin.` : 'Breaking even at standard −110 odds takes 52.4%. Green bars are teams above that, red below.'} Small samples swing a lot.</p></div>
      <div class="panel glass">${head(IC.sp, 'Team records vs the spread', 'click a column to sort')}<div class="tbl-wrap"><table class="antbl"><thead><tr><th style="text-align:left">Team</th>${th(cols, 'ats')}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  function totalsView(D) {
    const S = D.spreads?.[A.season] || D.spreads?.[0];
    if (!S || !S.league.totals) return `<div class="panel glass">${head(IC.tot, 'Over / under', '')}<p class="muted" style="margin:0">Totals fill in after the next nightly update.</p></div>`;
    const L = S.league, ou = r => r.ou[0] + r.ou[1] ? r.ou[0] / (r.ou[0] + r.ou[1]) : null;
    const cols = [{ k: 'over', l: 'Over %', v: ou }, { k: 'ou', l: 'Over–under', v: r => r.ou[0] - r.ou[1] }, { k: 'td', l: 'vs total', v: r => r.totDiff, tip: `Average combined ${UNIT} above (+) or below (−) the closing total` }];
    const rows = sortRows(S.teams.filter(r => r.ou[0] + r.ou[1] + r.ou[2]), cols, 'over').map((r, i) => `<tr><td><div class="teamcell"><span class="seed">${i + 1}</span>${teamIn(D, r.id)}</div></td>
      <td><b>${pct(ou(r))}</b>${bar(ou(r))}</td><td>${r.ou[0]}–${r.ou[1]}${r.ou[2] ? '–' + r.ou[2] : ''}</td><td class="${r.totDiff > 0 ? 'pos' : r.totDiff < 0 ? 'neg' : ''}">${sgn(r.totDiff)}</td></tr>`).join('');
    return `<div class="panel glass" style="margin-bottom:16px">${head(IC.tot, 'Over / under', `${seasonLabel(S.season)} · closing total`)}<div class="mc-tiles">
      <div><b>${pct(L.over)}</b><span>Games that went over · ${L.totals.toLocaleString()}</span></div><div><b>${pct(L.over == null ? null : 1 - L.over)}</b><span>Went under (or pushed)</span></div></div></div>
      <div class="panel glass">${head(IC.tot, 'Team over / under records', 'their games against the closing total · click a column to sort')}<div class="tbl-wrap"><table class="antbl"><thead><tr><th style="text-align:left">Team</th>${th(cols, 'over')}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  function playersView(D) {
    const P = D.players;
    if (!P || !P.rows?.length) return `<div class="panel glass">${head(IC.pl, 'Player impact', '')}<p class="muted" style="margin:0">Player impact fills in after the next nightly update.</p></div>`;
    const who = { nba: 'Rotation players', nfl: 'Quarterbacks', mlb: 'Starting pitchers', nhl: 'Goalies', soccer: 'Starters' }[SPORT];
    const q = A.q.trim().toLowerCase();
    const list = P.rows.filter(r => (!A.team || r.team === A.team) && (!q || r.name.toLowerCase().includes(q)));
    const max = Math.max(...P.rows.map(r => Math.abs(r.impact || 0)), .001);
    const teams = [...new Set(P.rows.map(r => r.team))].sort((a, b) => (D.teams[a]?.name || '').localeCompare(D.teams[b]?.name || ''));
    const rows = list.slice(0, 120).map(r => `<tr><td><div class="teamcell"><span class="seed">${r.rank}</span>${D.teams[r.team]?.logo ? `<img src="${esc(D.teams[r.team].logo)}" alt="" loading="lazy">` : ''}<span><b>${esc(r.name)}</b> <span class="sub">${esc(r.pos || '')} · ${esc(D.teams[r.team]?.abbr || '')}</span></span></div></td>
      <td><b class="${r.impact > 0 ? 'pos' : r.impact < 0 ? 'neg' : ''}">${sgn(r.impact, UNIT === 'pts' ? 1 : 2)}</b><div class="probbar" style="height:6px;margin-top:4px;min-width:90px"><i style="width:${(Math.abs(r.impact || 0) / max * 100).toFixed(1)}%;background:${(r.impact || 0) >= 0 ? 'var(--acc)' : 'var(--bad)'}"></i></div></td>
      ${r.win != null ? `<td>${sgn(r.win * 100, 1)}%</td>` : ''}<td>${r.a ?? '—'}</td><td>${r.b ?? '—'}</td></tr>`).join('');
    const hasWin = P.rows.some(r => r.win != null);
    return `<div class="panel glass">${head(IC.pl, `${who} by impact`, esc(P.what), `<label class="search glass" style="height:34px"><input type="search" id="anQ" placeholder="Find a player" value="${esc(A.q)}" style="width:150px"></label><select id="anTeam" class="pillbtn glass sm"><option value="">All teams</option>${teams.map(t => `<option value="${esc(t)}" ${t === A.team ? 'selected' : ''}>${esc(D.teams[t]?.name || t)}</option>`).join('')}</select>`)}
      <div class="tbl-wrap"><table class="antbl"><thead><tr><th style="text-align:left">Player</th><th>Impact (${UNIT}/game)</th>${hasWin ? '<th title="How much he moves his team\'s win chance in an even game">Win chance</th>' : ''}<th>${esc(P.a)}</th><th>${esc(P.b)}</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="muted" style="text-align:left">No players match.</td></tr>`}</tbody></table></div>
      <p class="note" style="margin:12px 0 0">${SOCCER ? 'Built from starting lineups over the last two seasons. It credits a player with how his team did against expectation when he started, so a regular starter on a strong team still has to beat what the model already expected.' : 'These are the same player numbers the prediction model uses, learned from box scores over the last three seasons and weighted toward recent games.'} Rankings cover players on current rosters and update every night.</p></div>`;
  }

  async function render() {
    const box = document.getElementById('analytics'); if (!box) return;
    const k = key();
    if (!A.data[k]) { box.innerHTML = '<div class="skeleton" style="height:120px;margin-bottom:16px"></div><div class="skeleton" style="height:420px"></div>'; await load(k); if (key() !== k) return; }
    const D = A.data[k];
    const seasons = (D.spreads || []).map((s, i) => [i, seasonLabel(s.season)]);
    const top = `<div class="anbar">${seg('anView', [['spreads', 'Spreads'], ['totals', 'Over / under'], ['players', 'Player impact']], A.view)}
      ${A.view !== 'players' && seasons.length > 1 ? seg('anSeason', seasons, A.season) : ''}
      ${SOCCER ? `<select id="anLg" class="pillbtn glass sm">${LEAGUES.map(([v, l]) => `<option value="${v}" ${v === A.lg ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}
      <span class="spacer"></span>${D.updated ? `<span class="sub">Updated ${esc(new Date(D.updated).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span>` : ''}</div>`;
    const body = D.missing ? `<div class="panel glass"><p class="muted" style="margin:0">Analytics for this ${SOCCER ? 'league' : 'sport'} will appear after the next nightly update.</p></div>`
      : A.view === 'totals' ? totalsView(D) : A.view === 'players' ? playersView(D) : spreadsView(D);
    box.innerHTML = top + body;
    const on = (sel, ev, f) => { const el = box.querySelector(sel); if (el) el[ev] = f; };
    box.querySelectorAll('#anView button').forEach(b => b.onclick = () => { A.view = b.dataset.v; A.sort = null; A.dir = -1; store.set(`sideline.${SPORT}.an.view`, A.view); render(); });
    box.querySelectorAll('#anSeason button').forEach(b => b.onclick = () => { A.season = +b.dataset.v; render(); });
    box.querySelectorAll('th[data-sk]').forEach(t => t.onclick = () => { if (A.sort === t.dataset.sk || (!A.sort && t.classList.contains('sorted'))) A.dir *= -1; else { A.sort = t.dataset.sk; A.dir = -1; } render(); });
    on('#anLg', 'onchange', e => { A.lg = e.target.value; A.season = 0; store.set('sideline.soccer.an.lg', A.lg); render(); });
    on('#anTeam', 'onchange', e => { A.team = e.target.value; render(); });
    on('#anQ', 'oninput', e => { A.q = e.target.value; clearTimeout(A.t); A.t = setTimeout(() => { render().then(() => { const q = document.getElementById('anQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }); }, 250); });
  }
  window.SidelineAnalytics = { render };
})();
