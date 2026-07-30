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

/**
 * Counting-set order: best combined score first.
 *
 * On a tied score the higher mark score wins. Measured across 330 captured ranking
 * calculations sampled down to ranking place 1101: of the 15 ties at a counting-set
 * boundary, the 7 whose mark scores differ went to the higher mark score every time, with
 * no counterexample. Pichardo's Rome 2024 qualification (mark 1216) over his Tokyo 2025
 * one (mark 1174) is one of them, and it is why date alone was never the rule.
 *
 * When the mark scores tie as well, World Athletics' own choice is not consistent (5 of
 * those 8 took the newer result, 2 the older, 1 counted both), so newest-first stays as a
 * stable last resort rather than a rule anyone should trust.
 */
export function byCountingOrder(a: ScoredResult, b: ScoredResult): number {
  return b.score - a.score || b.resultScore - a.resultScore || b.t - a.t;
}

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
 *
 * `notLegal` is deliberately NOT a filter. It flags a mark as ineligible for records and
 * lists (wind-aided, almost always), not ineligible for the ranking: the oracle fixtures
 * show World Athletics counting three such results outright — Jacobs' wind-aided 9.67 and
 * 9.84 at Eisenstadt (01 JUL 2026) and Španović's 14.43 at the Serbian Championships
 * (02 AUG 2025) — and not one of the other 22 notLegal rows across the 36 fixtures even
 * reaches its athlete's worst counting score, so there is no case pointing the other way.
 */
export function isCountableResult(r: RankableResult, group: EventGroup): boolean {
  return group.disciplines.includes(r.discipline);
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
 * Collapse rows that describe the same round of the same competition, keeping the best.
 *
 * Since wind-aided marks stopped being filtered out (see isCountableResult), some feeds are
 * seen listing one round twice: its legal best and its wind-aided best as separate rows.
 * Ivana ŠPANOVIĆ's fixture has three such pairs, and the shadow row is dangerous because
 * `countingKey` includes `resultScore` — the shadow scores differently from the row World
 * Athletics counted, so it is not recognised as already counting and offers itself as a
 * substitute from a competition that is already in the counting set.
 *
 * The discriminator is the round itself: competition + discipline + date + race code. Across
 * the 36 oracle fixtures (1716 rows) that key collides exactly three times, and all three are
 * the known duplicate pairs — while 109 same-competition, same-discipline, same-day pairs of
 * genuinely different rounds (a heat and its final, a qualification and its final) keep
 * distinct keys and survive. Keeping the highest-scoring row of a pair keeps the one World
 * Athletics counts (ŠPANOVIĆ's wind-aided 1146 over the shadow's 1131), which is also what
 * lets `countingKey` recognise and exclude it.
 */
function bestPerRound(results: ScoredResult[]): ScoredResult[] {
  const best = new Map<string, ScoredResult>();
  for (const r of results) {
    const key = `${r.competitionId}|${r.discipline}|${r.date}|${r.race}`;
    const seen = best.get(key);
    if (!seen || r.score > seen.score) best.set(key, r);
  }
  return [...best.values()];
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
  // Duplicated rounds must collapse *before* the counting exclusion: drop the counted row
  // first and a shadow row would be left behind as the round's only survivor.
  return bestPerRound(scoreResults(results, group))
    .filter((r) => isInWindow(r, window))
    .filter((r) => !countingKeys.has(countingKey(r)) && r.score <= cap)
    .sort(byCountingOrder);
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
