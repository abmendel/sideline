/* Sideline units: what betting the model's picks would have returned.
   One unit is one equal-sized bet. A win at −150 pays +0.67 units, a win at +130 pays +1.30, a loss costs 1.
   - SidelineUnits.of(list): units for recorded picks ({ ml, result })
   - SidelineUnits.panel(model, noun): the Model tab panel, from the trainer's backtest (model.units) */
(() => {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const payout = ml => ml > 0 ? ml / 100 : 100 / -ml;
  const fmt = u => u == null ? '—' : (u > 0 ? '+' : u < 0 ? '−' : '') + Math.abs(u).toFixed(Math.abs(u) >= 100 ? 0 : 1) + 'u';
  const cls = u => u > 0 ? 'u-pos' : u < 0 ? 'u-neg' : '';
  function of(list) {
    const g = (list || []).filter(m => m.ml != null && (m.result === 'W' || m.result === 'L'));
    let u = 0; g.forEach(m => { u += m.result === 'W' ? payout(+m.ml) : -1; });
    return { n: g.length, units: u, roi: g.length ? u / g.length : null };
  }
  const tag = list => { const r = of(list); return r.n ? `<span class="${cls(r.units)}" title="${r.n} graded picks with a posted line, 1 unit each">${fmt(r.units)}</span>` : ''; };

  function chart(series) {
    if (!series || series.length < 3) return '';
    const W = 900, H = 200, P = { l: 44, r: 12, t: 12, b: 24 };
    const ys = series.map(p => p[1]), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = (hi - lo) || 1;
    const x = i => P.l + i / (series.length - 1) * (W - P.l - P.r), y = v => P.t + (hi - v) / span * (H - P.t - P.b);
    const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
    const last = series[series.length - 1][1], col = last >= 0 ? 'var(--good)' : 'var(--bad)';
    const day = k => new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const ticks = [hi, (hi + lo) / 2, lo].map(v => `<text x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="var(--dim)">${v > 0 ? '+' : ''}${v.toFixed(0)}</text><line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(var(--fg),.08)"/>`).join('');
    return `<div class="chartbox" style="height:auto"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Running units this season, ending at ${fmt(last)}">${ticks}
      <line x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(var(--fg),.35)" stroke-dasharray="4 4"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(series.length - 1)}" cy="${y(last)}" r="5" fill="${col}"/>
      <text x="${P.l}" y="${H - 4}" font-size="12" fill="var(--dim)">${esc(day(series[0][0]))}</text><text x="${W - P.r}" y="${H - 4}" text-anchor="end" font-size="12" fill="var(--dim)">${esc(day(series[series.length - 1][0]))}</text></svg></div>`;
  }
  function panel(M, noun = 'game') {
    const U = M && M.units; if (!U || !U.all || !U.all.n) return '';
    const t = (k, r, s) => r && r.n ? `<div><b class="${cls(r.units)}">${fmt(r.units)}</b><span>${k}</span><span>${r.w}–${r.l} · ${r.roi > 0 ? '+' : ''}${(r.roi * 100).toFixed(1)}% per bet${s ? ' · ' + s : ''}</span></div>` : '';
    const avail = /^(nba|nfl|mlb|nhl)$/.test(M.sport);
    return `<div class="panel glass" style="margin-bottom:16px"><div class="ph"><span class="pic">💰</span><h3>Units won or lost</h3><span class="sub">1 unit on the model’s pick in every ${esc(noun)}, at the closing DraftKings price</span></div>
      <div class="mc-tiles">${t('This season', U.season)}${t('Last 30 days', U.last30)}${t(`All ${U.all.n.toLocaleString()} graded ${esc(noun)}s`, U.all)}${t('When it picked the favorite', U.fav)}${t('When it picked the underdog', U.dog)}${t('Same picks at the opening price', U.open)}${t(`Only when it beat the market by ${Math.round((U.valueCut || .03) * 100)}+ points`, U.value)}</div>
      ${U.series && U.series.length > 2 ? `<div class="sublabel">Running total this season</div>${chart(U.series)}` : ''}
      <details class="how"><summary>How to read this</summary><p>A unit is one equal-sized bet, whatever amount you choose. A win at −150 pays +0.67 units, a win at +130 pays +1.30, and a loss costs 1. Every ${esc(noun)} was predicted using only earlier results, then settled at the real price.</p>
      <p>The sportsbook’s margin means betting every game normally loses a little, so staying near zero is already better than average. ${avail ? 'The opening-price row is flattering: the model knew who actually played, which wasn’t fully known when the line opened. ' : ''}Past results don’t promise future ones. For entertainment only · 21+ · 1-800-GAMBLER</p></details></div>`;
  }
  // parlays: 1 unit on each day's n-leg parlay; a hit pays the combined price, a miss costs 1
  function parTag(parlays, n) {
    let u = 0, k = 0;
    (parlays || []).forEach(P => { const L = (P.legs || []).slice(0, n); if (L.length < n || L.some(l => !l.result || l.ml == null)) return; k++; u += L.every(l => l.result === 'W') ? L.reduce((d, l) => d * (1 + payout(+l.ml)), 1) - 1 : -1; });
    return k ? ` · <b class="${cls(u)}" title="1 unit on each of ${k} graded parlays">${fmt(u)}</b>` : '';
  }
  window.SidelineUnits = { of, tag, parTag, panel, fmt, cls };
})();
