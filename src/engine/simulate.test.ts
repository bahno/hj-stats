import { describe, expect, it } from 'vitest';
import { projectedPlace, qualifyingPosition, recomputeRanking, withinWorldRankingQuota } from './simulate';

// Mahuchikh's five counting scores (avg 1367).
const BASE = [1400, 1389, 1369, 1349, 1330];

describe('recomputeRanking', () => {
  it('replaces the weakest counting result when the new result is better', () => {
    const { newScore, counts, dropped } = recomputeRanking(BASE, 1450);
    // top 5 of [1450,1400,1389,1369,1349] = 6957 / 5 = 1391.4
    expect(newScore).toBe(1391);
    expect(counts).toBe(true);
    expect(dropped).toBe(1330);
  });

  it('leaves the ranking unchanged when the new result is too weak to count', () => {
    const { newScore, counts, dropped } = recomputeRanking(BASE, 1000);
    expect(newScore).toBe(1367);
    expect(counts).toBe(false);
    expect(dropped).toBeNull();
  });

  it('adds the result (no drop) when the athlete has fewer than five', () => {
    const { newScore, counts, dropped } = recomputeRanking([1200, 1100, 1000], 1300);
    // averages all four: 4600 / 4 = 1150
    expect(newScore).toBe(1150);
    expect(counts).toBe(true);
    expect(dropped).toBeNull();
  });
});

describe('projectedPlace', () => {
  it('ranks by higher score', () => {
    expect(projectedPlace([1400, 1300, 1200], 1350)).toBe(2);
    expect(projectedPlace([1400, 1300, 1200], 1500)).toBe(1);
  });
});

describe('qualifyingPosition', () => {
  it('offsets the pool rank by the fixed non-ranking slots', () => {
    // 13 entry-standard spots ahead of the pool; 1st in the pool -> position 14.
    expect(qualifyingPosition([1150, 1100, 1050], 1196, 13)).toBe(14);
  });
});

describe('withinWorldRankingQuota', () => {
  it('is true when the pool rank is within the available slots', () => {
    expect(withinWorldRankingQuota([1150, 1100, 1050], 1120, 2)).toBe(true); // pool rank 2
    expect(withinWorldRankingQuota([1150, 1100, 1050], 1000, 2)).toBe(false); // pool rank 4
  });
});
