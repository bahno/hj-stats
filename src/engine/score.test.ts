import { expect, test, describe } from 'vitest';
import { performanceScore, placingScore } from './score';
import type { ScoringTable, PlacingPoints } from '../data/types';

const table: ScoringTable = {
  event: 'high_jump',
  unit: 'm',
  source: 'fixture',
  points_by_mark: {
    men: { '2.30': 1244, '2.00': 859 },
    women: { '2.06': 1244 },
  },
};

const placing: PlacingPoints = {
  source: 'fixture',
  final: {
    OW: { '1': 375, '2': 330 },
    DF: { '1': 240 }, GW: { '1': 200 }, GL: { '1': 170 }, A: { '1': 140 },
    B: {}, C: {}, D: {}, E: {}, F: {},
  },
};

describe('performanceScore', () => {
  test('exact mark lookup by gender', () => {
    expect(performanceScore(table, 'men', 2.3)).toBe(1244);
    expect(performanceScore(table, 'women', 2.06)).toBe(1244);
  });
  test('throws on a mark not in the table', () => {
    expect(() => performanceScore(table, 'men', 2.31)).toThrow();
  });
});

describe('placingScore', () => {
  test('category + position lookup', () => {
    expect(placingScore(placing, 'OW', 1)).toBe(375);
    expect(placingScore(placing, 'OW', 2)).toBe(330);
  });
  test('absent position yields 0', () => {
    expect(placingScore(placing, 'OW', 16)).toBe(0);
    expect(placingScore(placing, 'F', 1)).toBe(0);
  });
});
