import { describe, it, expect } from 'vitest';
import {
  diffResults,
  diffPlace,
  diffScore,
  diffQualification,
  filterByPrefs,
  buildResultsDigest,
  buildRankingDigest,
  type Snapshot,
  type RankingState,
  type AthleteEvents,
} from './detectors';

const emptySnap: Snapshot = {
  rank_date: null,
  world_place: null,
  european_place: null,
  ranking_score: null,
  results: [],
  qualification: null,
};

const curr = (over: Partial<RankingState> = {}): RankingState => ({
  rankDate: '07 JUL 2026',
  worldPlace: 10,
  europeanPlace: 3,
  rankingScore: 1234,
  results: [],
  qualification: null,
  ...over,
});

describe('diffResults', () => {
  it('treats every current result as new when prev is empty (caller seeds on first run)', () => {
    // diffResults is pure: with no prior results, all current results are "new".
    // The first-run seeding policy lives in the poller (Task 7), which skips
    // notifications when the snapshot did not previously exist.
    const out = diffResults([], [{ date: '2026-07-05', competition: 'X', mark: '2.30' }]);
    expect(out).toHaveLength(1);
  });

  it('returns only new results by key', () => {
    const prev = [{ date: '2026-07-05', competition: 'X', mark: '2.30' }];
    const now = [
      { date: '2026-07-05', competition: 'X', mark: '2.30' },
      { date: '2026-07-12', competition: 'Y', mark: '2.28' },
    ];
    const out = diffResults(prev, now);
    expect(out).toEqual([{ date: '2026-07-12', competition: 'Y', mark: '2.28' }]);
  });
});

describe('diffPlace', () => {
  it('detects an improvement (lower number = up)', () => {
    const out = diffPlace({ ...emptySnap, european_place: 5, world_place: 12 }, curr());
    expect(out).toEqual([
      { scope: 'european', from: 5, to: 3, direction: 'up' },
      { scope: 'world', from: 12, to: 10, direction: 'up' },
    ]);
  });

  it('returns [] when unchanged', () => {
    const out = diffPlace({ ...emptySnap, european_place: 3, world_place: 10 }, curr());
    expect(out).toEqual([]);
  });
});

describe('diffScore', () => {
  it('detects a score change with delta', () => {
    const out = diffScore({ ...emptySnap, ranking_score: 1200 }, curr());
    expect(out).toEqual({ from: 1200, to: 1234, delta: 34 });
  });
  it('null when unchanged', () => {
    expect(diffScore({ ...emptySnap, ranking_score: 1234 }, curr())).toBeNull();
  });
});

describe('diffQualification', () => {
  it('detects entering the quota', () => {
    const out = diffQualification(
      { ...emptySnap, qualification: { qualified: false, place: 40, target: 32 } },
      curr({ qualification: { qualified: true, place: 30, target: 32 } }),
    );
    expect(out).toEqual({ from: false, to: true, place: 30, target: 32 });
  });
  it('null when qualified state unchanged', () => {
    const out = diffQualification(
      { ...emptySnap, qualification: { qualified: true, place: 30, target: 32 } },
      curr({ qualification: { qualified: true, place: 29, target: 32 } }),
    );
    expect(out).toBeNull();
  });
});

describe('filterByPrefs', () => {
  const ev: AthleteEvents = {
    slug: 's',
    name: 'A',
    gender: 'men',
    results: [{ date: '2026-07-12', competition: 'Y', mark: '2.28' }],
    place: [{ scope: 'european', from: 5, to: 3, direction: 'up' }],
    score: { from: 1200, to: 1234, delta: 34 },
    qualification: null,
  };
  it('drops trigger types the user disabled', () => {
    const out = filterByPrefs(ev, { place: false, score: true, result: true, qualification: true });
    expect(out.place).toEqual([]);
    expect(out.score).not.toBeNull();
    expect(out.results).toHaveLength(1);
  });
});

describe('digest builders', () => {
  const withResults: AthleteEvents = {
    slug: 's',
    name: 'Ada Jumper',
    gender: 'men',
    results: [{ date: '2026-07-12', competition: 'Rome GP', mark: '2.30' }],
    place: [],
    score: null,
    qualification: null,
  };
  it('buildResultsDigest returns null when no athlete has results', () => {
    expect(buildResultsDigest('Sam', [{ ...withResults, results: [] }])).toBeNull();
  });
  it('buildResultsDigest includes athlete name and mark', () => {
    const out = buildResultsDigest('Sam', [withResults]);
    expect(out).not.toBeNull();
    expect(out!.text).toContain('Ada Jumper');
    expect(out!.text).toContain('2.30');
    expect(out!.html).toContain('Ada Jumper');
  });
  it('buildRankingDigest returns null when no ranking changes', () => {
    expect(buildRankingDigest('Sam', [withResults])).toBeNull();
  });
  it('buildRankingDigest summarises a place move', () => {
    const out = buildRankingDigest('Sam', [
      { ...withResults, results: [], place: [{ scope: 'european', from: 5, to: 3, direction: 'up' }] },
    ]);
    expect(out).not.toBeNull();
    expect(out!.text).toContain('European');
    expect(out!.text).toContain('3');
  });
});
