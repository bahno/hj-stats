import { describe, it, expect } from 'vitest';
import { parseResults, buildRankingState, parseRoadTo, qualificationFor } from './ea';

describe('parseResults', () => {
  // Shape verified against the live endpoint on 2026-07-22 (athlete 14685179).
  const profile = {
    results: {
      years: [2026, 2025],
      categories: [
        {
          discipline: 'High Jump',
          results: [
            { competition: 'Tábor', category: 'E', race: 'F', place: '2.', mark: '1.84', date: '02 JUL 2026' },
            { competition: 'Praha', category: 'F', race: 'F', place: 'OC', mark: '1.85', date: '18 JAN 2026' },
          ],
        },
        {
          discipline: '4x100 Metres Relay',
          results: [
            { competition: 'Juliska', category: 'F', race: 'F', place: '3.', mark: '51.31', date: '11 MAY 2026' },
          ],
        },
      ],
    },
  };

  it('reads results from results.categories, the shape the endpoint returns', () => {
    expect(parseResults(profile)).toEqual([
      { date: '02 JUL 2026', competition: 'Tábor', mark: '1.84' },
      { date: '18 JAN 2026', competition: 'Praha', mark: '1.85' },
    ]);
  });

  it('ignores other disciplines, so a relay split cannot become a season best', () => {
    // 51.31 parses as a much larger number than any high jump mark and would
    // win seasonBest outright if it leaked through.
    expect(parseResults(profile).some((r) => r.mark === '51.31')).toBe(false);
  });

  it('returns [] for an unexpected shape', () => {
    expect(parseResults(null)).toEqual([]);
    expect(parseResults({})).toEqual([]);
    // The shape this parser used to expect — the endpoint never returns it.
    expect(parseResults({ resultsByYear: { resultsByEvent: [{ results: [] }] } })).toEqual([]);
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
