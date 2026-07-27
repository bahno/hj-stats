# Generalizing hj-stats to all disciplines — research

**Date:** 2026-07-27
**Status:** Research complete; design pending approval
**Branch:** `worktree-all-disciplines`
**Scope decided:** Track & Field event groups only (road running, race walking and
combined events deferred). Real-athlete features first; calculator/simulator follow.
Project keeps the `hj-stats` name for now.

All API claims below were verified live on 2026-07-27 against a ranking dated
21 JUL 2026, not taken from documentation.

## 1. What generalizes for free

The data layer is very nearly discipline-agnostic already.

**European Athletics tRPC gateway.** `worldAthletics.getRanking` accepts an
`eventGroup` slug and returns an identical row shape for every event. Verified
working slugs: `100m`, `200m`, `400m`, `800m`, `1500m`, `5000m`, `10000m`,
`110mh`, `100mh`, `400mh`, `3000msc`, `high-jump`, `pole-vault`, `long-jump`,
`triple-jump`, `shot-put`, `discus-throw`, `hammer-throw`, `javelin-throw`.
`overall-ranking` also works. Rows already carry a `disciplines` field the app
currently ignores.

> Note: requests now need a browser-like `User-Agent`. A bare `curl` default UA
> gets a Cloudflare 403 on every event group, high jump included. The browser app
> is unaffected; the Deno poller sends its own UA and should be checked.

**`worldAthletics.getRankingScoreCalculation`** returns the same structure for
every event, including `disciplineList` and the per-result score breakdown. This
endpoint is the project's most valuable asset for generalization: it is an
**oracle**. For any athlete we can recompute the counting set ourselves and assert
our result equals WA's own `averagePerformanceScore`. That gives an automated
correctness test across all 36 group/gender combinations.

**WA GraphQL results feed** (`getSingleCompetitorResultsDate`) is already generic;
only our `discipline === 'High Jump'` filter narrows it.

**Road-to qualification.** Calling `worldAthletics.getCompetitionQualifyingSystem`
with only a `competitionId` and **no `eventId`** returns the competition's full
`events[]` list — `{id, genderCode, name}` for every event. Event IDs therefore do
not need hardcoding for other disciplines; they are discoverable at runtime. This
removed the largest expected unknown.

**Pure score math.** `engine/simulate.ts` — best-N average, projected place,
per-country quota walk, qualifying position — operates on plain numbers and is
reusable unchanged. Auth, favorites, retry/backoff, notification dispatch and the
UI shell are equally unaffected.

## 2. What generalizes with parameterization

### 2.1 An event group is a set of disciplines, not one

WA rules Table 2.12 defines each group as a main event plus "similar events", and
the ranking genuinely mixes them. Live example: Isaac Nader's `1500m` counting set
contains both `1500 Metres` and `1500 Metres Short Track` results.

| Group | Also counts |
|---|---|
| 100m | 50m, 55m, 60m |
| 200m | 200m sh |
| 400m | 300m, 300m sh, 400m sh, 500m, 500m sh |
| 800m | 600m, 600m sh, 800m sh, 1000m, 1000m sh |
| 1500m | 1500m sh, Mile, Mile sh, 2000m, 2000m sh, Mile Road Race |
| 5000m | 3000m, 3000m sh, 2 Miles, 2 Miles sh, 5000m sh, 5km Road Race |
| 10,000m | 10km Road Race |
| 110mH / 100mH | 50mH, 55mH, 60mH |
| 400mH | 300mH |
| 3000mSC | 2000mSC |
| Jumps, throws | (no similar events) |

Caveat: Table 2.12 uses WA *short* names (`1500m sh`) while both result feeds use
*long* names (`1500 Metres Short Track`). The registry must store long names.

### 2.2 The number of counting results is not 5

Verified from live calculations: 100m, 800m, 1500m and High Jump average **5**;
Marathon and Decathlon average **2**. Within the chosen T&F scope 5 holds
throughout, but `COUNTING_RESULTS` must still move onto the event descriptor
rather than stay a module constant, or the deferred families cannot be added.

### 2.3 The ranking window is not 12 months

WA rules, per family: **12 months** for Track & Field, **18 months** for the
10,000m group, and 18 months for road running, race walking and combined events.

Two further rules the current code does not implement:

- **Area Senior Outdoor Championships** count regardless of the window, provided
  they were held within 3 full calendar years. This already makes today's
  high-jump window logic wrong: Lamont Marcell Jacobs' current counting set
  includes a GL result from **08 JUN 2024** — two years before the rank date.
- **Overweighting.** For 12-month groups, only the latest edition of an OW or DF
  competition counts. For 18-month groups the previous OW edition is included but
  demoted to GL placing scores.

Both affect `substitutePool`'s reconstruction of the sixth-best result.

### 2.4 One placing table becomes many

`src/data/placing_points.json` currently holds only Table 2.2 (T&F final). The
tables genuinely differ — confirmed against live data, not just the rule book:

- Marathon, OW, 2nd place → **160**, where the T&F table says 230.
- Decathlon, OW, 1st place → **200**, where the T&F table says 260.

Tables on the five WA ranking-rules pages (all reachable, all HTTP 200, same DOM
shape the existing scraper already handles):

| Page | Tables |
|---|---|
| track-field-events-2025 | 2.2 final · 2.3/2.4 round before final (≥10 / <10 finalists) · 2.5–2.8 5000m & 3000mSC · 2.9 10,000m · 2.10 10km road · 2.12 event groups |
| combined-events-2025 | 3.1 placing · 3.3 event groups |
| road-running-2025 | 4.1 marathon · 4.2 half/25km/30km · 4.3 road group · 4.5 event groups |
| race-walking-2025 | placing + groups |
| cross-country-2025 | placing + groups |

In scope now: 2.2, 2.3, 2.4, 2.5–2.8, 2.9, 2.10, 2.12.

### 2.5 Scoring tables

`pipeline/parse_scoring.py` extracts a single high-jump column from the jumps and
throws section of the WA Scoring Tables PDF, using hardcoded page ranges. Covering
T&F means all columns of that section plus the men's and women's track sections,
with marks in time format. This is deferred to the calculator phase — real-athlete
features need no scoring table at all, because WA supplies `resultScore` for every
real result.

### 2.6 Storage

`favorites` and `ranking_snapshots` are keyed on `(athlete_slug, gender)`. One
athlete can be ranked in several event groups (a 100m sprinter is also in the
200m group), so the event group must join the key. `notify_prefs` and the
snapshot rows follow.

## 3. What has to be built new

### 3.1 A mark model

Today every mark is a height in metres, formatted with `toFixed(2)` and compared
higher-is-better. Across T&F, marks appear as:

| Form | Example | Direction |
|---|---|---|
| Height/distance, metres | `2.30`, `8.19` | higher better |
| Sprint/middle time, seconds | `9.67`, `47.85` | lower better |
| Time with minutes | `1:42.29`, `3:34.10` | lower better |

Parsing, formatting, comparison direction, and the picker UI
(`HeightSelect`/`WheelPicker` is metres-specific) all need a per-unit abstraction.
Sorting and "is this an improvement" logic currently assume higher-is-better in
several places.

### 3.2 Non-final rounds count on the track

This is the largest new rules surface. Live evidence:

- Max Burgin's counting set includes a Tokyo **semi-final** (`race: 'SF'`, 3rd),
  scored with **100** placing points.
- Jacobs' counting set includes a **heat** (`race: 'H'`, 1st) with **0** placing
  points — the mark alone carried it in.

Current `engine/counting.ts` scores finals only, plus a four-entry hardcoded
`QUAL_TO_FINAL_PLACING` map for high-jump qualification rounds. Generalizing needs
round-type detection (`F`/`F1`/`SF`/`H`/`Q`) driven by the real Tables 2.3/2.4.

Open problem: Tables 2.3 and 2.4 differ by whether the final had **≥10 or <10
competitors**, and neither feed reports that. Championship track finals are
typically 8, championship high jump finals ≥10 — so the current code's implicit
≥10 assumption is right for high jump and likely wrong for the track. Options:
infer the finalist count from the competition's own result list, or accept a
per-family default and validate against the oracle. To be settled in the design.

### 3.3 Event selection throughout the UI

Calculator, athlete lookup, comparison chart, favorites and notification
preferences all currently assume one event. Needs an event selector and event
carried in app state/URL.

### 3.4 Poller scale

`notify-poll` fetches two ranking lists per run (men's and women's high jump). At
36 group/gender combinations a naive generalization is 18× the traffic against an
undocumented, Cloudflare-fronted API. It must fetch only the groups that at least
one favorite actually references.

### 3.5 Wind modification

Table 2.1 adjusts sprint, hurdle, long jump and triple jump marks for wind. Only
relevant once the calculator/simulator covers those events (deferred phase), but
it has no analogue in the current code.

## 4. Verification strategy

`getRankingScoreCalculation` is a ground-truth oracle. A fixture test that, for a
sample of athletes spanning all 18 T&F groups, reconstructs the counting set from
the profile results feed and asserts it matches WA's own set and average will
catch window errors, membership errors and round-placing errors at once. This is
the main defence against silently mis-scoring 17 new events.

## 5. Open questions for the design

1. Finalist count for Tables 2.3 vs 2.4 (see 3.2).
2. Whether to implement the overweighting and Area-Championship window exceptions
   now — they are pre-existing bugs for high jump, so fixing them is arguably in
   scope regardless.
3. Where the event registry lives: hand-authored, scraped at build time from
   Table 2.12, or harvested from observed `disciplineList` values. Harvesting
   yields exactly the long names the feeds use; Table 2.12 is authoritative but
   uses short names. A cross-check of both is the likely answer.
