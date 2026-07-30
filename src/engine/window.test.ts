import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { parseWaDate } from './dates';
import { fixedPeriodWindow, isInWindow, rankingWindow } from './window';

const hj = findEventGroup('high-jump', 'men')!;
const tenK = findEventGroup('10000m', 'men')!;
const rankDate = parseWaDate('21 JUL 2026');

describe('rankingWindow', () => {
  it('spans 12 months for a general track and field group', () => {
    const w = rankingWindow(hj, rankDate);
    expect(w.endMs).toBe(rankDate);
    expect(w.startMs).toBe(parseWaDate('21 JUL 2025'));
  });

  it('spans 18 months for the 10,000m group', () => {
    expect(rankingWindow(tenK, rankDate).startMs).toBe(parseWaDate('21 JAN 2025'));
  });

  it('opens the Area Championships allowance three calendar years back', () => {
    // Three full calendar years: 2024, 2025, 2026 — so from 01 JAN 2024.
    expect(rankingWindow(hj, rankDate).areaChampionshipsFromMs).toBe(parseWaDate('2024-01-01'));
  });
});

/**
 * Stepping back whole months must never roll into the following month. Keeping the day of
 * month lets JS normalise an impossible date forward (31 FEB 2025 -> 03 MAR 2025), which
 * opens the window days late and silently drops eligible results.
 */
describe('rankingWindow month-end clamping', () => {
  it('clamps 18 months back from 31 AUG to the last day of February', () => {
    const w = rankingWindow(tenK, parseWaDate('31 AUG 2026'));
    expect(w.startMs).toBe(parseWaDate('28 FEB 2025'));
  });

  it('clamps to 29 February when the target month is in a leap year', () => {
    const w = rankingWindow(tenK, parseWaDate('31 AUG 2025'));
    expect(w.startMs).toBe(parseWaDate('29 FEB 2024'));
  });

  it('clamps a 31-day date landing in a 30-day month', () => {
    // 31 MAR 2026 minus 18 months is September, which has 30 days.
    expect(rankingWindow(tenK, parseWaDate('31 MAR 2026')).startMs).toBe(parseWaDate('30 SEP 2024'));
    // And the 12-month group: 31 MAY 2026 minus 12 lands on 31 MAY 2025, no clamp needed.
    expect(rankingWindow(hj, parseWaDate('31 MAY 2026')).startMs).toBe(parseWaDate('31 MAY 2025'));
  });

  it('clamps a 29 February rank date stepping back into a non-leap year', () => {
    expect(rankingWindow(hj, parseWaDate('29 FEB 2028')).startMs).toBe(parseWaDate('28 FEB 2027'));
  });

  it('leaves a day of month that exists in the target month alone', () => {
    // The ordinary case every fixture uses — unchanged.
    expect(rankingWindow(hj, rankDate).startMs).toBe(parseWaDate('21 JUL 2025'));
    expect(rankingWindow(tenK, rankDate).startMs).toBe(parseWaDate('21 JAN 2025'));
    // 31 JUL minus 18 lands in January, which has 31 days.
    expect(rankingWindow(tenK, parseWaDate('31 JUL 2026')).startMs).toBe(parseWaDate('31 JAN 2025'));
  });

  it('admits a result the un-clamped window would have dropped', () => {
    const w = rankingWindow(tenK, parseWaDate('31 AUG 2026'));
    // 01 MAR 2025 is inside either way; 28 FEB 2025 only survives the clamp.
    expect(isInWindow({ date: '28 FEB 2025', category: 'A' }, w)).toBe(true);
    expect(isInWindow({ date: '27 FEB 2025', category: 'A' }, w)).toBe(false);
  });
});

describe('isInWindow', () => {
  const w = rankingWindow(hj, rankDate);

  it('accepts a result inside the rolling window', () => {
    expect(isInWindow({ date: '01 JUN 2026', category: 'A' }, w)).toBe(true);
  });

  it('rejects an ordinary result older than the window', () => {
    expect(isInWindow({ date: '08 JUN 2024', category: 'A' }, w)).toBe(false);
  });

  it('accepts an Area Championships result older than the window', () => {
    // Jacobs' 08 JUN 2024 European Championships result counts in a July 2026
    // ranking: Area Senior Outdoor Championships are included regardless of the
    // ranking period, within three full calendar years.
    expect(isInWindow({ date: '08 JUN 2024', category: 'GL' }, w)).toBe(true);
  });

  it('rejects an Area Championships result beyond three calendar years', () => {
    expect(isInWindow({ date: '20 AUG 2023', category: 'GL' }, w)).toBe(false);
  });

  it('rejects a result in the future of the rank date', () => {
    expect(isInWindow({ date: '01 SEP 2026', category: 'A' }, w)).toBe(false);
  });

  it('rejects an unparseable date rather than silently including it', () => {
    expect(isInWindow({ date: 'nonsense', category: 'A' }, w)).toBe(false);
  });
});

describe('fixedPeriodWindow', () => {
  // Birmingham 2026's published qualification period, quoted identically for the
  // entry-standard and the world-ranking route.
  const w = fixedPeriodWindow(parseWaDate('27 JUL 2025'), parseWaDate('26 JUL 2026'));

  it('keeps the published bounds', () => {
    expect(w.startMs).toBe(parseWaDate('27 JUL 2025'));
    expect(w.endMs).toBe(parseWaDate('26 JUL 2026'));
  });

  it('excludes an Area Championships result the published period predates', () => {
    // The same 08 JUN 2024 result that the rolling ranking window admits. A fixed
    // qualification period is absolute, so it must not come back in here.
    const result = { date: '08 JUN 2024', category: 'GL' };
    expect(isInWindow(result, rankingWindow(hj, rankDate))).toBe(true);
    expect(isInWindow(result, w)).toBe(false);
  });

  it('still admits a result inside the period', () => {
    expect(isInWindow({ date: '08 JUN 2026', category: 'GL' }, w)).toBe(true);
  });
});
