import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  expect(screen.getByText('Qualified', { selector: '.road-badge' })).toBeInTheDocument();
});

test('shows the Road To stat as Bubble with the world-rankings pool place', async () => {
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
        qualificationDetails: { place: 45, score: 1105 },
      },
    ]),
  );

  await openResult();

  expect(await screen.findByText('#45')).toBeInTheDocument();
  expect(screen.getByText('Bubble', { selector: '.road-badge' })).toBeInTheDocument();
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
  expect(await screen.findByText('Counting competitions — Road to Birmingham')).toBeInTheDocument();
  expect(screen.getByText('Birmingham Only Meet')).toBeInTheDocument();
  expect(screen.queryByText('World Only Meet')).toBeNull();

  fireEvent.click(screen.getByText('European', { selector: '.ranking-type-label' }));

  expect(await screen.findByText('Counting competitions')).toBeInTheDocument();
  expect(screen.getByText('World Only Meet')).toBeInTheDocument();
  expect(screen.queryByText('Birmingham Only Meet')).toBeNull();
});

test('shows "Blocked by country quota" in the simulate tile when 3 compatriots already rank above the pool', async () => {
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

  // Default rankingType is 'road': three Italians already outrank both the athlete's
  // current score and any plausible simulated score, so the 3-per-country cap blocks them.
  expect(await screen.findByText('Blocked by country quota')).toBeInTheDocument();
});

test('the rest of the result still renders when the Road to Birmingham fetch fails', async () => {
  vi.mocked(fetchRoadToBirmingham).mockRejectedValue(new Error('boom'));

  await openResult();

  await waitFor(() => expect(screen.getByText('Not tracked')).toBeInTheDocument());
  expect(screen.getByText('1400')).toBeInTheDocument();
});
