/* Sideline ease of use (styles in ease.css):
   - groups the sidebar into Games / Betting / Insights
   - tucks long fine print behind a "How this works" toggle (stays open once you open it)
   - explains betting and stats terms on hover or tap
   - adds a back-to-top button on long pages */
(() => {
  'use strict';
  /* ---------- sidebar sections ---------- */
  const tabs = document.getElementById('tabs');
  if (tabs) {
    const GROUPS = [['Games', ['scores', 'mine', 'standings', 'teams', 'news']], ['Betting', ['odds', 'picks']], ['Insights', ['matchup', 'compare', 'season', 'model', 'analytics']]];
    const more = tabs.querySelector('.nav.more'), frag = document.createDocumentFragment();
    GROUPS.forEach(([name, ids]) => {
      const btns = ids.map(id => tabs.querySelector(`.nav[data-tab="${id}"]`)).filter(Boolean);
      if (!btns.length) return;
      const l = document.createElement('div'); l.className = 'navlabel'; l.textContent = name; l.setAttribute('aria-hidden', 'true');
      frag.appendChild(l); btns.forEach(b => frag.appendChild(b));
    });
    [...tabs.querySelectorAll('.nav[data-tab]')].forEach(b => frag.appendChild(b));      // anything not grouped
    tabs.insertBefore(frag, more || null);
  }

  /* ---------- fine print behind a toggle ---------- */
  const opened = new Set();
  const keyOf = el => el.textContent.trim().slice(0, 48);
  function tuck(root) {
    root.querySelectorAll('.betfine, p.note, p.muted, span.muted').forEach(el => {
      if (el.closest('details, .empty, .drawer .dhead') || el.dataset.keep) return;
      if (el.textContent.trim().length < 200) return;
      const prev = el.previousElementSibling;
      if (!prev || prev.matches('.ph, .sechead')) return;                    // it's the panel's only content, not fine print
      const d = document.createElement('details'); d.className = 'how';
      const k = keyOf(el); if (opened.has(k)) d.open = true;
      const s = document.createElement('summary'); s.textContent = 'How this works';
      d.appendChild(s); el.parentNode.insertBefore(d, el); d.appendChild(el);
      d.addEventListener('toggle', () => { if (d.open) opened.add(k); else opened.delete(k); });
    });
  }
  document.addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.how')) { const p = d.querySelector('p, .betfine'); if (p) { const k = keyOf(p); if (d.open) opened.add(k); else opened.delete(k); } } }, true);

  /* ---------- plain-language terms ---------- */
  const TERMS = [
    [/\bATS\b|against the spread/i, 'Against the spread: did the team beat the betting line, not just win? A 5-point favorite covers by winning by 6 or more.'],
    [/\bmoneyline\b/i, 'Moneyline: a bet on who wins. −150 means bet $150 to win $100; +130 means bet $100 to win $130.'],
    [/^spread$|\bavg cover\b/i, 'Spread: the points the favorite is expected to win by. Covering means doing better than that.'],
    [/over ?\/ ?under|^total$|vs total|over %/i, 'Total (over/under): the combined score the sportsbook expects. Over means the game scored more.'],
    [/brier/i, 'Brier score: how far the predicted chances were from what happened. 0 is perfect; always saying 50/50 scores 0.25.'],
    [/log loss/i, 'Log loss: like Brier score, but punishes confident wrong picks harder. Lower is better.'],
    [/fair win|\(fair\)/i, 'Fair chance: the win chance the odds imply after removing the sportsbook’s built-in margin.'],
    [/\bunits?\b/i, 'Unit: one equal-sized bet, whatever amount you choose. +2.5u means you’d be up two and a half bets.'],
    [/back-to-back/i, 'Back-to-back: the second game in two days.'],
    [/calibration/i, 'Calibration: when the model says 70%, does that happen about 70% of the time?'],
    [/\bFIP\b/, 'FIP: a pitcher’s runs allowed per nine innings judged only on strikeouts, walks and home runs. Lower is better.'],
    [/ANY\/A/, 'Adjusted net yards per attempt: passing yards per dropback, with bonuses for touchdowns and penalties for interceptions and sacks.']
  ];
  function explain(root) {
    root.querySelectorAll('th, .tile .k, .mc-tiles span, .sublabel, .ph h3').forEach(el => {
      if (el.dataset.term || el.title && !el.classList.contains('sortable')) return;
      const t = el.textContent; if (t.length > 70) return;
      const hit = TERMS.find(([re]) => re.test(t)); el.dataset.term = hit ? '1' : '0';
      if (!hit) return;
      el.title = hit[1]; el.classList.add('term');
    });
  }
  // touch screens have no hover: tapping a term shows its explanation
  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('.term'); if (!el || !matchMedia('(hover: none)').matches) return;
    const box = document.querySelector('.toasts'); if (!box) return;
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = el.title; t.style.cssText = 'opacity:1;transform:none;border-radius:16px;max-width:min(92vw,420px);text-align:left;line-height:1.4';
    box.appendChild(t); setTimeout(() => t.remove(), 6000);
  });

  let queued = false;
  const run = () => { queued = false; try { tuck(document.body); explain(document.body); } catch (e) { console.error(e); } };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(document.body, { childList: true, subtree: true });
  run();

  /* ---------- back to top ---------- */
  const scroller = document.querySelector('main') || document.scrollingElement;
  const top = document.createElement('button'); top.id = 'toTop'; top.type = 'button'; top.setAttribute('aria-label', 'Back to top'); top.textContent = '↑';
  document.body.appendChild(top);
  const pos = () => Math.max(scroller.scrollTop || 0, window.scrollY || 0);
  const onScroll = () => top.classList.toggle('show', pos() > 900);
  scroller.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('scroll', onScroll, { passive: true });
  top.onclick = () => { const o = { top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }; scroller.scrollTo(o); window.scrollTo(o); };
})();
