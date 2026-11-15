/* Sideline motion: choreography for every sport page (styles in motion.css).
   - On arrival, the sidebar, header and first screen come in on a stagger.
   - Opening a section or changing the date reveals its cards one after another;
     numbers count up, probability bars and win-chance rings fill in.
   - Background refreshes (live scores every few seconds) don't re-animate, so
     the page only moves when you did something or a score changed.
   Loaded after the page script and shell.js. Off when reduced motion is asked for. */
(() => {
  'use strict';
  if (!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const main = document.querySelector('main');
  if (!main || !Element.prototype.animate) return;

  /* ---------- arrival ---------- */
  document.querySelectorAll('#tabs .nav').forEach((b, i) => b.style.setProperty('--i', i));
  document.querySelectorAll('.topbar > *').forEach((b, i) => b.style.setProperty('--i', i));
  document.body.classList.add('sl-boot');
  setTimeout(() => document.body.classList.remove('sl-boot'), 1800);

  /* ---------- when to animate: a short window after load and after each thing you do ---------- */
  let until = performance.now() + 4000, order = 0, shown = new Set();
  // a card that re-renders a moment later (data arriving in pieces) shouldn't count up twice
  const open = ms => { until = performance.now() + (ms || 1400); order = 0; shown = new Set(); };
  const keyOf = el => { const k = el.dataset && (el.dataset.id || el.dataset.ev || el.dataset.key); return k ? el.className.split(' ')[0] + ':' + k : el.id ? '#' + el.id : null; };
  const TRIGGERS = '#tabs .nav, .moresheet [data-go], #prevDay, #nextDay, #todayBtn, .seg button, .tabs button, [data-tab], [data-sub], .filters button, #parMode button, #parN button';
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest(TRIGGERS);
    if (!t) return;
    open();
    // a section that was already rendered (just hidden) still deals its cards back in
    if (t.matches('#tabs .nav, .moresheet [data-go], .seg button, [data-sub]')) setTimeout(() => reveal([...main.querySelectorAll(REVEAL)].slice(0, 400), true), 40);
    const ic = t.matches('#tabs .nav') && t.querySelector('.ic');
    if (ic) ic.animate([{ transform: 'scale(.6)' }, { transform: 'scale(1.22)', offset: .55 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' });
  }, true);
  document.addEventListener('change', e => { if (e.target && e.target.id === 'datePick') open(); }, true);

  /* ---------- what gets revealed ---------- */
  const REVEAL = '.card, .tile, .panel, .spot, .empty, .article, .leadcard, .ringtile, .mprow, .phist, .pickrow, .learnbox, .syncbar, .ins-cards > *, .mc-tiles > div, .ptot > div, .standings tr, tbody tr';
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const seen = new WeakSet();

  function rise(el, delay) {
    const row = el.tagName === 'TR';
    el.animate(row ? [{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }]
      : [{ opacity: 0, transform: 'translateY(14px) scale(.985)' }, { opacity: 1, transform: 'none' }],
      { duration: row ? 380 : 560, delay, easing: EASE, fill: 'backwards' });
  }
  // numbers count up to their value: 0 → 105, 0 → 68.4%
  function countUp(el, delay) {
    if (el.children.length || el.dataset.slCounting) return;
    const txt = el.textContent;
    let m = /^(\s*)([+−-]?)(\d{1,5})(\.\d+)?(\s*%?\s*)$/.exec(txt);
    if (!m) {                                          // a label with one percentage in it: "LAL 62%", "won 71.4%"
      const k = /^([^\d%]*?)(\d{1,3})(\.\d+)?(\s*%[^\d%]*)$/.exec(txt);
      if (!k) return;
      m = [txt, k[1], '', k[2], k[3], k[4]];
    }
    el.dataset.slCounting = '1';
    const target = parseFloat(m[3] + (m[4] || '')), dec = m[4] ? m[4].length - 1 : 0;
    if (!isFinite(target) || target === 0) return;
    const t0 = performance.now() + delay, dur = 750;
    el.textContent = m[1] + m[2] + (0).toFixed(dec) + m[5];
    const step = now => {
      if (!el.isConnected) return;
      const k = Math.min(1, Math.max(0, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = k >= 1 ? txt : m[1] + m[2] + (target * e).toFixed(dec) + m[5];
      if (k < 1) requestAnimationFrame(step); else delete el.dataset.slCounting;
    };
    requestAnimationFrame(step);
  }
  /* ---------- percentage charts ---------- */
  const BOUNCE = 'cubic-bezier(.3,1.25,.5,1)';
  const pctOf = el => parseFloat(el.style.width) || 0;
  // probability bars fill outward from where the two sides meet, then catch a shine
  function growProb(bar, delay) {
    const segs = [...bar.children].filter(x => x.tagName === 'I');
    segs.forEach((b, i) => {
      const seam = segs.length > 1 ? (i === 0 ? 'right' : i === segs.length - 1 ? 'left' : 'center') : 'left';
      b.style.transformOrigin = `${seam} center`;
      b.animate([{ transform: 'scaleX(0)', filter: 'brightness(1.35)' }, { transform: 'scaleX(1)', filter: 'none' }], { duration: 900, delay: delay + 140 + i * 70, easing: BOUNCE, fill: 'backwards' });
    });
    bar.classList.remove('sl-shine');
    setTimeout(() => { bar.classList.add('sl-shine'); setTimeout(() => bar.classList.remove('sl-shine'), 1100); }, delay + 900);
  }
  function fill(root, delay) {
    const bars = root.matches && root.matches('.probbar') ? [root] : [];
    root.querySelectorAll('.probbar').forEach(b => bars.push(b));
    bars.forEach(b => growProb(b, delay));
    root.querySelectorAll('.bar i, .cb .bars i').forEach((b, i) => {
      const right = b.closest('.bar.l') || b.style.marginLeft === 'auto';
      b.style.transformOrigin = right ? 'right center' : 'left center';
      b.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 850, delay: delay + 120 + i * 55, easing: BOUNCE, fill: 'backwards' });
    });
    root.querySelectorAll('.mc-bars i, .spark i').forEach((b, i) => {
      b.style.transformOrigin = 'center bottom';
      b.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1.08)', offset: .7 }, { transform: 'scaleY(1)' }], { duration: 750, delay: delay + 100 + i * 45, easing: EASE, fill: 'backwards' });
    });
    root.querySelectorAll('svg.ring').forEach(svg => {
      const c = svg.querySelector('circle[stroke-dasharray]'); if (!c) return;
      const end = c.getAttribute('stroke-dasharray'), full = (end.split(/[\s,]+/)[1] || '0');
      c.animate([{ strokeDasharray: `0 ${full}` }, { strokeDasharray: end }], { duration: 1200, delay: delay + 150, easing: BOUNCE, fill: 'backwards' });
      svg.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: .5 }, { transform: 'scale(1)' }], { duration: 500, delay: delay + 1250, easing: 'ease-out' });
    });
    root.querySelectorAll('.chartbox svg').forEach(svg => drawSvg(svg, delay));
  }
  // line and bar charts draw themselves: lines trace left to right, bars rise from the baseline
  function drawSvg(svg, delay) {
    if (svg.dataset.slDrawn) return; svg.dataset.slDrawn = '1';
    const W = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : svg.clientWidth;
    const lines = [...svg.querySelectorAll('path')].filter(p => (p.getAttribute('fill') || '') === 'none' && p.getAttribute('stroke'));
    const areas = [...svg.querySelectorAll('path')].filter(p => !lines.includes(p) && (p.getAttribute('fill') || 'none') !== 'none');
    const bars = [...svg.querySelectorAll('rect[rx]')].filter(r => !r.classList.contains('hit') && !r.id && +r.getAttribute('width') < W * .5 && +r.getAttribute('height') > 0 && !r.closest('g[transform]'));
    lines.forEach(p => {
      let len = 0; try { len = p.getTotalLength(); } catch (e) {}
      if (!len) return;
      p.animate([{ strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 }], { duration: 1400, delay: delay + 150, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'backwards' });
    });
    if (lines.length || areas.length) svg.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 1400, delay: delay + 150, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'backwards' });
    bars.sort((a, b) => +a.getAttribute('x') - +b.getAttribute('x')).forEach((r, i) => {
      r.style.transformBox = 'fill-box'; r.style.transformOrigin = 'center bottom';
      r.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1.06)', offset: .7 }, { transform: 'scaleY(1)' }], { duration: 700, delay: delay + 120 + i * 40, easing: EASE, fill: 'backwards' });
    });
    svg.querySelectorAll('circle:not([opacity="0"])').forEach(c => {
      if (+c.getAttribute('r') > 8) return;
      c.style.transformBox = 'fill-box'; c.style.transformOrigin = 'center';
      c.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.6)', offset: .6 }, { transform: 'scale(1)' }], { duration: 500, delay: delay + 1450, easing: 'ease-out', fill: 'backwards' });
    });
    svg.querySelectorAll('g[transform] > rect[rx], g[transform] > text').forEach(x => x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: delay + 900, fill: 'backwards' }));
  }

  /* ---------- live changes slide instead of jump ---------- */
  // remembers each probability bar's last width, so a re-render (live odds, a new win chance) eases to the new value
  const lastW = new Map();
  const barKey = (seg) => {
    const bar = seg.parentElement, holder = bar.closest('[data-id], [data-ev], [id]');
    const k = holder ? (holder.dataset.id || holder.dataset.ev || holder.id) : 'doc';
    const peers = holder ? [...holder.querySelectorAll('.probbar')] : [];
    return `${k}|${peers.indexOf(bar)}|${[...bar.children].indexOf(seg)}`;
  };
  function trackBars(nodes, revealing) {
    nodes.forEach(n => {
      if (n.nodeType !== 1) return;
      const segs = n.matches('.probbar i') ? [n] : [...n.querySelectorAll('.probbar > i')];
      segs.forEach(seg => {
        if (!seg.style.width) return;
        const key = barKey(seg), w = pctOf(seg), prev = lastW.get(key);
        lastW.set(key, w);
        if (revealing || prev == null || Math.abs(prev - w) < .4) return;
        seg.animate([{ width: prev + '%', filter: 'brightness(1.4)' }, { width: w + '%', filter: 'none' }], { duration: 900, easing: BOUNCE });
      });
    });
  }
  const NUMS = '.tile .v, .score, .mc-tiles b, .ptot b, .ringtile b, .mptot b, .ring .rv, .tot b, .probnums span, .cb .lbl b, .pp b, .ocell .v, .mc-bars em, .spark em';

  const busy = el => el.getAnimations && el.getAnimations().some(a => a.playState === 'running' || a.playState === 'pending');
  function reveal(nodes, again) {
    const roots = [];
    nodes.forEach(n => {
      if (n.nodeType !== 1 || (!again && seen.has(n))) return;
      const list = n.matches(REVEAL) ? [n] : [];
      n.querySelectorAll(REVEAL).forEach(x => list.push(x));
      list.forEach(x => { if (again || !seen.has(x)) roots.push(x); });
    });
    // animate the outermost blocks only; their insides come along
    const set = new Set(roots);
    const top = roots.filter(x => { for (let p = x.parentElement; p && p !== document.body; p = p.parentElement) if (set.has(p) && !p.matches('.panel, .ins-cards')) return false; return true; });
    top.forEach(el => {
      if (el.offsetParent === null && el.tagName !== 'TR' && getComputedStyle(el).position !== 'fixed') return;   // hidden: shown later
      if (el.tagName === 'TR' && !el.getClientRects().length) return;
      if (busy(el)) return;
      seen.add(el);
      const k = keyOf(el); if (k) { if (shown.has(k)) return; shown.add(k); }
      const delay = Math.min(order++ * 42, 620);
      rise(el, delay);
      if (el.matches(NUMS)) countUp(el, delay);
      el.querySelectorAll(NUMS).forEach(x => countUp(x, delay));
      fill(el, delay);
    });
  }
  new MutationObserver(muts => {
    const added = [];
    muts.forEach(m => m.addedNodes.forEach(n => added.push(n)));
    if (!added.length) return;
    const revealing = performance.now() <= until;
    trackBars(added, revealing);
    if (revealing) {
      reveal(added);
      // a chart redrawn inside a box that was already on the page
      added.forEach(n => { if (n.nodeType !== 1) return; const svgs = n.matches('.chartbox svg') ? [n] : [...n.querySelectorAll('.chartbox svg')]; svgs.forEach(svg => { if (!svg.dataset.slDrawn && !busy(svg)) drawSvg(svg, 60); }); });
    }
    else added.forEach(n => { if (n.nodeType === 1) n.querySelectorAll && n.querySelectorAll('.chartbox svg').forEach(svg => { svg.dataset.slDrawn = '1'; }); });
  }).observe(document.body, { childList: true, subtree: true });

  // whatever was already on screen when this loaded
  requestAnimationFrame(() => { trackBars([main], true); reveal([...main.querySelectorAll(REVEAL)].filter(x => x.offsetParent !== null)); });

  /* ---------- drawers and sheets slide in ---------- */
  const drawerSel = '.drawer, .modal, .sheet, .moresheet';
  new MutationObserver(muts => muts.forEach(m => {
    const el = m.target;
    if (m.attributeName !== 'class' || !el.matches || !el.matches(drawerSel)) return;
    if (el.classList.contains('open') && !m.oldValue?.includes('open')) {
      open(2500);                // the drawer's contents arrive a moment later and are revealed as they land
    }
  })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
})();
