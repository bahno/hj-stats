import type { EventGroup } from '../data/events';
import type { CategoryCode } from '../data/types';
import { placingPoints } from './data';
import { parseWaDate } from './dates';
import { placingPointsFor } from './placing';
import { advancedToFinal, classifyRounds } from './rounds';
import { placingScore } from './score';
import { isInWindow, type RankingWindow } from './window';

/**
 * Reconstructing the ranking's counting set from an athlete's *full* result list — used to
 * find the "next best" result that fills in when one of the counting competitions is
 * temporarily removed (e.g. it's about to age out of the window). WorldAthletics' own
 * calculation endpoint only returns the 5 that currently count, never the 6th, so we
 * re-derive the whole pool from the profile results (see data/athleteResultsApi.ts) and
 * pick up where the counting set leaves off.
 *
 * Two rules reproduce the official counting set (verified against live men's HJ data,
 * 2026-07): a result scores its mark points plus whatever the placing tables award for the
 * round it was (engine/placing.ts, engine/rounds.ts), and only results inside the ranking
 * window count (engine/window.ts).
 */

/** The minimum a result needs to be scored the same way the ranking does. */
export interface ScorableResult {
  category: string; // OW/DF/GW/GL/A-F — maps to the placing table
  place: string; // "1.", "4.", "=2." ...
  resultScore: number; // mark/performance-only points (WA's misleadingly-named `resultScore`)
}

/** A result that can be placed in (and filtered by) the ranking window. */
export interface RankableResult extends ScorableResult {
  date: string; // "16 SEP 2025"
  competition: string;
  race: string; // "F" for finals; "Q1"/"Q2" for qualification rounds
  discipline: string; // "High Jump" (indoor and outdoor both)
  notLegal?: boolean;
  competitionId?: string;
  mark?: string;
}

export interface ScoredResult extends RankableResult {
  /** Combined counting score: mark points + placing points. */
  score: number;
  /** Result date as epoch ms (UTC), for window filtering/sorting. */
  t: number;
}

export { parseWaDate, oneYearEarlier } from './dates';

/** First integer in a place string ("=2." -> 2, "4." -> 4). 0 when there's no finish position. */
export function parsePlace(place: string): number {
  const m = String(place).match(/\d+/);
  return m ? Number(m[0]) : 0;
}

/** Combined counting score of a result: mark points (given) + placing points (derived). */
export function combinedScore(r: ScorableResult): number {
  return r.resultScore + placingScore(placingPoints, r.category as CategoryCode, parsePlace(r.place));
}

/**
 * Stable identity for matching the same result across the two WorldAthletics endpoints.
 * The calculation endpoint has no competitionId, and its competition names can differ from
 * the profile's (e.g. a " - Diamond Discipline" suffix), so we key on the fields both carry
 * identically: date + mark-score + place + category.
 */
export function resultKey(r: ScorableResult & { date: string }): string {
  return `${r.date}|${r.resultScore}|${r.place}|${r.category}`;
}

/**
 * A place-independent identity for matching the same result across the calc and profile
 * endpoints when *excluding* counting results from the substitute pool. A qualification
 * round's `place` drifts between the two feeds (e.g. calc says 9th, profile says 7th), so it
 * can't be part of the match — but `date`, `resultScore`, and `category` agree exactly.
 */
export function countingKey(r: ScorableResult & { date: string }): string {
  return `${r.date}|${r.resultScore}|${r.category}`;
}

/**
 * Whether a result belongs to this event group at all. An athlete's profile carries
 * every discipline they have ever contested, and an event group spans several of them
 * (the 1500m ranking counts indoor 1500m results too), so membership is a set lookup
 * against the group's harvested discipline names — never a single string comparison.
 */
export function isCountableResult(r: RankableResult, group: EventGroup): boolean {
  return group.disciplines.includes(r.discipline) && !r.notLegal;
}

/**
 * Score every result that belongs to the group: mark points (given by World Athletics)
 * plus placing points (derived from the tables). Rounds are classified across the whole
 * set at once, because whether a round counts as "the round before the Final" depends on
 * what else the athlete contested at that competition — see engine/rounds.ts.
 */
export function scoreResults(results: RankableResult[], group: EventGroup): ScoredResult[] {
  const mine = results.filter((r) => isCountableResult(r, group));
  const rounds = classifyRounds(mine);
  return mine.map((r) => ({
    ...r,
    score: r.resultScore + placingPointsFor({
      group,
      discipline: r.discipline,
      category: r.category as CategoryCode,
      round: rounds.get(r) ?? 'other',
      place: parsePlace(r.place),
      advanced: advancedToFinal(r, mine),
    }),
    t: parseWaDate(r.date),
  }));
}

/** One of the official counting results: its identity and its exact (WA-given) score. */
export interface CountingEntry {
  key: string;
  score: number;
}

/**
 * Whether every official counting result falls inside the window — a sanity check on the
 * window bounds (i.e. that we're using the right rank date). If one doesn't, our window is
 * off and any derived 6th is untrustworthy, so the caller should not offer replacement.
 */
export function allCountingInWindow(
  counting: { date: string }[],
  startMs: number,
  endMs: number,
): boolean {
  if (counting.length === 0) return false;
  return counting.every((c) => {
    const t = parseWaDate(c.date);
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  });
}

/**
 * Candidate "next best" results, best-to-worst: scorable results inside the window that
 * aren't already counting and don't out-score the counting set. The `cap` (the lowest
 * counting score) keeps this safe without perfectly reproducing WA's window: a genuine
 * 6th is always ≤ the 5th, so anything above the cap is either already counting or a
 * boundary result WA hasn't counted yet.
 */
export function substitutePool(
  results: RankableResult[],
  group: EventGroup,
  window: RankingWindow,
  countingKeys: Set<string>,
  cap: number,
): ScoredResult[] {
  return scoreResults(results, group)
    .filter((r) => isInWindow(r, window))
    .filter((r) => !countingKeys.has(countingKey(r)) && r.score <= cap)
    .sort((a, b) => b.score - a.score || b.t - a.t);
}

export interface Recount {
  /** The substitutes pulled up into freed slots, best-to-worst. */
  substitutesUsed: ScoredResult[];
  /** Scores of the post-removal counting set (kept official + substitutes). */
  baseScores: number[];
  /** Floored average of the post-removal set — the recomputed ranking score. */
  average: number;
}

/**
 * Recompute the ranking with some counting competitions removed: keep the official scores of
 * the ones left, then fill each freed slot with the next-best substitute. Official scores are
 * used as-is (exact, from WA); only the substitutes are re-derived.
 */
export function recount(
  counting: CountingEntry[],
  removedKeys: Set<string>,
  subs: ScoredResult[],
): Recount {
  const keptScores = counting.filter((c) => !removedKeys.has(c.key)).map((c) => c.score);
  const need = counting.length - keptScores.length;
  const substitutesUsed = subs.slice(0, need);
  const baseScores = [...keptScores, ...substitutesUsed.map((s) => s.score)];
  const average = baseScores.length
    ? Math.floor(baseScores.reduce((sum, s) => sum + s, 0) / baseScores.length)
    : 0;
  return { substitutesUsed, baseScores, average };
}
