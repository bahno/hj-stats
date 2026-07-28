/**
 * The ranking window: which results are eligible to count on a given rank date.
 *
 * Two rules, both from the World Athletics Track & Field ranking rules:
 *
 *  - The ranking period is 12 months back from the rank date, except the 10,000m
 *    event group, which is 18. This is per event group, hence EventGroup.windowMonths.
 *
 *  - Area Senior Outdoor Championships (category GL) count regardless of the ranking
 *    period, provided they were held within three full calendar years. This is why a
 *    June 2024 result can still count in a July 2026 ranking, and it is the rule the
 *    original high-jump-only window logic was missing.
 */
import type { EventGroup } from '../data/events';
import { parseWaDate } from './dates';

/** Category code for Area Senior Outdoor Championships. */
const AREA_CHAMPIONSHIPS = 'GL';

/** How many full calendar years back the Area Championships allowance reaches. */
const AREA_CHAMPIONSHIPS_YEARS = 3;

export interface RankingWindow {
  startMs: number;
  endMs: number;
  /** Start of the wider allowance that only Area Championships results may use. */
  areaChampionshipsFromMs: number;
}

/**
 * Shift a UTC timestamp back by whole months, clamping to the last day of the target month.
 *
 * Keeping the day of month unconditionally lets JS normalise an impossible date forward: a
 * 31 AUG 2026 rank date minus the 10,000m group's 18 months asks for 31 FEB 2025 and gets
 * 03 MAR 2025, so the window opens three days late and silently drops eligible results.
 */
function monthsEarlier(ms: number, months: number): number {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() - months;
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay));
}

export function rankingWindow(group: EventGroup, rankDateMs: number): RankingWindow {
  const year = new Date(rankDateMs).getUTCFullYear();
  return {
    startMs: monthsEarlier(rankDateMs, group.windowMonths),
    endMs: rankDateMs,
    // "Three full calendar years" counts the rank date's own year as one of them,
    // so it opens on 1 January two years before.
    areaChampionshipsFromMs: Date.UTC(year - (AREA_CHAMPIONSHIPS_YEARS - 1), 0, 1),
  };
}

/**
 * A window with fixed, published bounds and no Area Championships allowance: a
 * competition's own qualification period rather than a rolling ranking period. Birmingham
 * 2026 publishes 27 JUL 2025 - 26 JUL 2026 and quotes it identically for the entry-standard
 * and the world-ranking route, so a 2024 Area Championships result the period excludes must
 * not be let back in. The allowance widens a ranking period, not a qualification period.
 */
export function fixedPeriodWindow(startMs: number, endMs: number): RankingWindow {
  return { startMs, endMs, areaChampionshipsFromMs: startMs };
}

/** Whether a result is eligible to count in this window. */
export function isInWindow(
  result: { date: string; category: string },
  window: RankingWindow,
): boolean {
  const t = parseWaDate(result.date);
  if (!Number.isFinite(t) || t > window.endMs) return false;
  if (t >= window.startMs) return true;
  return result.category === AREA_CHAMPIONSHIPS && t >= window.areaChampionshipsFromMs;
}
