# Data pipeline

Regenerates the static data files in `src/data/` from World Athletics sources.
Nothing here runs in CI — these are manual, run when World Athletics publishes a
new edition of the rules or the scoring tables.

```bash
pip install -r requirements.txt
```

## Ranking rules (placing scores, event groups, categories, wind)

```bash
python scrape_rules.py        # writes placing_tables.json, event_groups.json, placing_points.json
python harvest_disciplines.py # adds each group's long discipline names to event_groups.json
python verify_rules.py        # checks the output against by-eye anchors; non-zero on mismatch
```

Run them in that order. `scrape_rules.py` **overwrites** `event_groups.json` from the
rules page alone, which drops the `disciplines` arrays; `harvest_disciplines.py` puts
them back by reading real ranking calculations off the live gateway. Re-running the
scraper without the harvester leaves every group with no discipline names, and
`verify_rules.py` will say so. The harvester takes about ten minutes at the default
sample size.

Ground truth is `https://worldathletics.org/world-ranking-rules/track-field-events-<year>`.

**The rules are versioned per year and the values move a lot between editions** —
an OW win scored 375 under the 2025 tables and 260 under 2026. `RANKING_YEAR` in
`scrape_rules.py` selects the edition. Bumping it means re-reading every anchor in
`rules_anchors.py` by eye from the new page; the anchors exist precisely so a
parser change cannot quietly redefine what "correct" means, and copying the
extractor's own output into them would defeat that.

`placing_points.json` is the single-table file the app's engine reads today. It is
regenerated as an exact copy of Table 2.2 so the current code keeps working while
the engine is generalised to the full table set.

## Scoring tables (mark → performance points)

```bash
python parse_scoring.py   # writes scoring_table.json
python verify.py          # checks the scoring table against by-eye anchors
```

Parses the official Scoring Tables PDF. Currently extracts the high jump column
only, using hardcoded page ranges — generalising this to every Track & Field event
is outstanding work.
