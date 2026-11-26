/* =====================================================================
   Sideline · holiday theme switch
   Turns the decoration in holiday.css on for the holidays and off again on
   its own. The window is the only rule: from November 26 through December 31
   it is on; at midnight on January 1 it stops, with nothing to remember and
   no server involved. ?xmas=1 forces it on, ?xmas=0 forces it off.
   ===================================================================== */
(() => {
  const ON_FROM = [10, 26];                        // Nov 26 (months are zero-based)
  const OFF_FROM = [0, 1];                         // Jan 1 — the morning it all comes down

  const inSeason = (d = new Date()) => {
    const m = d.getMonth(), day = d.getDate();
    if (m === 11) return true;                     // all of December
    if (m === ON_FROM[0] && day >= ON_FROM[1]) return true;
    return false;                                  // January onward: back to normal
  };

  let force = null;
  try {
    const q = new URLSearchParams(location.search).get('xmas');
    if (q === '1' || q === 'on') force = true;
    if (q === '0' || q === 'off') force = false;
  } catch (e) { /* ignore */ }

  const on = force === null ? inSeason() : force;
  const root = document.documentElement;
  if (!on) { root.classList.remove('xmas'); return; }
  root.classList.add('xmas');

  const build = () => {
    if (document.querySelector('.xsnow')) return;
    // the hub is a frame around a sport page, which draws its own snow
    const isShell = !!document.querySelector('iframe.sport');
    let snow = null;
    if (!isShell) {
      snow = document.createElement('div');
      snow.className = 'xsnow';
      snow.setAttribute('aria-hidden', 'true');
      snow.innerHTML = '<i></i><i></i><i></i>';
    }

    const lights = document.createElement('div');
    lights.className = 'xlights';
    lights.setAttribute('aria-hidden', 'true');
    const bulbs = ['#e0162b', '#1e8e4b', '#f2b418', '#2a6fd6', '#e0162b', '#f2f2f2'];
    const n = Math.min(22, Math.max(7, Math.round(window.innerWidth / 62)));
    let html = '';
    for (let i = 0; i < n; i++) {
      const c = bulbs[i % bulbs.length];
      html += `<i style="left:${((i + .5) / n * 100).toFixed(2)}%;background:${c};animation-delay:${(i * .37 % 3.2).toFixed(2)}s"></i>`;
    }
    lights.innerHTML = html;

    document.body.append(...(snow ? [snow, lights] : [lights]));
  };

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build, { once: true });
})();
