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
python parse_scoring.py            # writes scoring_tables.json (and scoring_table.json)
python parse_scoring.py path.pdf   # same, from an already-downloaded copy of the PDF
python verify.py                   # checks them against anchors and the WA oracle
```

Parses the official Scoring Tables PDF into `scoring_tables.json`: the mark → points
table for all 36 Track & Field event groups, keyed by the same slugs as
`event_groups.json`. Takes about ten minutes — pdfplumber reads 846 pages.

It does **not** hardcode page ranges. Every data page in the book names its own
columns in a header, and two layouts alternate (the score is the first column on one
page, the last on the next), so the parser reads the headers and picks out the columns
it wants. Page ranges would need re-reading by hand every time World Athletics
repaginates the book, and would fail silently when they did.

Only the main event of each group is extracted. A group covers similar events too — the
100m group counts a 60m result — but those score off their own column, and the app never
scores a real result itself: World Athletics hands it the mark points. These tables are
for the simulator, which asks what a hypothetical mark in the group's own event is worth.

`scoring_table.json` is the high-jump-only file the app reads today. It is written from
the same extraction, byte for byte what it was before, so the two cannot drift. Both it
and the code that writes it go away once the app reads `scoring_tables.json`.

### What "verified" means here

`verify.py` runs two checks:

- **By-eye anchors** — one (mark, score) pair per event group, transcribed by hand from
  the raw page text, covering both page layouts and both genders. These catch structural
  regressions: a column read one place across, a section attributed to the wrong gender.
  As with `rules_anchors.py`, never regenerate them from the extractor's own output.
- **The World Athletics oracle** — every counting result in
  `src/engine/__fixtures__/oracle/` carries the mark World Athletics scored and the points
  it awarded. This checks the tables against World Athletics rather than against the book.

The oracle currently reproduces **152 of 152** captured results exactly in the 13 events
where no wind is measured. It is not asserted for the six wind-affected events (100m,
200m, 110mH/100mH, long jump, triple jump): World Athletics adjusts those scores for the
wind, up for a headwind and down for a tail, the adjustment is not in the scoring tables,
and the captured calculations do not carry the wind reading. 20 such results sit a few
points either side of the book, and `verify.py` counts them rather than failing on them.
`notLegal` (wind-aided) results are the same story — they are still ranked, at an
adjusted score.

### Sparse tables

The book lists 1400 scores per event, and for the shorter events that is more scores than
there are distinct marks (men's high jump has 163). For the longer ones it is the other
way round: a 10,000m has far more possible times than the book has rows, so most marks
are **not** in the table. Looking a mark up therefore cannot be an exact match. The book's
rule is "should a performance fall between two results on the tables the lower score shall
be considered", and that is what `verify.py` applies — and what the app has to apply too.
