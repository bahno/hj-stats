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

/** Shift a UTC timestamp back by whole months, keeping the day of month. */
function monthsEarlier(ms: number, months: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate());
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
