# Rankings tab layout + country-quota simulation — Design

**Date:** 2026-07-11
**Status:** Approved, pre-implementation
**Repo:** hj-stats

## Context

The Rankings tab (`AthleteLookup.tsx`) currently renders, top to bottom: gender/search
form, a 3-stat row (Score / European # / World #), a standalone "Road to Birmingham"
panel (only when `rankingType === 'road'`), the ranking-type toggle, the counting
competitions list, and the simulate tile. An uncommitted WIP (`0c2ec38`, `e0b8a81`)
introduced the three-way `RankingType` toggle (world/european/road) but wired it up
awkwardly — the toggle sits mid-result rather than governing the whole result, and the
desktop two-column CSS grid (`.lookup-result`) doesn't have an area for it.

This pass reorganizes that layout and fixes a real gap in the "Road to Birmingham"
simulation: the position projection ignored the **max-3-competitors-per-country** rule
that governs the actual World Rankings qualifying pool.

## Layout

Reordered, single flow (mobile stacks in this order; desktop splits the last two into
columns via the existing `.lookup-result` grid):

1. Gender / athlete search / button (unchanged).
2. **General athlete info**: name + country + discipline (unchanged header) plus a
   4-card stat row — Score, European #, World #, and a new **Road to #** card. This
   replaces the old standalone Road to Birmingham panel; the qualified/bubble/not-tracked
   states now live inside that 4th card instead of a separate block below.
3. A divider.
4. The ranking-type toggle (World / European / Road To), full width — always visible,
   not conditional.
5. Two columns: **left** — the 5 counting competitions for the *selected* ranking type
   (unchanged logic: `roadCalc.results` when `road`, else `calc.results`); **right** —
   the simulate tile.

### Road to # stat card

- Qualified (`entry.qualified`): value = `#{entry.qualificationPosition}` (the official
  position), badge "Qualified".
- Bubble (`!entry.qualified`, has a world-rankings pool entry): value =
  `#{entry.qualificationDetails.place}` (their pool rank), badge "Bubble", muted.
- Not tracked / fetch failed (`entry` undefined or `road` null): value "—", "Not tracked".

## Simulate tile: position per ranking type

- **European** (unchanged): `projectedPlace(peerScores, sim.newScore)` against the
  European ranking peer list.
- **World**: score + delta only, **no projected position**. The fetched ranking list is
  European-only (each row carries the athlete's `worldPlace` as a fixed fact, not the
  underlying global peer-score distribution), so a simulated World position can't be
  computed honestly. Render a short muted note explaining this instead of a stat card.
- **Road To**: existing `qualifyingPosition`/`withinWorldRankingQuota` math, now made
  **country-quota-aware** (see below).

## Country-quota-aware Road To position

The World Rankings qualifying pool caps each country at **3** counted athletes;
defending/previous champions qualify via a separate fixed route and were already
excluded from the pool peer list (`worldRankingPoolPeers` only includes
`qualificationTypeId` `q4`/`n4`), so they never occupy one of those 3 slots — a country
can field 4 total (3 via ranking + 1 titleholder) without any special-case code.

New pure engine algorithm (`engine/simulate.ts`):

```ts
export interface CountryScore { score: number; country: string }

export function qualifyingPoolRank(
  peers: CountryScore[],
  score: number,
  country: string,
  maxPerCountry = 3,
): number | null
```

Walks the full pool (peers + the simulated athlete) best-to-worst by score. Each
country's count is capped at `maxPerCountry`: once a country hits the cap, further
same-country athletes are skipped entirely — they consume no slot and don't push
anyone else down. Returns the athlete's 1-based rank in this quota-adjusted ordering,
or `null` if their own country already has `maxPerCountry` peers ranked strictly ahead
of them (blocked by the country quota, independent of how many pool slots remain).
Ties are resolved in the simulated athlete's favor (matches the existing
`projectedPlace` convention of only strictly-greater peer scores displacing them).

`qualifyingPosition` (adds the fixed non-ranking-slot offset) and
`withinWorldRankingQuota` (checks the pool rank against `worldRankingSlots`) are updated
to take `peers: CountryScore[]` + `country` and return `null`/`false` respectively when
`qualifyingPoolRank` returns `null`.

In the simulate tile, a `null` position renders as "—" with the note **"Blocked by
country quota"** instead of "Qualifying"/"Not qualifying".

### Data plumbing

- `birminghamApi.ts`: `worldRankingPoolPeerScores` → `worldRankingPoolPeers`, returning
  `CountryScore[]` (score + `competitor.country`) instead of bare `number[]`.
- `RoadSimData` (`SimulateResult.tsx`): `peerScores: number[]` → `peers: CountryScore[]`,
  plus a new `country: string` (the looked-up athlete's own `row.nationality`).
- `CountryScore` lives in `data/types.ts` (shared shape, not birmingham-specific).

## Cleanup bundled with this pass

- Revert `src/lib/supabase.ts`'s `isAuthEnabled = true` back to `supabase !== null` — the
  hardcoded value was a local-testing leftover, confirmed with the user.
- Remove the stray `console.log(found)` in `AthleteLookup.select()` and the now-dead
  `qualificationDetail()` helper (its only caller, the standalone Road to Birmingham
  block, is removed).
- Normalize indentation left inconsistent by the WIP commits in the touched files.

## Testing

- `simulate.test.ts`: update `qualifyingPosition`/`withinWorldRankingQuota` cases for the
  new signature; add cases for `qualifyingPoolRank` covering the country cap (a 4th
  same-country peer is skipped, doesn't displace others) and the "blocked" (`null`)
  case.
- `AthleteLookup.roadToBirmingham.test.tsx`: rewritten — it currently asserts the old
  `source`-switch UI (`'World ranking'`/`'Road to Birmingham'` tab labels, `'#2 of 30
  qualifying spots'` text) that no longer exists. Updated to assert the new Road-to #
  stat card states and the toggle-driven layout.
- `birminghamApi.test.ts`: update `worldRankingPoolPeerScores` → `worldRankingPoolPeers`
  fixture/assertions for the `{score, country}` shape.

## Out of scope

- A genuine simulated World position (would require sourcing an unfiltered global
  ranking list — unconfirmed such an API call exists; deferred).
- Changing the *displayed* (non-simulated) `entry.qualificationPosition` — that number
  already comes straight from EA's own system, which already applies the country quota
  correctly.

## Addendum (2026-07-11): two more bugs found via a live user report

A user (CZE, in the world-rankings pool but not yet qualified) reported the app showed
Road To **#50** in the header and **#39** in the simulate tile, while the live EA site
put them clearly 5th past the 30-spot cutoff (position 35). Both numbers were wrong, for
two different reasons:

1. **The country cap was seeded from the wrong population.** `qualifyingPoolRank` only
   ever looked at the `q4`/`n4` pool when counting a country's occupied slots — it had no
   idea that entry-standard qualifiers (`q1`) exist at all. But those *also* count against
   the 3-per-country cap (verified live: GBR's cap was reached by 2 entry-standard
   qualifiers + 1 pool qualifier, blocking a 4th GBR pool athlete who'd otherwise have
   ranked inside the top 17). Only the defending-champion route (`q7`) is exempt — this is
   the "previous winner doesn't count" case from the original ask. Added
   `birminghamApi.countryPreOccupancy`, seeded into every `qualifyingPoolRank` /
   `qualifyingPosition` / `withinWorldRankingQuota` call. Re-verified against the *entire*
   qualifying pool (76 men's + 68 women's entries): reproduces every one of the API's own
   `qualified`/`qualificationPosition` values exactly (0 mismatches), where the previous
   version would have mismatched on every country with a pre-existing entry-standard
   qualifier.

2. **The header stat used the wrong field, then the wrong tiebreak.** For a not-yet-qualified
   athlete, `qualificationDetails.place` is their raw World Ranking place (global, all
   continents) — unrelated to their standing in the Birmingham qualifying pool. Fixed to
   compute the pool position instead. But the pool-position calculator itself
   (`qualifyingPosition`, built for *simulating* a hypothetical new score) resolves ties in
   the simulated athlete's favor — a defensible convention for a result that hasn't
   happened yet, but wrong for an athlete's *actual recorded* score: two real athletes can
   share an identical score (verified live: two men's HJ candidates tied at 1078), and the
   real system's tiebreak isn't something we can guess. Re-sorting by score to compute a
   "current" position requires guessing that tiebreak; guessing wrong shifts a real
   athlete's position by one, which is exactly what caused the #35-vs-#39-ish discrepancy
   (the remaining #39-vs-#35 gap after the country-quota fix). Added
   `birminghamApi.qualifyingPoolPosition`, which instead walks the pool in the API's own
   returned order (already sorted best-to-worst with real ties pre-resolved) and just
   applies the country cap on top — no re-sorting, no tiebreak guess. Verified this
   reproduces the API's own qualified/position values exactly across both the full men's
   and women's pools, *and* gives the user's real athlete the exact position (#35) they
   see on the live site.

   `RoadSimData` now carries a precomputed `currentPosition` (the API's value when
   qualified, else `qualifyingPoolPosition`) instead of having `SimulateResult` re-derive
   "current position" from the athlete's score via the simulation-oriented function — the
   header stat and the simulate tile's delta baseline are now guaranteed to agree, since
   they're literally the same computation done once.
