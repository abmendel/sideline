/* Sideline sportsbooks: DraftKings, FanDuel and BetMGM moneylines for upcoming games, side by side on the
   Odds board with the best price for each side highlighted. Data: data/books-<sport>.json, refreshed by the
   hourly job (learn/books.mjs). */
(() => {
  'use strict';
  const SPORT = (location.pathname.match(/\/(\w+)\.html$/) || [])[1] || 'nba';
  const NAMES = { dk: 'DraftKings', fd: 'FanDuel', mgm: 'BetMGM' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const am = v => (v > 0 ? '+' : '−') + Math.abs(v);
  let B = null;
  async function load() {
    const get = u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const list = await Promise.all([get(`../data/books-${SPORT}.json?t=${Math.floor(Date.now() / 3e5)}`), get(`https://raw.githubusercontent.com/abmendel/sideline/main/data/books-${SPORT}.json`)]);
    B = list.filter(Boolean).sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0] || null;
    decorate();
  }
  function decorate() {
    if (!B || !B.ev) return;
    document.querySelectorAll('.orow[data-id], .orow[data-ev]').forEach(row => {
      if (row.querySelector('.bkrow')) return;
      const id = row.dataset.id || row.dataset.ev, rec = B.ev[id], nm = (B.names || {})[id] || ['Home', 'Away'];
      if (!rec || Object.keys(rec).length < 2) return;
      const ks = Object.keys(rec), n = rec[ks[0]].length, labels = n === 3 ? [nm[0], nm[1], 'Draw'] : [nm[0], nm[1]], order = n === 3 ? [0, 2, 1] : [1, 0];
      const best = labels.map((_, i) => Math.max(...ks.map(k => rec[k][i])));
      const cell = k => `<span class="bk"><b>${NAMES[k] || k}</b>${order.map(i => `<span class="${rec[k][i] === best[i] ? 'bkbest' : ''}">${esc(labels[i])} ${am(rec[k][i])}</span>`).join('')}</span>`;
      const d = document.createElement('div'); d.className = 'bkrow';
      d.innerHTML = `<span class="lbl">Moneyline by sportsbook</span>${ks.map(cell).join('')}<span class="sub">best price in green</span>`;
      row.appendChild(d);
    });
  }
  let q = false;
  new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(() => { q = false; decorate(); }); } }).observe(document.body, { childList: true, subtree: true });
  load(); setInterval(load, 10 * 60e3);
})();
