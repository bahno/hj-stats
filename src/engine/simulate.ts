import type { CategoryCode, Gender } from '../data/types';
import { placingPoints, scoringTable } from './data';
import { performanceScore, placingScore } from './score';

/** High Jump world/European ranking = average of the best 5 result scores. */
export const COUNTING_RESULTS = 5;

/** Combined counting score of one result: mark points + placing points. */
export function resultScoreFor(
  gender: Gender,
  mark: number,
  category: CategoryCode,
  place: number,
): number {
  return (
    performanceScore(scoringTable, gender, mark) +
    placingScore(placingPoints, category, place)
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
 */
export function recomputeRanking(base: number[], simScore: number): Recompute {
  const keepCount = Math.min(COUNTING_RESULTS, base.length + 1);
  const kept = [...base, simScore].sort((a, b) => b - a).slice(0, keepCount);
  const newScore = Math.floor(kept.reduce((sum, s) => sum + s, 0) / kept.length);
  const atCapacity = base.length >= COUNTING_RESULTS;
  const min = base.length ? Math.min(...base) : -Infinity;
  const counts = !atCapacity || simScore > min;
  return { newScore, counts, dropped: counts && atCapacity ? min : null };
}

/** 1-based placement of `score` among peers (higher score = better place). */
export function projectedPlace(peerScores: number[], score: number): number {
  return 1 + peerScores.filter((s) => s > score).length;
}
