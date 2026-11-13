# Sideline · Live Sports

Live NBA, NFL, MLB, NHL and soccer dashboards in one site, with a sport switcher in the header.
Data comes from ESPN's public feeds, loaded in the browser.

- `index.html` – the hub: holds the list of sports and switches between them.
- `sports/nba.html`, `sports/nfl.html`, `sports/mlb.html`, `sports/nhl.html`, `sports/soccer.html` – one self-contained dashboard per sport.

To add a sport: add its page under `sports/` and one line to the `SPORTS` list in `index.html`.

Hosted free on GitHub Pages from the `main` branch (repo root, no build step): https://abmendel.github.io/sideline/

## Learning model

`learn/learn.mjs` runs twice a day on GitHub Actions (`.github/workflows/learn.yml`). It stores every game result
(two seasons) and pre-game odds snapshot in `data/<sport>-games.json`, rebuilds Elo ratings, refits the prediction
weights, grades itself on games it hadn't seen yet, and writes `data/model-<sport>.json`, which the dashboards load.
Run it by hand from the Actions tab ("Retrain prediction models" → Run workflow) or locally with `node learn/learn.mjs`.
