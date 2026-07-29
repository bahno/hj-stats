# Handoff: all-disciplines, engine done, UI next

Rewritten 2026-07-28. Read this first, then the plan it points at.

## Where the work lives

- Worktree: `C:\Users\Marek\Desktop\projects\.claude\worktrees\all-disciplines`
- Branch: `worktree-all-disciplines`, draft PR #16 (`https://github.com/bahno/hj-stats/pull/16`)
- Plan just executed: `docs/superpowers/plans/2026-07-27-all-disciplines-engine.md` (all 9 tasks)
- Research: `docs/superpowers/specs/2026-07-27-all-disciplines-research.md`
- Working tree carries an untracked `claude.md` at the root that is not part of this work. Leave it.

## What is done

The **scoring engine** is generalized from high jump to all 36 World Athletics Track & Field
event groups, and verified against World Athletics' own `getRankingScoreCalculation` payloads
for every one of them.

A single `EventGroup` descriptor (`src/data/events.ts`) is the only thing that knows anything
discipline-specific: which disciplines belong to the group, how many results are averaged, how
long the ranking window is, how marks are written, which placing tables apply. Every engine
function takes it as a parameter.

| Module | What it owns |
|---|---|
| `src/data/events.ts` | `EventGroup` registry over all 36 groups, `findEventGroup` |
| `src/engine/mark.ts` | parse/format/compare marks across heights, distances, times, points |
| `src/engine/rounds.ts` | `classifyRounds`, `advancedToFinal` |
| `src/engine/placing.ts` | placing points across all 9 tables of the 2026 rules |
| `src/engine/dates.ts` | `parseWaDate`, `oneYearEarlier` |
| `src/engine/window.ts` | `rankingWindow`, `fixedPeriodWindow`, `isInWindow` |
| `src/engine/counting.ts` | `isCountableResult`, `scoreResults`, `substitutePool` |
| `pipeline/harvest_disciplines.py` | harvests each group's long discipline names live |
| `scripts/capture-oracle-fixtures.mjs` | captures WA payloads as committed fixtures |
| `scripts/capture-deep-calculations.mjs` | surveys mid-table and lower-ranked athletes |

**Verified state:** 43 test files / 445 tests pass, `npx tsc -b` exits 0, `npm run build`
succeeds. `python pipeline/verify_rules.py` and `python pipeline/verify.py` both exited 0 at the
end of the engine work and nothing since has touched the pipeline.

## What is next: the UI and storage plan

The UI half is done (section 1). Storage and the poller are not, and they are the parts that
can corrupt data rather than merely look wrong.

### 1. Event selection in the UI - DONE

`src/components/inputs/EventGroupSelect.tsx` is a native select grouped into Track / Jumps /
Throws, showing the 18 groups of the selected gender. `AthleteLookup` threads the chosen
`EventGroup` (not a gender) through `ranking`, `roadToBirmingham`, `select` and `runLookup`, so
the selected group and the gender can no longer disagree; the ranking and road caches are keyed
`slug:gender`. The selected group travels with the result in `Found.group`, so changing the
picker can't relabel an athlete already on screen. `counterpartGroup` in `src/data/events.ts`
carries a selection across a gender switch, including the hurdles, whose slugs differ by gender
(110mH / 100mH).

Marks now render with `markSuffix(group.mark)` - " m" for heights and distances, nothing for
times, since "9.67 s" reads worse than "9.67".

**The simulator is high-jump-only and is now gated, not hidden.** `scoring_table.json` holds one
event, so `hasScoringTable(scoringTable, group)` decides whether `SimulateResult` renders at all;
every other group gets a line saying its scoring table isn't loaded. That gate disappears on its
own when the scoring-tables work lands. Until then, do not "generalize" the simulator - there is
nothing to score against.

**The selection now persists** the same way the gender does. `profiles.default_event`
(migration `0006_default_event.sql`) holds the group's gender-neutral slug, written on every
pick in `AthleteLookup` exactly as the calculator's toggle writes `default_gender`. A gender
switch saves the *counterpart's* slug, since the hurdles differ by gender. An unresolvable
slug falls back rather than erroring. Signed-out users get no persistence, which is also
true of the gender today.

**Rankings is the landing view**, not the calculator, and leads the tab row. The calculator is
still high-jump-only, so it should not be the first screen; flip `Shell`'s initial `view` back
once the scoring tables land.

**State is shareable.** `src/urlState.ts` merges query parameters rather than replacing them,
since `App` owns `view` and `AthleteLookup` owns `gender`/`event`/`type`/`q`. The athlete is
carried as the search text, not a slug, so a link reuses the ordinary lookup path and degrades
to the candidate list when the name is ambiguous. A link outranks `default_event`: if the URL
says anything about the lookup, the saved preference is not applied at all. Writes are
`replaceState`, so the picker does not fill the Back button.

Because the app now writes to the URL and jsdom shares one window per test file, `test-setup.ts`
resets the query string before each test. Without it, an event picked in one test decides the
starting state of the next.

**A favorite carries the disciplines it is followed in.** `favorites.event_groups text[]`
(migration `0007_favorite_event_groups.sql`) holds ranking API slugs, same gender-neutral values
as `profiles.default_event`. The product decision behind it: **a favorite is a person, not a
person-in-an-event.** One row per athlete, so following Duplantis in the pole vault and the 100m
costs one of the 50 favorite slots, not two, and the star stays per person - it lights up in
every group, which is correct under this model. The set is edited in `NotificationSettings`,
next to `notify_prefs`, as chips plus an add-select; the last discipline can't be removed, since
a favorite followed in nothing is what un-starring is for. A new favorite starts out followed in
whatever group the star was clicked in. A favorite chip in the lookup now searches one of the
athlete's own disciplines rather than whatever the picker shows - the current selection if they
are followed in it, otherwise their first.

`notify-poll` still reads the high jump ranking only, so it now **skips favorites not followed
in `high-jump`** rather than mailing high jump news about a sprinter. That filter is the seam
section 3 widens.

One thing deliberately left alone:

- `src/engine/simulate.ts:6` still exports a module-level `COUNTING_RESULTS = 5` rather than
  reading `EventGroup.countingResults`. It only runs behind the high-jump gate now, so threading
  the field through today would be dead configurability. Do it when a group with a different
  count (combined events use 2) actually becomes reachable.

**The product is called Track Rank and lives at the root of `bahno.info`.** `index.html`,
`Logo.tsx`, `README.md`, the unsubscribe page and the notification From name carry the name.
The domain move retired the `/hj-stats/` subpath: Vite's `base` is `/`, `public/CNAME` pins the
domain into the Pages artifact, `og:image`/`og:url` are absolute (crawlers don't resolve a
relative `og:image`), and `delete-account`'s ALLOWED_ORIGINS fallback is the new origin - a stale
value there is a CORS failure on account deletion, not a cosmetic one. The repo and the npm
package name are still `hj-stats`; renaming those is the user's call.

**Supabase Auth redirect URLs are not in this repo** and still point at the old address. Add
`https://bahno.info/` in the dashboard, or every confirmation and password-reset link sends
people to a site that no longer exists there.

### 2. Storage schema - this is the part that will bite

**`ranking_snapshots` has primary key `(athlete_slug, gender)`** (`supabase/migrations/0002_notifications.sql:23`).
One row per athlete per gender. The moment a user tracks the same athlete in two event groups,
or two groups' pollers both write, snapshots **silently overwrite each other** and the progress
timeline becomes wrong without any error. This key must gain the event group. Needs a migration
plus a backfill decision for existing rows (they are all high jump, so backfill is a constant).

**`favorites` is unique on `(user_id, athlete_slug, gender)`** (`supabase/migrations/0001_init.sql:17`)
and that stays. The person-vs-person-in-an-event question is **settled: a favorite is a person**,
carrying an `event_groups text[]` of the disciplines to report on (migration `0007`). See
section 1. Existing rows were backfilled to `high-jump`, which is what they all were.

### 3. Scaling the poller

`supabase/functions/_shared/ea.ts` is high-jump-only in three places:

- line 92 - `if (c?.discipline !== 'High Jump') continue;`
- lines 165 and 173 - `eventGroup: 'high-jump'` in the paginated ranking fetch

`notify-poll/index.ts` now filters favorites to those whose `event_groups` contains `high-jump`,
so the poller's reach is honest about what it actually reads. That filter is also the answer to
"which groups does anyone actually follow" - the union of every favorite's `event_groups` is the
poll set, and it will be far smaller than 72.

Going to all groups means 36 groups x 2 genders = **72 paginated ranking fetches per poll**, up
from 2. That is a different order of cost and runtime, and Deno edge functions have execution
limits. Options worth costing before writing code: poll only groups some user actually favorites;
shard across scheduled runs; or keep a per-group cursor. Do not just wrap the existing call in a
loop over 36 groups and hope.

Reuse `EventGroup.disciplines` for the line-92 filter instead of a hardcoded string. The comment
there says it mirrors "the frontend's High Jump filter", which no longer exists in that form.

## Traps, learned the hard way

- **The EA gateway 403s on TLS fingerprint, not headers.** Python `requests` and Node
  `fetch`/undici both fail against `api.european-athletics.com` no matter what headers you send.
  Python stdlib `urllib.request` with a browser `User-Agent` works, and so does `curl`.
  `scripts/capture-oracle-fixtures.mjs` already routes around it via a `python -c` helper. Reuse
  that. This cost hours twice. The WA AppSync GraphQL endpoint has no such front.
- **`pipeline/scrape_rules.py` overwrites `src/data/event_groups.json` wholesale** and drops the
  harvested `disciplines` arrays. It must always be followed by `pipeline/harvest_disciplines.py`.
  `pipeline/README.md` documents the order. `verify_rules.py` catches it if you forget.
- **`pipeline/rules_anchors.py` values were read off the rendered page by eye, before the
  extractor existed.** Never regenerate them from extractor output; that would defeat the entire
  point of having them.
- **Two scoring paths coexist.** `combinedScore` reads `placing_points.json` (Table 2.2) and
  `scoreResults` reads `placing_tables.json` (all 9 tables). They agree exactly on finals today,
  which is precisely the kind of agreement that drifts unnoticed. Collapsing them belongs in the
  UI migration, since `score.ts`'s signatures were kept working on purpose.
- **Road rankings use a fixed published window**, not a rolling one. Birmingham publishes
  27 JUL 2025 - 26 JUL 2026 for both the entry-standard and world-ranking routes, so the Area
  Championships allowance must stay off that path. `fixedPeriodWindow` encodes this. Confirmed
  against birmingham26.com.
- **Non-final rounds do score.** A semi-final placing scores 100. A heat scores 0 only because
  Tables 2.3/2.4 have no columns below GL. "Scores nothing" and "not ranked" are different
  states, and empty table cells are omitted rather than stored as 0.
- **`notLegal` is not a filter.** It marks a mark ineligible for records and lists, not for the
  ranking. World Athletics counts wind-aided marks.

## Open engine items

These are documented in the PR body and are NOT blockers for the UI work.

- **One unexplained selection divergence, held as `it.fails`.** World Athletics sometimes leaves
  a strictly higher-scoring result out of the average. Aleksandra ZAUCHA's 11 JUL 2026 result
  scores 1027 and is omitted in favour of a 27 JUN 2026 one scoring 1005; Juan Antonio PÉREZ
  (Men's 10,000m) shows the same shape, a 1107 road result passed over for a 1103. Some
  eligibility rule we do not implement is at work. Two observations is not enough to name it, so
  it is recorded in `KNOWN_SELECTION_DIVERGENCE` in `src/engine/oracle.test.ts` rather than
  guessed at. **This is the most promising lead left in the engine** - a third observation would
  probably crack it, and `scripts/capture-deep-calculations.mjs` is the tool for finding one.
- **Tables 2.6/2.7/2.8** (round before the final for 5000m, 3000mSC, 10000m) have no counting
  result in any fixture, so that path is unexercised by the oracle.
- **Equal-score-and-equal-mark ties are arbitrary.** `byCountingOrder` falls back to newest-first,
  which matched 5 of 8 observed cases. There is no rule in the data; do not invent one.

### Settled, do not re-litigate

- **Blank round codes are a non-issue.** The worry was that a result with `race: ''` classifies
  as `other` and loses its placing points. A survey of 330 captured calculations - 1534 counting
  rows and 14578 profile rows, sampled down to ranking place 1101 - found **zero** blank or
  missing race values. Changing `src/engine/rounds.ts` for this would be fixing an imagined bug.
- **The tie-break is now evidence-backed**, not a guess: a tied score goes to the higher mark
  score, 7 of 7 discriminating observations. Four tie fixtures are committed under
  `src/engine/__fixtures__/oracle/tie-*.json` to pin it.
- Rare similar-events (50m, 300mH, Mile Road Race) are missing from the harvested `disciplines`
  lists because the harvest sampled the top 25 per group. Fix is a deeper
  `pipeline/harvest_disciplines.py --sample`, never a hand-edit of the JSON.

## Still out of scope

- **Scoring tables** (mark to performance points). The user is doing this research themselves.
  `pipeline/parse_scoring.py` currently extracts the high jump column only, via hardcoded PDF
  page ranges.
- **Overweighting** (only the latest OW/DF edition counts) - documented, not implemented.
- Road running, race walking, combined events, cross country. Race walk slugs were never found in
  the EA ranking API.
