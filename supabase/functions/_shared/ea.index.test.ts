import { describe, it, expect } from 'vitest';
import { fetchRankingIndex, fetchAthleteState, type FetchDeps } from './ea';

/** A ranking page as the EA tRPC gateway wraps it. */
function rankingPage(pages: number, rankDate: string, rankings: unknown[]) {
  return { result: { data: { json: { pages, rankDate, rankings } } } };
}

const ROW = {
  athleteUrlSlug: 'italy/gianmarco-tamberi-14375750',
  place: 2,
  worldPlace: 5,
  rankingScore: 1400,
  id: 999,
};

describe('fetchRankingIndex', () => {
  it('pages through the whole list once and indexes it by slug', async () => {
    const calls: string[] = [];
    const deps: FetchDeps = {
      async fetchJson(url) {
        calls.push(url);
        return url.includes('page')
          ? rankingPage(2, '26 JUL 2026', [{ ...ROW, athleteUrlSlug: 'x/b-2', place: 9 }])
          : rankingPage(2, '26 JUL 2026', [ROW]);
      },
    };

    const index = await fetchRankingIndex('men', deps);

    expect(calls).toHaveLength(2); // page 1 + page 2, and nothing more
    expect(index.rankDate).toBe('26 JUL 2026');
    expect(index.bySlug.size).toBe(2);
    expect(index.bySlug.get(ROW.athleteUrlSlug)).toEqual({
      waId: 14375750,
      row: { europeanPlace: 2, worldPlace: 5, rankingScore: 1400, calculationId: 999 },
    });
    // The trailing-digits id is what the profile endpoint is keyed on.
    expect(index.bySlug.get('x/b-2')?.waId).toBe(2);
  });

  it('skips rows with no slug rather than indexing an empty key', async () => {
    const deps: FetchDeps = {
      fetchJson: async () => rankingPage(1, '26 JUL 2026', [ROW, { place: 3 }]),
    };
    const index = await fetchRankingIndex('women', deps);
    expect(index.bySlug.size).toBe(1);
    expect(index.bySlug.has('')).toBe(false);
  });
});

describe('fetchAthleteState', () => {
  const index = {
    rankDate: '26 JUL 2026',
    bySlug: new Map([
      [
        ROW.athleteUrlSlug,
        {
          waId: 14375750,
          row: { europeanPlace: 2, worldPlace: 5, rankingScore: 1400, calculationId: 999 },
        },
      ],
    ]),
  };

  it('resolves from the pre-fetched index without re-reading the ranking', async () => {
    const calls: string[] = [];
    const deps: FetchDeps = {
      async fetchJson(url) {
        calls.push(url);
        return {
          result: {
            data: {
              json: {
                resultsByYear: {
                  resultsByEvent: [
                    { results: [{ date: '12 JUL 2026', competition: 'Rome', mark: '2.30' }] },
                  ],
                },
              },
            },
          },
        };
      },
    };

    const state = await fetchAthleteState(ROW.athleteUrlSlug, index, null, deps);

    // Only the profile call — the ranking list is never re-fetched per athlete.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('getAthleteProfile');
    expect(state?.rankDate).toBe('26 JUL 2026');
    expect(state?.europeanPlace).toBe(2);
    expect(state?.results).toEqual([{ date: '12 JUL 2026', competition: 'Rome', mark: '2.30' }]);
  });

  it('returns null results (not []) when the profile fetch fails', async () => {
    const deps: FetchDeps = {
      fetchJson: async () => {
        throw new Error('HTTP 503');
      },
    };
    const state = await fetchAthleteState(ROW.athleteUrlSlug, index, null, deps);
    // null means "unknown" — the caller must leave the stored snapshot alone.
    // [] would mean "this athlete has no results" and replay every result as new.
    expect(state).not.toBeNull();
    expect(state?.results).toBeNull();
    expect(state?.europeanPlace).toBe(2); // ranking data still usable
  });

  it('returns null when the athlete is absent from the ranking', async () => {
    const deps: FetchDeps = { fetchJson: async () => ({}) };
    expect(await fetchAthleteState('nobody/no-one-1', index, null, deps)).toBeNull();
  });
});
