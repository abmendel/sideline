/* Sideline shell: small UI behaviour shared by every sport page.
   - On phones the sidebar becomes a tab bar with four sections plus "More",
     which opens a sheet listing the remaining sections.
   - Tells the hub when the appearance setting changes so every sport matches.
   Loaded after the page script, so the page's own tab handlers are in place. */
(() => {
  'use strict';
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  const PRIMARY = ['scores', 'mine', 'standings', 'picks'];
  const navs = () => [...tabs.querySelectorAll('.nav[data-tab]')];
  const secondary = () => navs().filter(b => !PRIMARY.includes(b.dataset.tab));

  const more = document.createElement('button');
  more.className = 'nav more';
  more.type = 'button';
  more.dataset.label = 'More';
  more.setAttribute('aria-haspopup', 'dialog');
  more.innerHTML = '<span class="ic"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></span>More';
  tabs.appendChild(more);

  const scrim = document.createElement('div');
  scrim.className = 'morescrim';
  const sheet = document.createElement('div');
  sheet.className = 'moresheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'More sections');
  document.body.append(scrim, sheet);

  // same name the sidebar shows (the button's own text, without the count badge)
  const label = b => [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() || b.dataset.label;
  function render() {
    sheet.innerHTML = '<div class="grab"></div><h3>More</h3><div class="list">' +
      secondary().map(b => `<button type="button" data-go="${b.dataset.tab}" class="${b.classList.contains('on') ? 'on' : ''}">${b.querySelector('.ic') ? b.querySelector('.ic').outerHTML : ''}${label(b)}</button>`).join('') +
      '</div>';
    sheet.querySelectorAll('[data-go]').forEach(x => x.onclick = () => {
      const t = tabs.querySelector(`.nav[data-tab="${x.dataset.go}"]`);
      close(); if (t) t.click();
      window.scrollTo({ top: 0 });
    });
  }
  function open() { render(); scrim.classList.add('open'); sheet.classList.add('open'); const f = sheet.querySelector('button'); if (f) f.focus(); }
  function close() { scrim.classList.remove('open'); sheet.classList.remove('open'); }
  more.onclick = open;
  scrim.onclick = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.classList.contains('open')) { e.stopPropagation(); close(); more.focus(); } }, true);
  let startY = null;   // swipe the sheet down to dismiss
  sheet.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchend', e => { if (startY != null && e.changedTouches[0].clientY - startY > 60 && sheet.scrollTop <= 0) close(); startY = null; });

  // "More" is selected whenever the current section lives in the sheet
  const sync = () => {
    const cur = navs().find(b => b.classList.contains('on'));
    more.classList.toggle('on', !!cur && !PRIMARY.includes(cur.dataset.tab));
    navs().forEach(b => b.setAttribute('aria-current', b.classList.contains('on') ? 'page' : 'false'));
  };
  new MutationObserver(sync).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });
  sync();

  // appearance chosen in Settings -> tell the hub so the other sports follow
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-set="theme"] button[data-v]');
    if (b && window.parent !== window) setTimeout(() => parent.postMessage({ hub: 1, type: 'theme', tv: b.dataset.v }, '*'), 0);
  }, true);
})();
