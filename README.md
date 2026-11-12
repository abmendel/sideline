# Sideline · Live Sports

Live NBA, NFL and MLB dashboards in one site, with a sport switcher in the header.
Data comes from ESPN's public feeds, loaded in the browser.

- `index.html` – the hub: holds the list of sports and switches between them.
- `sports/nba.html`, `sports/nfl.html`, `sports/mlb.html` – one self-contained dashboard per sport.

To add a sport: add its page under `sports/` and one line to the `SPORTS` list in `index.html`.

Deployed on Netlify from this repository (no build step; publish directory is the repo root).
