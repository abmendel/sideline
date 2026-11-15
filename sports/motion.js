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
    if (el.children.length) return;
    const txt = el.textContent, m = /^(\s*)([+−-]?)(\d{1,5})(\.\d+)?(\s*%?\s*)$/.exec(txt);
    if (!m) return;
    const target = parseFloat(m[3] + (m[4] || '')), dec = m[4] ? m[4].length - 1 : 0;
    if (!isFinite(target) || target === 0) return;
    const t0 = performance.now() + delay, dur = 750;
    el.textContent = m[1] + m[2] + (0).toFixed(dec) + m[5];
    const step = now => {
      if (!el.isConnected) return;
      const k = Math.min(1, Math.max(0, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = k >= 1 ? txt : m[1] + m[2] + (target * e).toFixed(dec) + m[5];
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // bars grow from their base, rings draw around
  function fill(root, delay) {
    root.querySelectorAll('.probbar i, .bar i, .cb .bars i').forEach(b => {
      const right = b.closest('.bar.l') || getComputedStyle(b).marginLeft === 'auto';
      b.style.transformOrigin = right ? 'right center' : 'left center';
      b.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 800, delay: delay + 120, easing: EASE, fill: 'backwards' });
    });
    root.querySelectorAll('.mc-bars i').forEach((b, i) => {
      b.style.transformOrigin = 'center bottom';
      b.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 700, delay: delay + 100 + i * 40, easing: EASE, fill: 'backwards' });
    });
    root.querySelectorAll('svg.ring circle[stroke-dasharray]').forEach(c => {
      const end = c.getAttribute('stroke-dasharray'), full = (end.split(/[\s,]+/)[1] || '0');
      c.animate([{ strokeDasharray: `0 ${full}` }, { strokeDasharray: end }], { duration: 1000, delay: delay + 150, easing: EASE, fill: 'backwards' });
    });
  }
  const NUMS = '.tile .v, .score, .mc-tiles b, .ptot b, .ringtile b, .mptot b, .ring .rv, .tot b';

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
    if (performance.now() > until) return;
    const added = [];
    muts.forEach(m => m.addedNodes.forEach(n => added.push(n)));
    if (added.length) reveal(added);
  }).observe(document.body, { childList: true, subtree: true });

  // whatever was already on screen when this loaded
  requestAnimationFrame(() => reveal([...main.querySelectorAll(REVEAL)].filter(x => x.offsetParent !== null)));

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
