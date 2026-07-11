import { describe, expect, it } from 'vitest';
import type { CountryScore } from '../data/types';
import {
  countryRank,
  projectedPlace,
  qualifyingPoolRank,
  qualifyingPosition,
  recomputeRanking,
  withinWorldRankingQuota,
} from './simulate';

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

const peers = (scores: [number, string][]): CountryScore[] =>
  scores.map(([score, country]) => ({ score, country }));

describe('qualifyingPoolRank', () => {
  it('ranks by score when no country hits the cap', () => {
    const pool = peers([
      [1150, 'FRA'],
      [1100, 'GER'],
      [1050, 'ESP'],
    ]);
    expect(qualifyingPoolRank(pool, 1120, 'ITA')).toBe(2);
  });

  it('skips a 4th same-country peer without displacing others', () => {
    // Three Italians already rank above a Spaniard; a simulated 4th-best Italian score
    // is skipped by the quota and doesn't push the Spaniard down.
    const pool = peers([
      [1300, 'ITA'],
      [1250, 'ITA'],
      [1200, 'ITA'],
      [1100, 'ESP'],
    ]);
    expect(qualifyingPoolRank(pool, 1150, 'ITA')).toBeNull();
    expect(qualifyingPoolRank(pool, 1050, 'ESP')).toBe(5);
  });

  it('resolves ties in the simulated athlete\'s favor', () => {
    const pool = peers([[1150, 'FRA']]);
    expect(qualifyingPoolRank(pool, 1150, 'GER')).toBe(1);
  });

  it('counts pre-occupancy (entry-standard qualifiers) against the same cap', () => {
    // GBR already has 2 entry-standard qualifiers ahead of the pool. Only 1 pool slot
    // is left for GBR before the cap of 3 is hit.
    const pool = peers([
      [1119, 'GBR'], // takes GBR's last available slot
      [1109, 'GBR'], // blocked: GBR is already at the cap (2 pre-occupied + 1 pool)
    ]);
    expect(qualifyingPoolRank(pool, 1119, 'GBR', { GBR: 2 })).toBe(1);
    expect(qualifyingPoolRank(pool, 1074, 'GBR', { GBR: 2 })).toBeNull();
  });
});

describe('qualifyingPosition', () => {
  it('offsets the pool rank by the fixed non-ranking slots', () => {
    // 13 entry-standard spots ahead of the pool; 1st in the pool -> position 14.
    const pool = peers([
      [1150, 'FRA'],
      [1100, 'GER'],
      [1050, 'ESP'],
    ]);
    expect(qualifyingPosition(pool, 1196, 'ITA', 13)).toBe(14);
  });

  it('returns null when blocked by the country quota', () => {
    const pool = peers([
      [1300, 'ITA'],
      [1250, 'ITA'],
      [1200, 'ITA'],
    ]);
    expect(qualifyingPosition(pool, 1150, 'ITA', 13)).toBeNull();
  });

  it('accounts for pre-occupied country slots from outside the pool', () => {
    // GBR already has 2 entry-standard qualifiers ahead of the pool (pre-occupancy 2).
    // A pool peer (1119) uses GBR's one remaining slot before an unrelated FRA athlete
    // is considered, so the FRA athlete's position is offset by that GBR slot too.
    const pool = peers([[1119, 'GBR']]);
    expect(qualifyingPosition(pool, 1109, 'FRA', 13, { GBR: 2 })).toBe(15);
    // A second GBR pool athlete below the first is blocked outright: GBR is already at
    // the cap (2 pre-occupied + the 1119 peer), so no position exists for them at all —
    // ignoring the pre-occupancy would have wrongly reported a real position (rank 2).
    expect(qualifyingPosition(pool, 1109, 'GBR', 13, { GBR: 2 })).toBeNull();
  });
});

describe('withinWorldRankingQuota', () => {
  it('is true when the pool rank is within the available slots', () => {
    const pool = peers([
      [1150, 'FRA'],
      [1100, 'GER'],
      [1050, 'ESP'],
    ]);
    expect(withinWorldRankingQuota(pool, 1120, 'ITA', 2)).toBe(true); // pool rank 2
    expect(withinWorldRankingQuota(pool, 1000, 'ITA', 2)).toBe(false); // pool rank 4
  });

  it('is false when blocked by the country quota, regardless of slots remaining', () => {
    const pool = peers([
      [1300, 'ITA'],
      [1250, 'ITA'],
      [1200, 'ITA'],
    ]);
    expect(withinWorldRankingQuota(pool, 1150, 'ITA', 10)).toBe(false);
  });

  it('is false when pre-occupied country slots leave no room, even with slots remaining', () => {
    const pool = peers([[1119, 'GBR']]);
    expect(withinWorldRankingQuota(pool, 1109, 'GBR', 20, { GBR: 2 })).toBe(false);
  });
});

describe('countryRank', () => {
  it('ranks by score among same-country peers only', () => {
    const pool = peers([
      [1300, 'ITA'],
      [1100, 'ESP'], // different country — doesn't count
      [1050, 'ITA'],
    ]);
    expect(countryRank(pool, 1150, 'ITA')).toBe(2); // behind the 1300 Italian only
  });

  it('adds pre-occupied slots from outside the pool', () => {
    const pool = peers([[1119, 'GBR']]);
    // 2 GBR entry-standard qualifiers pre-occupy positions 1-2; the pool peer (1119)
    // is 3rd; a lower GBR score is 4th — same numbering as the API's countryPosition.
    expect(countryRank(pool, 1109, 'GBR', { GBR: 2 })).toBe(4);
  });
});
