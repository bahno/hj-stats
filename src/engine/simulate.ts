import type { CategoryCode, CountryScore } from '../data/types';
import type { EventGroup } from '../data/events';
import { markPoints, type ParsedTable } from './scoring';
import { placingPointsFor } from './placing';

/**
 * Combined counting score of one simulated result: mark points + placing points.
 *
 * Placing comes from placingPointsFor rather than the Table-2.2-only placing_points.json,
 * because Track & Field is not one placing table: the 5000m and 3000mSC groups score
 * finals off Table 2.5 and the 10,000m group off Table 2.9. Winning a category A final is
 * 100 under 2.2 but 56 under 2.9, so simulating those against 2.2 would be silently wrong.
 *
 * The simulator always asks "what if I place Nth in this competition", which is a final,
 * so `round` is fixed and `advanced` is irrelevant. `discipline` is the group's main event
 * - a Table 2.12 short label, deliberately not a feed long-name, so it never matches a
 * byDiscipline override and the group's own final table applies.
 */
export function resultScoreFor(
  group: EventGroup,
  table: ParsedTable,
  mark: number,
  category: CategoryCode,
  place: number,
): number {
  return (
    markPoints(table, mark) +
    placingPointsFor({
      group,
      discipline: group.mainEvent,
      category,
      round: 'final',
      place,
      advanced: false,
    })
  );
}

export interface Recompute {
  newScore: number;
  /** Whether the simulated result enters the counting set. */
  counts: boolean;
  /** The counting score it pushed out, if the set was already full. */
  dropped: number | null;
}

/**
 * Recompute the ranking score after adding one result. `base` is the current
 * counting scores (already the athlete's best). Adding a result and keeping the
 * top N is the correct new best-N average, as long as the new result is within
 * the scoring window and none of the base results have aged out.
 *
 * `countingResults` comes from the event group. Every Track & Field group averages 5, but
 * this used to be a module constant back when the simulator was gated to the high jump;
 * now that 35 other groups can reach it, reading the group's own value is the difference
 * between a fact and a trap.
 */
export function recomputeRanking(
  base: number[],
  simScore: number,
  countingResults: number,
): Recompute {
  const keepCount = Math.min(countingResults, base.length + 1);
  const kept = [...base, simScore].sort((a, b) => b - a).slice(0, keepCount);
  const newScore = Math.floor(kept.reduce((sum, s) => sum + s, 0) / kept.length);
  const atCapacity = base.length >= countingResults;
  const min = base.length ? Math.min(...base) : -Infinity;
  const counts = !atCapacity || simScore > min;
  return { newScore, counts, dropped: counts && atCapacity ? min : null };
}

/** 1-based placement of `score` among peers (higher score = better place). */
export function projectedPlace(peerScores: number[], score: number): number {
  return 1 + peerScores.filter((s) => s > score).length;
}

/** The World Rankings qualifying pool caps counted athletes per country at this many. */
export const MAX_PER_COUNTRY = 3;

/**
 * 1-based rank of `score` within the ranking pool once each country is capped at
 * `maxPerCountry` counted athletes total: walking the pool best-to-worst, any athlete
 * beyond their country's cap is skipped entirely — they consume no slot and don't push
 * anyone else down. `countryPreOccupancy` seeds each country's count with qualifiers
 * already locked in through a fixed, non-pool route (e.g. entry standard) — those count
 * against the cap too, they just aren't part of `peers` (see
 * `birminghamApi.countryPreOccupancy`). Returns `null` if `country` is already at (or
 * over) the cap once its pre-occupancy is included (blocked by the quota, regardless of
 * how many pool slots remain).
 *
 * The defending-champion route is the one exemption — it doesn't consume a cap slot,
 * which is why a country can field more than `maxPerCountry` athletes overall. Champions
 * are expected to already be excluded from both `peers` and `countryPreOccupancy`.
 *
 * Ties are resolved in the simulated athlete's favor, matching `projectedPlace`'s
 * convention that only strictly-greater peer scores displace them.
 */
export function qualifyingPoolRank(
  peers: CountryScore[],
  score: number,
  country: string,
  countryPreOccupancy: Record<string, number> = {},
  maxPerCountry: number = MAX_PER_COUNTRY,
): number | null {
  const self: CountryScore = { score, country };
  const pool = [self, ...peers].sort((a, b) => b.score - a.score);
  const counts = new Map<string, number>(Object.entries(countryPreOccupancy));
  let rank = 0;
  for (const entry of pool) {
    const used = counts.get(entry.country) ?? 0;
    if (used >= maxPerCountry) continue;
    counts.set(entry.country, used + 1);
    rank++;
    if (entry === self) return rank;
  }
  return null;
}

/**
 * Overall qualifying position when a fixed number of slots (`nonRankingSlots`, e.g.
 * entry-standard qualifiers) sit ahead of a country-quota-capped ranking pool: the pool
 * rank plus that offset, or `null` if blocked by the country quota.
 */
export function qualifyingPosition(
  peers: CountryScore[],
  score: number,
  country: string,
  nonRankingSlots: number,
  countryPreOccupancy: Record<string, number> = {},
  maxPerCountry: number = MAX_PER_COUNTRY,
): number | null {
  const rank = qualifyingPoolRank(peers, score, country, countryPreOccupancy, maxPerCountry);
  return rank == null ? null : nonRankingSlots + rank;
}

/** Whether `score`'s country-quota-capped pool rank falls within the available slots. */
export function withinWorldRankingQuota(
  peers: CountryScore[],
  score: number,
  country: string,
  worldRankingSlots: number,
  countryPreOccupancy: Record<string, number> = {},
  maxPerCountry: number = MAX_PER_COUNTRY,
): boolean {
  const rank = qualifyingPoolRank(peers, score, country, countryPreOccupancy, maxPerCountry);
  return rank != null && rank <= worldRankingSlots;
}

/**
 * 1-based rank of `score` among same-country peers only, offset by any qualifiers already
 * locked in outside the pool for that country — mirrors what the API's own
 * `countryPosition` field means for a real recorded score, so it can be shown alongside a
 * simulated result the same way. Ties are resolved in the simulated athlete's favor,
 * matching `projectedPlace`.
 */
export function countryRank(
  peers: CountryScore[],
  score: number,
  country: string,
  countryPreOccupancy: Record<string, number> = {},
): number {
  const preOccupied = countryPreOccupancy[country] ?? 0;
  const higherCountryPeers = peers.filter((p) => p.country === country && p.score > score).length;
  return preOccupied + higherCountryPeers + 1;
}
