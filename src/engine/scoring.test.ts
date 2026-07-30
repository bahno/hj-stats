/**
 * The oracle here is the same one pipeline/verify.py runs: every counting result World
 * Athletics itself published in the captured fixtures, scored against these tables. That
 * covers all 36 groups with real data, which no hand-written expectation would.
 */
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { parseMark } from './mark';
import { markNearestScore, markPoints, parseScoringTable } from './scoring';
import type { ParsedTable } from './scoring';

const chunks = import.meta.glob('../data/scoring/*.json', { eager: true }) as Record<
  string,
  {
    default: {
      slug: string;
      gender: 'men' | 'women';
      column: string;
      marks: Record<string, number>;
    };
  }
>;

function tableFor(slug: string, gender: 'men' | 'women'): ParsedTable {
  const group = findEventGroup(slug, gender);
  if (!group) throw new Error(`no event group ${slug} ${gender}`);
  const chunk = chunks[`../data/scoring/${slug}-${gender}.json`];
  if (!chunk) throw new Error(`no scoring chunk ${slug}-${gender}`);
  return parseScoringTable(group, chunk.default);
}

describe('markPoints', () => {
  it('scores an exactly listed mark', () => {
    const table = tableFor('high-jump', 'men');
    expect(markPoints(table, 2.3)).toBeGreaterThan(0);
  });

  it('takes the lower score when a mark falls between two rows', () => {
    const table = tableFor('high-jump', 'men');
    // A jump of 2.305 clears 2.30 but not 2.31, so it scores exactly what 2.30 scores.
    expect(markPoints(table, 2.305)).toBe(markPoints(table, 2.3));
    expect(markPoints(table, 2.305)).toBeLessThan(markPoints(table, 2.31));
  });

  it('takes the lower score for a timed event, where faster is better', () => {
    const table = tableFor('100m', 'men');
    // 9.865 is slower than 9.86, so it can only earn what 9.87 earns.
    expect(markPoints(table, 9.865)).toBe(markPoints(table, 9.87));
    expect(markPoints(table, 9.865)).toBeLessThan(markPoints(table, 9.86));
  });

  it('saturates above the table and floors below it', () => {
    const table = tableFor('high-jump', 'men');
    // Not every event reaches 1400: the men's high jump column tops out at 1395, because
    // the book stops listing heights at 2.54. Assert the table's own maximum rather than
    // a number assumed to be shared across events.
    const top = Math.max(...table.rows.map((r) => r.points));
    expect(top).toBe(1395);
    expect(markPoints(table, 9)).toBe(top);
    // The lowest listed height is 0.92, scoring 8. Below that nothing is reached at all,
    // which is 0 rather than the table's minimum.
    expect(markPoints(table, 0.1)).toBe(0);
  });

  it('saturates and floors the right way round for a timed event', () => {
    const table = tableFor('10000m', 'men');
    const top = Math.max(...table.rows.map((r) => r.points));
    expect(markPoints(table, 60)).toBe(top); // a one-minute 10,000m is off the top
    expect(markPoints(table, 60 * 60 * 3)).toBe(0); // three hours is off the bottom
  });
});

describe('markNearestScore', () => {
  it('returns the mark whose points sit closest to a score', () => {
    const table = tableFor('high-jump', 'men');
    const mark = markNearestScore(table, 1149);
    expect(Math.abs(markPoints(table, mark) - 1149)).toBeLessThanOrEqual(4);
  });

  it('works for a timed event too', () => {
    const table = tableFor('1500m', 'men');
    const mark = markNearestScore(table, 1200);
    expect(Math.abs(markPoints(table, mark) - 1200)).toBeLessThanOrEqual(4);
  });
});

/**
 * Mirrors verify_oracle() in pipeline/verify.py, which reports:
 *   "152 captured World Athletics results reproduced exactly,
 *    20 wind-affected results differ by the wind adjustment."
 *
 * Only rows for the group's MAIN discipline are checked. A group covers similar events
 * too — the 100m group counts a 60m result — but those score off their own column in the
 * book, which is not in these tables.
 */
const MAIN_DISCIPLINE: Record<string, string> = {
  '100m': '100 Metres',
  '200m': '200 Metres',
  '400m': '400 Metres',
  '800m': '800 Metres',
  '1500m': '1500 Metres',
  '5000m': '5000 Metres',
  '10000m': '10,000 Metres',
  '110mh': '110 Metres Hurdles',
  '100mh': '100 Metres Hurdles',
  '400mh': '400 Metres Hurdles',
  '3000msc': '3000 Metres Steeplechase',
  'high-jump': 'High Jump',
  'pole-vault': 'Pole Vault',
  'long-jump': 'Long Jump',
  'triple-jump': 'Triple Jump',
  'shot-put': 'Shot Put',
  'discus-throw': 'Discus Throw',
  'hammer-throw': 'Hammer Throw',
  'javelin-throw': 'Javelin Throw',
};

/** World Athletics adjusts these events' scores for wind; the tables carry no wind. */
const WIND_AFFECTED = new Set([
  '100m',
  '200m',
  '110mh',
  '100mh',
  'long-jump',
  'triple-jump',
]);

interface OracleFixture {
  group?: { slug: string; gender: 'men' | 'women' };
  calculation?: {
    results: Array<{ discipline: string; mark: string; resultScore: number }>;
  };
  results?: Array<{
    date: string;
    discipline: string;
    mark: string;
    notLegal: boolean;
  }>;
}

const oracle = import.meta.glob('./__fixtures__/oracle/*.json', { eager: true }) as Record<
  string,
  { default: OracleFixture }
>;

describe('markPoints against World Athletics fixtures', () => {
  const fixtures = Object.values(oracle).map((m) => m.default);

  // A wind-aided mark carries a wind adjustment, so it is allowed to differ wherever it
  // appears. Keyed the way verify.py keys it.
  const windAided = new Set<string>();
  for (const f of fixtures) {
    for (const row of f.results ?? []) {
      if (row.notLegal) {
        windAided.add(`${row.date}|${String(row.mark).trim()}|${row.discipline}`);
      }
    }
  }

  let exact = 0;
  let windDiffs = 0;
  const mismatches: string[] = [];

  for (const f of fixtures) {
    if (!f.group) continue;
    const { slug, gender } = f.group;
    const group = findEventGroup(slug, gender);
    if (!group || !chunks[`../data/scoring/${slug}-${gender}.json`]) continue;
    const table = tableFor(slug, gender);

    for (const row of f.calculation?.results ?? []) {
      if (row.discipline !== MAIN_DISCIPLINE[slug]) continue;
      if (row.resultScore == null) continue;
      const mark = String(row.mark).trim();
      const value = parseMark(mark, group.mark);
      if (value === null) continue;
      const got = markPoints(table, value);
      if (got === row.resultScore) exact++;
      else if (
        WIND_AFFECTED.has(slug) ||
        windAided.has(`${(row as { date?: string }).date}|${mark}|${row.discipline}`)
      ) {
        windDiffs++;
      } else {
        mismatches.push(
          `${gender} ${slug} ${mark}: WA scored ${row.resultScore}, tables give ${got}`,
        );
      }
    }
  }

  it('reproduces every non-wind-affected result exactly', () => {
    expect(mismatches).toEqual([]);
  });

  it('checks a meaningful number of results, so the tolerance cannot widen unnoticed', () => {
    // verify.py reports 152 exact / 20 wind-affected. Refreshing fixtures moves these,
    // but a collapse toward zero means the filter above stopped matching anything.
    expect(exact).toBeGreaterThanOrEqual(140);
    expect(windDiffs).toBeLessThanOrEqual(40);
    expect(windAided.size).toBeGreaterThan(0);
  });
});
