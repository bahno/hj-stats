import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
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
vi.mock('../data/athleteResultsApi', () => ({
  athleteIdFromSlug: () => 1,
  fetchAthleteHighJumpResults: vi.fn(async () => []),
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

function roadData(qualifications: RoadToBirmingham['qualifications']): RoadToBirmingham {
  return {
    entryNumber: 30,
    entryStandard: '2.28',
    rankDate: '26 JUL 2026',
    numberOfCompetitorsFilledUpByWorldRankings: 17,
    firstRankingDay: '27 JUL 2025',
    lastRankingDay: '26 JUL 2026',
    qualifications,
  };
}

beforeEach(() => {
  mocks.favorites.current = [];
  vi.mocked(fetchRankingCalculation).mockReset();
});

test('finds and shows an entry-standard qualifier who has no World Ranking entry at all', async () => {
  vi.mocked(fetchRoadToBirmingham).mockResolvedValue(
    roadData([
      {
        qualifiedBy: 'Qualified by Entry Standard',
        qualificationTypeId: 'q1',
        qualified: true,
        qualificationPosition: 10,
        countryPosition: 1,
        competitor: {
          athleteId: 14927349,
          name: 'Bozhidar SARÂBOYUKOV',
          country: 'BUL',
          urlSlug: 'bulgaria/bozhidar-saraboyukov-14927349',
        },
        withdrawn: false,
        rejected: false,
        qualificationDetails: {
          result: '2.28',
          venue: 'Festivalna, Sofia (BUL)',
          date: '01 MAR 2026',
        },
      },
    ]),
  );

  render(<AthleteLookup />);
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), {
    target: { value: 'Saraboyukov' },
  });
  fireEvent.click(screen.getByText('Get ranking'));

  expect(await screen.findByText('Bozhidar SARÂBOYUKOV', { selector: '.lookup-name' })).toBeInTheDocument();
  // No World Ranking place — the Score/European/World tiles collapse to a single placeholder.
  expect(screen.getByText('World Ranking', { selector: '.stat-label' })).toBeInTheDocument();
  expect(screen.queryByText('Score', { selector: '.stat-label' })).toBeNull();
  // But the Road To stat is fully populated, using the qualification entry directly.
  expect(screen.getByText('#10')).toBeInTheDocument();
  expect(screen.getByText('Qualifying', { selector: '.road-badge' })).toBeInTheDocument();
  // The qualifying performance itself is shown in place of a counting-competitions list.
  expect(screen.getByText('Qualified by Entry Standard')).toBeInTheDocument();
  expect(screen.getByText(/Festivalna, Sofia/)).toBeInTheDocument();
  expect(screen.getByText(/2\.28 m/)).toBeInTheDocument();

  // fetchRankingCalculation is only meaningful for ranked athletes — never called here.
  expect(fetchRankingCalculation).not.toHaveBeenCalled();
});

test('lists both a ranked athlete and an entry-standard-only qualifier as separate candidates', async () => {
  vi.mocked(fetchHighJumpRanking).mockResolvedValueOnce({
    rankDate: '2026-07-01',
    rows: [
      {
        id: 1,
        place: 5,
        worldPlace: 9,
        athlete: 'Ivan Sarabov',
        athleteUrlSlug: 'bulgaria/ivan-sarabov-1',
        nationality: 'BUL',
        rankingScore: 1200,
        previousPlace: null,
        previousRankingScore: null,
      },
    ],
  });
  vi.mocked(fetchRoadToBirmingham).mockResolvedValue(
    roadData([
      {
        qualifiedBy: 'Qualified by Entry Standard',
        qualificationTypeId: 'q1',
        qualified: true,
        qualificationPosition: 10,
        countryPosition: 1,
        competitor: {
          athleteId: 2,
          name: 'Petar Sarabov',
          country: 'BUL',
          urlSlug: 'bulgaria/petar-sarabov-2',
        },
        withdrawn: false,
        rejected: false,
        qualificationDetails: { result: '2.28' },
      },
    ]),
  );

  render(<AthleteLookup />);
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), {
    target: { value: 'Sarabov' },
  });
  fireEvent.click(screen.getByText('Get ranking'));

  expect(await screen.findByText('Ivan Sarabov')).toBeInTheDocument();
  expect(screen.getByText('Petar Sarabov')).toBeInTheDocument();
  expect(screen.getByText(/Qualified by Entry Standard/)).toBeInTheDocument();
});
