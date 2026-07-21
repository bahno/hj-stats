import { describe, it, expect } from 'vitest';
import { parseResults, buildRankingState, parseRoadTo, qualificationFor } from './ea';

describe('parseResults', () => {
  it('maps a profile results-by-year structure into flat ResultItem[]', () => {
    const profile = {
      resultsByYear: {
        activeYear: 2026,
        resultsByEvent: [
          {
            discipline: 'High Jump',
            results: [
              { date: '12 JUL 2026', competition: 'Rome GP', mark: '2.30' },
              { date: '05 JUL 2026', competition: 'Oslo', mark: '2.28' },
            ],
          },
        ],
      },
    };
    const out = parseResults(profile);
    expect(out).toEqual([
      { date: '12 JUL 2026', competition: 'Rome GP', mark: '2.30' },
      { date: '05 JUL 2026', competition: 'Oslo', mark: '2.28' },
    ]);
  });

  it('returns [] for an unexpected shape', () => {
    expect(parseResults(null)).toEqual([]);
    expect(parseResults({})).toEqual([]);
  });
});

describe('buildRankingState', () => {
  it('assembles a RankingState', () => {
    const s = buildRankingState(
      { europeanPlace: 3, worldPlace: 10, rankingScore: 1234, calculationId: 999 },
      '12 JUL 2026',
      [{ date: '12 JUL 2026', competition: 'Rome GP', mark: '2.30' }],
      { qualified: true, place: 30, target: 32 },
    );
    expect(s.rankDate).toBe('12 JUL 2026');
    expect(s.europeanPlace).toBe(3);
    expect(s.results).toHaveLength(1);
    expect(s.qualification?.qualified).toBe(true);
  });
});

describe('parseRoadTo', () => {
  it('reduces the qualifying-system response to slug/qualified/position', () => {
    const raw = {
      entryNumber: 30,
      qualifications: [
        {
          qualified: true,
          qualificationPosition: 12,
          competitor: { urlSlug: 'italy/gianmarco-tamberi-14375750' },
        },
        {
          qualified: false,
          qualificationPosition: null,
          competitor: { urlSlug: 'ukraine/oleh-doroshchuk-14803002' },
        },
      ],
    };
    const out = parseRoadTo(raw);
    expect(out.entryNumber).toBe(30);
    expect(out.qualifications).toEqual([
      { urlSlug: 'italy/gianmarco-tamberi-14375750', qualified: true, qualificationPosition: 12 },
      { urlSlug: 'ukraine/oleh-doroshchuk-14803002', qualified: false, qualificationPosition: null },
    ]);
  });

  it('returns an empty structure for an unexpected shape', () => {
    expect(parseRoadTo(null)).toEqual({ entryNumber: null, qualifications: [] });
  });
});

describe('qualificationFor', () => {
  const road = {
    entryNumber: 30,
    qualifications: [
      { urlSlug: 'a', qualified: true, qualificationPosition: 12 },
      { urlSlug: 'b', qualified: false, qualificationPosition: null },
    ],
  };
  it('maps a matched entry to QualificationState (target = entryNumber)', () => {
    expect(qualificationFor(road, 'a')).toEqual({ qualified: true, place: 12, target: 30 });
    expect(qualificationFor(road, 'b')).toEqual({ qualified: false, place: null, target: 30 });
  });
  it('returns null when the athlete is not in the system, or road is null', () => {
    expect(qualificationFor(road, 'zzz')).toBeNull();
    expect(qualificationFor(null, 'a')).toBeNull();
  });
});
