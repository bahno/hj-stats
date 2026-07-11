import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import type { RankingRow, RankingCalculation } from '../data/rankingApi';
import type { RoadToBirmingham } from '../data/birminghamApi';

const mocks = vi.hoisted(() => ({
  favorites: { current: [] as any[] },
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../hooks/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: mocks.favorites.current,
    isFavorite: () => false,
    toggle: vi.fn(),
    loading: false,
  }),
}));
vi.mock('../data/rankingApi', async (orig) => ({
  ...(await orig<typeof import('../data/rankingApi')>()),
  fetchHighJumpRanking: vi.fn(async () => ({ rankDate: '', rows: [] })),
  fetchRankingCalculation: vi.fn(),
}));
vi.mock('../data/birminghamApi', async (orig) => ({
  ...(await orig<typeof import('../data/birminghamApi')>()),
  fetchRoadToBirmingham: vi.fn(),
}));

import { AthleteLookup } from './AthleteLookup';
import { fetchHighJumpRanking, fetchRankingCalculation } from '../data/rankingApi';
import { fetchRoadToBirmingham } from '../data/birminghamApi';

const row: RankingRow = {
  id: 42,
  place: 1,
  worldPlace: 3,
  athlete: 'Gianmarco Tamberi',
  athleteUrlSlug: 'italy/gianmarco-tamberi-14375750',
  nationality: 'ITA',
  rankingScore: 1400,
  previousPlace: 2,
  previousRankingScore: 1380,
};

const calc: RankingCalculation = {
  averagePerformanceScore: 1400,
  disciplineList: ['High Jump'],
  results: [],
};

function roadData(qualifications: RoadToBirmingham['qualifications']): RoadToBirmingham {
  return {
    entryNumber: 30,
    entryStandard: '2.27',
    rankDate: '26 JUL 2026',
    numberOfCompetitorsFilledUpByWorldRankings: 17,
    firstRankingDay: '27 JUL 2025',
    lastRankingDay: '26 JUL 2026',
    qualifications,
  };
}

beforeEach(() => {
  mocks.favorites.current = [
    { id: 'f1', athlete_slug: row.athleteUrlSlug, athlete_name: row.athlete, gender: 'men' },
  ];
  vi.mocked(fetchHighJumpRanking).mockReset();
  vi.mocked(fetchRankingCalculation).mockReset();
  vi.mocked(fetchRoadToBirmingham).mockReset();
  vi.mocked(fetchHighJumpRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row] });
  vi.mocked(fetchRankingCalculation).mockResolvedValue(calc);
});

async function openResult() {
  render(<AthleteLookup />);
  fireEvent.click(await screen.findByText(`★ ${row.athlete}`));
  await screen.findByText(row.athlete, { selector: '.lookup-name' });
}

test('shows the Road To stat as Qualified with the official position', async () => {
  vi.mocked(fetchRoadToBirmingham).mockResolvedValue(
    roadData([
      {
        qualifiedBy: 'Qualified by Entry Standard',
        qualificationTypeId: 'q1',
        qualified: true,
        qualificationPosition: 2,
        countryPosition: 1,
        competitor: {
          athleteId: 14375750,
          name: row.athlete,
          country: 'ITA',
          urlSlug: row.athleteUrlSlug,
        },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { result: '2.33', venue: 'Rome (ITA)', date: '01 JUN 2026' },
      },
    ]),
  );

  await openResult();

  expect(await screen.findByText('Road To', { selector: '.stat-label' })).toBeInTheDocument();
  expect(screen.getByText('#2')).toBeInTheDocument();
  expect(screen.getByText('Qualifying', { selector: '.road-badge' })).toBeInTheDocument();
});

test('shows the Road To stat as Next Best with a computed qualifying-pool position (not the raw World Ranking place)', async () => {
  vi.mocked(fetchRoadToBirmingham).mockResolvedValue(
    roadData([
      {
        qualifiedBy: 'Next best by World Rankings',
        qualificationTypeId: 'n4',
        qualified: false,
        qualificationPosition: null,
        countryPosition: 1,
        competitor: {
          athleteId: 14375750,
          name: row.athlete,
          country: 'ITA',
          urlSlug: row.athleteUrlSlug,
        },
        withdrawn: false,
        rejected: false,
        // place: 45 is the athlete's raw World Ranking place — irrelevant to the
        // qualifying pool. With no other pool peers, their pool rank is 1st, so their
        // qualifying-pool position is nonRankingSlots(13) + 1 = #14, not #45.
        qualificationDetails: { place: 45, score: 1105 },
      },
    ]),
  );

  await openResult();

  expect(await screen.findByText('#14')).toBeInTheDocument();
  expect(screen.queryByText('#45')).toBeNull();
  expect(screen.getByText('Next Best', { selector: '.road-badge' })).toBeInTheDocument();
});

test('accounts for pre-occupied country slots (entry-standard qualifiers), still showing an uncapped rank and a CP pill when blocked', async () => {
  vi.mocked(fetchRoadToBirmingham).mockResolvedValue(
    roadData([
      // GBR already has 2 entry-standard qualifiers ahead of the pool.
      {
        qualifiedBy: 'Qualified by Entry Standard',
        qualificationTypeId: 'q1',
        qualified: true,
        qualificationPosition: 1,
        countryPosition: 1,
        competitor: { athleteId: 10, name: 'GBR One', country: 'GBR', urlSlug: 'gbr/one-10' },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { result: '2.30' },
      },
      {
        qualifiedBy: 'Qualified by Entry Standard',
        qualificationTypeId: 'q1',
        qualified: true,
        qualificationPosition: 2,
        countryPosition: 2,
        competitor: { athleteId: 11, name: 'GBR Two', country: 'GBR', urlSlug: 'gbr/two-11' },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { result: '2.29' },
      },
      // A GBR pool peer uses GBR's one remaining cap slot.
      {
        qualifiedBy: 'In World Rankings quota',
        qualificationTypeId: 'q4',
        qualified: true,
        qualificationPosition: 3,
        countryPosition: 3,
        competitor: { athleteId: 12, name: 'GBR Three', country: 'GBR', urlSlug: 'gbr/three-12' },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { place: 10, score: 1119 },
      },
      // Our looked-up athlete: another GBR pool member, blocked outright by the now-full cap.
      {
        qualifiedBy: 'Next best by World Rankings',
        qualificationTypeId: 'n4',
        qualified: false,
        qualificationPosition: null,
        countryPosition: 4,
        competitor: {
          athleteId: 14375750,
          name: row.athlete,
          country: 'GBR',
          urlSlug: row.athleteUrlSlug,
        },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { place: 33, score: 1109, calculationId: 500 },
      },
    ]),
  );
  vi.mocked(fetchRankingCalculation).mockImplementation(async (id: number) =>
    id === 500 ? { averagePerformanceScore: 1109, disciplineList: ['High Jump'], results: [] } : calc,
  );

  await openResult();

  const roadCard = (await screen.findByText('Road To', { selector: '.stat-label' })).closest(
    '.stat',
  ) as HTMLElement;
  // Blocked outright: 2 entry-standard qualifiers + 1 pool qualifier already fill GBR's
  // 3-per-country cap, so there's no quota-capped position — but a rank ignoring the cap
  // is still shown (nonRankingSlots 13 + pool index 1 (0-based) + 1 = #15), plus a CP pill
  // naming their actual 4th-in-country position (from the API's countryPosition: 4).
  expect(within(roadCard).getByText('#15')).toBeInTheDocument();
  expect(within(roadCard).getByText('Next Best')).toBeInTheDocument();
  expect(within(roadCard).getByText('CP 4')).toBeInTheDocument();

  // The simulate tile can still compute a diff even though the athlete is blocked: their
  // uncapped current position (#15, the same fallback the header shows) is a real
  // baseline, so the delta isn't left blank.
  const positionCard = (await screen.findByText('Position', { selector: '.stat-label' })).closest(
    '.stat',
  ) as HTMLElement;
  expect(within(positionCard).queryByText('—')).toBeNull();
});

test('shows the Road To stat as Not tracked when the athlete has no qualification entry', async () => {
  vi.mocked(fetchRoadToBirmingham).mockResolvedValue(roadData([]));

  await openResult();

  expect(await screen.findByText('Not tracked')).toBeInTheDocument();
});

test('the ranking-type toggle switches the counting competitions list to the Road to Birmingham calculation', async () => {
  vi.mocked(fetchRoadToBirmingham).mockResolvedValue(
    roadData([
      {
        qualifiedBy: 'In World Rankings quota',
        qualificationTypeId: 'q4',
        qualified: true,
        qualificationPosition: 14,
        countryPosition: 1,
        competitor: {
          athleteId: 14375750,
          name: row.athlete,
          country: 'ITA',
          urlSlug: row.athleteUrlSlug,
        },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { place: 7, score: 1196, calculationId: 999 },
      },
      {
        qualifiedBy: 'Next best by World Rankings',
        qualificationTypeId: 'n4',
        qualified: false,
        qualificationPosition: null,
        countryPosition: 1,
        competitor: { athleteId: 2, name: 'Peer One', country: 'FRA', urlSlug: 'france/peer-one-2' },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { place: 20, score: 1150 },
      },
    ]),
  );
  const worldOnlyResult = {
    date: '01 JAN 2026',
    competition: 'World Only Meet',
    discipline: 'High Jump',
    category: 'A',
    race: '',
    place: '1.',
    mark: '2.20',
    performanceScore: 1196,
    resultScore: 1196,
    placingScore: 0,
  };
  const birminghamOnlyResult = {
    ...worldOnlyResult,
    date: '01 FEB 2026',
    competition: 'Birmingham Only Meet',
  };
  vi.mocked(fetchRankingCalculation).mockImplementation(async (id: number) =>
    id === 999
      ? { averagePerformanceScore: 1196, disciplineList: ['High Jump'], results: [birminghamOnlyResult] }
      : { ...calc, results: [worldOnlyResult] },
  );

  await openResult();

  // rankingType defaults to 'road', so the Birmingham calculation should already be showing.
  expect(await screen.findByText('Birmingham Only Meet')).toBeInTheDocument();
  expect(screen.queryByText('World Only Meet')).toBeNull();

  fireEvent.click(screen.getByText('European', { selector: '.ranking-type-label' }));

  expect(await screen.findByText('World Only Meet')).toBeInTheDocument();
  expect(screen.queryByText('Birmingham Only Meet')).toBeNull();
});

test('shows "Next Best" with a CP pill in the simulate tile when 3 compatriots already occupy the country quota', async () => {
  vi.mocked(fetchRoadToBirmingham).mockResolvedValue(
    roadData([
      {
        qualifiedBy: 'In World Rankings quota',
        qualificationTypeId: 'q4',
        qualified: true,
        qualificationPosition: 4,
        countryPosition: 4,
        competitor: {
          athleteId: 14375750,
          name: row.athlete,
          country: 'ITA',
          urlSlug: row.athleteUrlSlug,
        },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { place: 4, score: 1196, calculationId: 999 },
      },
      {
        qualifiedBy: 'In World Rankings quota',
        qualificationTypeId: 'q4',
        qualified: true,
        qualificationPosition: 1,
        countryPosition: 1,
        competitor: { athleteId: 2, name: 'Peer A', country: 'ITA', urlSlug: 'italy/peer-a-2' },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { place: 1, score: 9999 },
      },
      {
        qualifiedBy: 'In World Rankings quota',
        qualificationTypeId: 'q4',
        qualified: true,
        qualificationPosition: 2,
        countryPosition: 2,
        competitor: { athleteId: 3, name: 'Peer B', country: 'ITA', urlSlug: 'italy/peer-b-3' },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { place: 2, score: 9998 },
      },
      {
        qualifiedBy: 'Next best by World Rankings',
        qualificationTypeId: 'n4',
        qualified: false,
        qualificationPosition: null,
        countryPosition: 3,
        competitor: { athleteId: 4, name: 'Peer C', country: 'ITA', urlSlug: 'italy/peer-c-4' },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { place: 3, score: 9997 },
      },
    ]),
  );
  vi.mocked(fetchRankingCalculation).mockImplementation(async (id: number) =>
    id === 999 ? { averagePerformanceScore: 1196, disciplineList: ['High Jump'], results: [] } : calc,
  );

  await openResult();

  // Default rankingType is 'road': three Italians already outrank any plausible simulated
  // score, so the 3-per-country cap blocks the simulated result outright — the simulate
  // tile still shows "Next Best" (not a blank dash) plus a CP pill for the simulated
  // country standing (1 + 3 higher-scoring ITA peers = 4th in country).
  expect(await screen.findByText('Next Best', { selector: '.road-badge' })).toBeInTheDocument();
  expect(screen.getByText('CP 4', { selector: '.road-badge' })).toBeInTheDocument();
});

test('the rest of the result still renders when the Road to Birmingham fetch fails', async () => {
  vi.mocked(fetchRoadToBirmingham).mockRejectedValue(new Error('boom'));

  await openResult();

  await waitFor(() => expect(screen.getByText('Not tracked')).toBeInTheDocument());
  expect(screen.getByText('1400')).toBeInTheDocument();
});
