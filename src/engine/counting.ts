import type { CategoryCode } from '../data/types';
import { placingPoints } from './data';
import { placingScore } from './score';

/**
 * Reconstructing the ranking's counting set from an athlete's *full* result list — used to
 * find the "next best" result that fills in when one of the counting competitions is
 * temporarily removed (e.g. it's about to age out of the window). WorldAthletics' own
 * calculation endpoint only returns the 5 that currently count, never the 6th, so we
 * re-derive the whole pool from the profile results (see data/athleteResultsApi.ts) and
 * pick up where the counting set leaves off.
 *
 * Two rules reproduce the official counting set exactly (verified against live men's HJ
 * data, 2026-07): only final rounds count (qualification rounds carry a heat placing that
 * would otherwise inflate their score), and only results inside the ranking window count.
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

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Parse a WorldAthletics/EA date to epoch ms (UTC). Handles the results feed's
 * "16 SEP 2025" format and, defensively, an ISO "2025-09-16" (the ranking endpoints'
 * rankDate format isn't guaranteed to match). NaN if unparseable.
 */
export function parseWaDate(s: string): number {
  const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 3) return NaN;
  const [d, mon, y] = parts;
  const month = MONTHS[mon.toUpperCase()];
  if (month === undefined) return NaN;
  const day = Number(d);
  const year = Number(y);
  if (!Number.isFinite(day) || !Number.isFinite(year)) return NaN;
  return Date.UTC(year, month, day);
}

/** The same instant one calendar year earlier — the start of a rolling 12-month window. */
export function oneYearEarlier(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate());
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
 * Whether a result is a legal High Jump final. The `race` code is `F` for a single final,
 * but meets split into flights/sections label them `F1`, `F2`, … (common at NCAA/collegiate
 * meets) — all are finals. Qualification rounds are `Q`/`Q1`/`Q2` (see `candidateScore`).
 */
export function isFinalResult(r: RankableResult): boolean {
  return r.discipline === 'High Jump' && r.race.startsWith('F') && !r.notLegal;
}

/**
 * WorldAthletics placing points for a qualification round when the athlete *advanced* to the
 * final ("Q or q to Final"), by competition category — the ≥10-finalist column of WA's
 * qualification placing table. Championship High Jump finals (OW, and the indoor GW tier) run
 * ≥10 competitors, so this column is the right one; a non-advancing round (placed by its own
 * qualification position) or a category not listed here isn't scored (see `candidateScore`).
 * Verified against live counting sets: Hrubá's Tokyo Q2 (1140+70=1210) and Doroshchuk's Tokyo
 * Q1 (1135+70=1205) both reproduce WA exactly.
 */
const QUAL_TO_FINAL_PLACING: Record<string, number> = { OW: 70, DF: 46, GW: 35, GL: 28 };

/**
 * A result's counting score as a substitute candidate, or `null` if it isn't one:
 *  - a legal High Jump final scores `resultScore + placingScore(category, place)`;
 *  - a qualification round scores `resultScore + qualToFinal[category]`, but only when it's a
 *    championship-tier round the athlete advanced from (a final at the same competition is in
 *    `finalCompIds`) — otherwise its placing isn't reliably derivable and it's skipped.
 */
export function candidateScore(r: RankableResult, finalCompIds: Set<string>): number | null {
  if (r.discipline !== 'High Jump' || r.notLegal) return null;
  if (r.race.startsWith('F')) return combinedScore(r); // final (F, or a flight F1/F2/…)
  if (!r.race.startsWith('Q')) return null; // not a final or qualification round
  const qualPlacing = QUAL_TO_FINAL_PLACING[r.category];
  if (qualPlacing === undefined || r.competitionId === undefined || !finalCompIds.has(r.competitionId)) {
    return null;
  }
  return r.resultScore + qualPlacing;
}

/** The number of results the High Jump ranking averages. */
export const COUNTING_RESULTS = 5;

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
 * Candidate "next best" results, best-to-worst: scorable results inside the window (finals,
 * plus advancing championship qualification rounds — see `candidateScore`) that aren't already
 * counting and don't out-score the counting set. The `cap` (the lowest counting score) keeps
 * this safe without perfectly reproducing WA's window: a genuine 6th is always ≤ the 5th, so
 * anything above the cap is either already counting or a boundary result WA hasn't counted yet.
 */
export function substitutePool(
  results: RankableResult[],
  startMs: number,
  endMs: number,
  countingKeys: Set<string>,
  cap: number,
): ScoredResult[] {
  const finalCompIds = new Set(
    results.filter(isFinalResult).map((r) => r.competitionId).filter((id): id is string => id !== undefined),
  );
  return results
    .map((r) => {
      const score = candidateScore(r, finalCompIds);
      return score === null ? null : { ...r, score, t: parseWaDate(r.date) };
    })
    .filter((r): r is ScoredResult => r !== null)
    .filter((r) => Number.isFinite(r.t) && r.t >= startMs && r.t <= endMs)
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
