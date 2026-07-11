# Road to Birmingham — Design

**Date:** 2026-07-11
**Status:** Approved, pre-implementation
**Repo:** hj-stats

## Context

hj-stats already looks up an athlete's High Jump ranking (European/World place, ranking
score, counting competitions) via the European Athletics tRPC API. This feature adds
their qualification status for the **2026 European Athletics Championships**
(Birmingham, 10–16 Aug 2026) — the "Road to Birmingham" — inline in that same lookup.

## Data source

EA's open (no-auth, CORS-open) tRPC gateway exposes
`worldAthletics.getCompetitionQualifyingSystem`, verified live 2026-07-11:

```
GET https://api.european-athletics.com/trpc/worldAthletics.getCompetitionQualifyingSystem
    ?input={"json":{"competitionId":7192415,"eventId":<eventId>}}
```

- `competitionId: 7192415` = 2026 European Athletics Championships (Birmingham).
- `eventId`: `10229615` (Men's High Jump), `10229526` (Women's High Jump). Hardcoded —
  scoped to this specific championship edition, same as the app's existing hardcoded
  2025 scoring tables.
- Response is a single JSON payload (no pagination) with ~89 tracked entries per gender,
  including both already-qualified athletes and the next-best-by-rankings "bubble".
- Each entry's `competitor.urlSlug` is in the **same format** as the existing
  `RankingRow.athleteUrlSlug` (e.g. `italy/gianmarco-tamberi-14375750`), so an athlete
  found via the existing ranking lookup can be matched to their qualification entry by
  an exact string match — no fuzzy matching needed.
- Relevant response shape (fields actually used):
  ```ts
  {
    entryNumber: number;        // total qualifying spots (30 for HJ)
    entryStandard: string;      // e.g. "2.27"
    rankDate: string;
    qualifications: Array<{
      qualifiedBy: string;             // e.g. "Qualified by Entry Standard"
      qualificationTypeId: string;     // "q1" | "q4" | "q7" | "n4" | ...
      qualified: boolean;
      qualificationPosition: number | null; // set only when qualified
      countryPosition: number | null;
      competitor: { athleteId: number; name: string; country: string; urlSlug: string };
      withdrawn: boolean;
      rejected: boolean;
      qualificationDetails: {
        label?: string;            // e.g. "Defending European Champion"
        result?: string; venue?: string; date?: string;  // entry-standard qualifiers
        place?: number; score?: number;                  // world-rankings qualifiers
      };
    }>;
  }
  ```
- Risk: undocumented endpoint, schema/host can change without notice (consistent with
  the existing ranking API — see the `wa-ea-ranking-apis` reference). This feature must
  degrade gracefully, not break the existing lookup, if the call fails or the shape
  changes.

## Scope

- High Jump only, both genders — matches the app's existing single-purpose scope.
- Inline addition to the existing athlete lookup result (`AthleteLookup.tsx`), **not** a
  new screen or nav item. Works for whichever athlete is searched.
- Three display states per looked-up athlete:
  1. **Qualified** (`qualified: true`) — status pill + the relevant detail line
     (entry-standard mark/venue/date, or world-rankings place/score, or a special-case
     label like "Defending European Champion") + their position out of `entryNumber`
     qualifying spots.
  2. **On the bubble** (`qualified: false`, i.e. `qualificationTypeId: "n4"`) — a muted
     "not currently qualifying" pill + their world-rankings place/score.
  3. **Not tracked** — athlete isn't among the returned entries at all (ranked too far
     down) — a single muted line, no pill.
- Out of scope: a full browsable qualification table/leaderboard (deferred — user chose
  inline-only for v1); country-quota (max 3/country) explanation beyond what the API's
  `qualified` flag already encodes; other events.

## Architecture

- **`src/data/rankingApi.ts`**: export the existing private `trpc()` helper so it can be
  reused (currently module-private).
- **New `src/data/birminghamApi.ts`**:
  - Constants: `BIRMINGHAM_COMPETITION_ID`, `HIGH_JUMP_EVENT_ID: Record<Gender, number>`.
  - Types: `QualificationEntry`, `RoadToBirmingham` (as shown above).
  - `fetchRoadToBirmingham(gender): Promise<RoadToBirmingham>` — one `trpc()` call.
  - `findQualification(data, athleteUrlSlug): QualificationEntry | undefined` — pure,
    unit-testable matching helper.
- **`AthleteLookup.tsx`**:
  - A second cache `Map<Gender, RoadToBirmingham>`, same pattern as the existing
    ranking cache, populated lazily on first athlete select per gender.
  - On `select()`, fetch the Road to Birmingham data **independently** of the main
    `calc`/`peers` fetch (own loading/error state) — a failure here must not block or
    error the rest of the athlete result.
  - New `RoadToBirmingham` presentational component, rendered in `Result` below the
    existing `lookup-stats` grid, given the matched entry (or `undefined`) + the
    `entryNumber`/`entryStandard` context.

## Visual design

Reuses existing tokens — no new colors invented:
- Qualified pill: `--pos` (green), same token used for positive ranking deltas.
- Bubble pill: muted/outlined (`--muted` border, transparent fill) — "close but not
  there" without implying success or failure.
- Not-tracked: plain muted text line, no pill.
- Layout/typography matches the existing `.stat`/`.cat-badge` vocabulary (tabular
  numerals via `--mono`, uppercase `--display` labels).

## Error handling

- Road to Birmingham fetch is decoupled from the main lookup: on failure, log to
  console and render the "not tracked" state — the existing ranking/score/competition
  result is unaffected.
- No retry logic — matches the existing lookup's behavior on ranking-fetch failure.

## Testing

- `birminghamApi.test.ts`: unit tests for `findQualification` against a small fixture
  (match found, no match, gender mismatch not applicable since callers pass the
  already-gender-scoped data).
- `AthleteLookup.roadToBirmingham.test.tsx`: component tests, mocking
  `fetchRoadToBirmingham`, for all three states (qualified / bubble / not tracked) plus
  a fetch-failure case asserting the rest of the result still renders.

## Addendum (2026-07-11): Simulate source switch

Extends the Simulate panel with a switch between two bases for the projection:

- **World ranking** (default, unchanged) — the athlete's live World/European ranking
  calculation and European peers, as before.
- **Road to Birmingham** — the athlete's Birmingham-scoped counting results (fetched via
  the existing `fetchRankingCalculation`, but keyed on the qualification entry's
  `qualificationDetails.calculationId` rather than their live ranking id) and peer scores
  drawn from the world-rankings pool (`q4`/`n4` entries) instead of the full European
  ranking list.
- The switch only appears when the athlete has a world-rankings-pool entry (i.e. a
  `calculationId` — entry-standard/label-qualified or untracked athletes only ever see
  "World ranking").
- New pure engine helpers (`qualifyingPosition`, `withinWorldRankingQuota` in
  `engine/simulate.ts`) combine the fixed non-ranking-route slot count
  (`entryNumber - numberOfCompetitorsFilledUpByWorldRankings`) with the existing
  `projectedPlace` pool rank to compute a real "#N of 30" qualifying position and whether
  it crosses into the qualifying bracket — this mirrors the arithmetic the API itself
  uses (verified against a live example: 13 entry-standard spots + 1st in the ranking
  pool = qualifying position 14).
- Fetching the Birmingham-scoped calculation is decoupled the same way as the Road to
  Birmingham fetch itself: failure leaves `roadCalc` `null` and the switch simply doesn't
  appear, rather than breaking the result.

**Follow-up fix (same day):** users noticed the World-ranking and Road to Birmingham
"5 counting results" can list genuinely different competitions for the same athlete —
confirmed live (Thomas Carmoy, BEL) this is expected, not a bug: the Road to Birmingham
pool uses a fixed qualifying window (`firstRankingDay`/`lastRankingDay`, e.g. 27 JUL 2025
– 26 JUL 2026 for the current edition) that's narrower than the athlete's live rolling
World/European ranking window, so a result just outside one window but inside the other
gets swapped for the next-best counting result. Added `firstRankingDay`/`lastRankingDay`
to `RoadToBirmingham` and surfaced them as a caption under the switch when Birmingham
mode is active, so this reads as intentional rather than a data mismatch.
