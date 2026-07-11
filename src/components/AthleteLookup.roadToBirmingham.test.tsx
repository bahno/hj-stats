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

test('shows the Qualified badge and position for a qualified athlete', async () => {
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

  expect(await screen.findByText('Qualified')).toBeInTheDocument();
  expect(screen.getByText('2.33 m · Rome (ITA) · 01 JUN 2026')).toBeInTheDocument();
  expect(screen.getByText('#2 of 30 qualifying spots')).toBeInTheDocument();
});

test('shows the bubble state for a not-yet-qualified athlete', async () => {
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

  expect(await screen.findByText('Not yet qualifying')).toBeInTheDocument();
  expect(screen.getByText('World ranking #45 · 1105 pts')).toBeInTheDocument();
});

test('shows "not tracked" when the athlete has no qualification entry', async () => {
  vi.mocked(fetchRoadToBirmingham).mockResolvedValue(roadData([]));

  await openResult();

  expect(
    await screen.findByText('Not currently on the Road to Birmingham list.'),
  ).toBeInTheDocument();
});

test('shows a simulation source switch for athletes in the world-rankings pool, and switching recomputes the standing stat', async () => {
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

  expect(await screen.findByText('World ranking')).toBeInTheDocument();
  expect(screen.getByText('New European')).toBeInTheDocument();
  expect(screen.queryByText(/Scoped to the Birmingham qualifying window/)).toBeNull();
  expect(screen.getByText('World Only Meet')).toBeInTheDocument();
  expect(screen.queryByText('Birmingham Only Meet')).toBeNull();

  fireEvent.click(screen.getByText('Road to Birmingham', { selector: 'button' }));

  expect(await screen.findByText('New Birmingham position')).toBeInTheDocument();
  expect(screen.queryByText('New European')).toBeNull();
  expect(
    screen.getByText(/Scoped to the Birmingham qualifying window \(27 JUL 2025 – 26 JUL 2026\)/),
  ).toBeInTheDocument();
  expect(screen.getByText('Birmingham Only Meet')).toBeInTheDocument();
  expect(screen.queryByText('World Only Meet')).toBeNull();
  expect(screen.getByText('Counting competitions — Road to Birmingham')).toBeInTheDocument();
});

test('does not show the switch when the athlete has no world-rankings calculation (e.g. qualified by entry standard)', async () => {
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
  await screen.findByText('Qualified');

  expect(screen.queryByText('World ranking')).toBeNull();
  expect(screen.getByText('New European')).toBeInTheDocument();
});

test('the rest of the result still renders when the Road to Birmingham fetch fails', async () => {
  vi.mocked(fetchRoadToBirmingham).mockRejectedValue(new Error('boom'));

  await openResult();

  await waitFor(() =>
    expect(
      screen.getByText('Not currently on the Road to Birmingham list.'),
    ).toBeInTheDocument(),
  );
  expect(screen.getByText('1400')).toBeInTheDocument();
});
