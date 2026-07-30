import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { parseScoringTable, type ParsedTable } from './scoring';
import { compose, decompose, snapSelection, wheelsFor } from './markWheels';

const chunks = import.meta.glob('../data/scoring/*.json', { eager: true }) as Record<
  string,
  {
    default: {
      slug: string;
      gender: string;
      column: string;
      marks: Record<string, number>;
    };
  }
>;

function tableFor(slug: string, gender: 'men' | 'women'): ParsedTable {
  const group = findEventGroup(slug, gender)!;
  return parseScoringTable(group, chunks[`../data/scoring/${slug}-${gender}.json`].default);
}

const HEIGHT = findEventGroup('high-jump', 'men')!.mark;
const TIME = findEventGroup('400m', 'men')!.mark;

/** Every listed mark as hundredths, for asserting a composed value is really in the book. */
function listedHundredths(table: ParsedTable): Set<number> {
  return new Set(table.rows.map((r) => Math.round(r.value * 100)));
}

describe('decompose / compose', () => {
  it('splits a height into metres and centimetres without float drift', () => {
    expect(decompose(2.3, HEIGHT)).toEqual([2, 30]);
    expect(decompose(2.05, HEIGHT)).toEqual([2, 5]);
  });

  it('splits a time into minutes, seconds and hundredths', () => {
    // 26:45.49 is 1605.49 seconds.
    expect(decompose(1605.49, TIME)).toEqual([26, 45, 49]);
    expect(decompose(9.87, TIME)).toEqual([0, 9, 87]);
  });

  it('round-trips', () => {
    expect(compose(decompose(2.3, HEIGHT), HEIGHT)).toBeCloseTo(2.3, 5);
    expect(compose(decompose(1605.49, TIME), TIME)).toBeCloseTo(1605.49, 5);
    expect(compose(decompose(9.87, TIME), TIME)).toBeCloseTo(9.87, 5);
  });

  it('round-trips every listed mark of every table', () => {
    // The cascade is only safe if decompose/compose is lossless across the real data,
    // not just the handful of examples above.
    for (const key of Object.keys(chunks)) {
      const [, slug, gender] = key.match(/\/([a-z0-9-]+)-(men|women)\.json$/)!;
      const table = tableFor(slug, gender as 'men' | 'women');
      for (const row of table.rows) {
        const back = compose(decompose(row.value, table.spec), table.spec);
        expect(Math.round(back * 100)).toBe(Math.round(row.value * 100));
      }
    }
  });
});

describe('wheelsFor', () => {
  it('hides a wheel with only one possible value', () => {
    // The 100m men table runs 9.46 to 16.79 — never a whole minute.
    const wheels = wheelsFor(tableFor('100m', 'men'), [0, 10, 0]);
    expect(wheels.filter((w) => !w.hidden)).toHaveLength(2);
    expect(wheels[0].hidden).toBe(true);
  });

  it('keeps the minutes wheel where the table crosses a minute', () => {
    // The 400m men table runs 41.97 to 1:18.01.
    const wheels = wheelsFor(tableFor('400m', 'men'), [0, 45, 0]);
    expect(wheels.filter((w) => !w.hidden)).toHaveLength(3);
    expect(wheels[0].options).toEqual([0, 1]);
  });

  it('restricts a lower wheel to values that exist under the current selection', () => {
    // High jump men tops out at 2.54, so with metres = 2 no centimetre above 54 exists.
    const wheels = wheelsFor(tableFor('high-jump', 'men'), [2, 30]);
    const cm = wheels[1].options;
    expect(Math.max(...cm)).toBeLessThanOrEqual(54);
    expect(cm).toContain(30);
  });

  it('offers every combination as a real listed mark', () => {
    const table = tableFor('high-jump', 'men');
    const listed = listedHundredths(table);
    const wheels = wheelsFor(table, [2, 30]);
    for (const cm of wheels[1].options) {
      expect(listed.has(Math.round(compose([2, cm], table.spec) * 100))).toBe(true);
    }
  });

  it('offers every combination as a real listed mark for a timed event too', () => {
    const table = tableFor('400m', 'men');
    const listed = listedHundredths(table);
    const wheels = wheelsFor(table, [0, 45, 0]);
    for (const h of wheels[2].options) {
      expect(listed.has(Math.round(compose([0, 45, h], table.spec) * 100))).toBe(true);
    }
  });
});

describe('snapSelection', () => {
  it('snaps a now-invalid lower selection to the nearest valid value', () => {
    const table = tableFor('high-jump', 'men');
    // 2.99 does not exist; with metres = 2 the highest centimetre is 54.
    const snapped = snapSelection(table, [2, 99]);
    expect(snapped[0]).toBe(2);
    expect(snapped[1]).toBeLessThanOrEqual(54);
  });

  it('leaves a valid selection alone', () => {
    const table = tableFor('high-jump', 'men');
    expect(snapSelection(table, [2, 30])).toEqual([2, 30]);
  });

  it('always yields a listed mark', () => {
    const table = tableFor('400m', 'men');
    const listed = listedHundredths(table);
    for (const attempt of [
      [0, 0, 0],
      [1, 59, 99],
      [0, 41, 97],
      [1, 18, 1],
    ]) {
      const snapped = snapSelection(table, attempt);
      expect(listed.has(Math.round(compose(snapped, table.spec) * 100))).toBe(true);
    }
  });

  it('yields a listed mark for every table, from both extremes', () => {
    // The cascade must not be able to strand the user anywhere off the book.
    for (const key of Object.keys(chunks)) {
      const [, slug, gender] = key.match(/\/([a-z0-9-]+)-(men|women)\.json$/)!;
      const table = tableFor(slug, gender as 'men' | 'women');
      const listed = listedHundredths(table);
      for (const attempt of [
        [0, 0, 0],
        [99, 99, 99],
      ]) {
        const snapped = snapSelection(table, attempt);
        expect(listed.has(Math.round(compose(snapped, table.spec) * 100))).toBe(true);
      }
    }
  });
});
