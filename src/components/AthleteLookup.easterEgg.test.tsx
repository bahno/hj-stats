import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import type { RankingRow, RankingCalculation } from '../data/rankingApi';

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
  fetchRoadToBirmingham: vi.fn(async () => ({
    entryNumber: 30,
    entryStandard: '2.27',
    rankDate: '',
    numberOfCompetitorsFilledUpByWorldRankings: 17,
    firstRankingDay: '27 JUL 2025',
    lastRankingDay: '26 JUL 2026',
    qualifications: [],
  })),
}));

import { AthleteLookup } from './AthleteLookup';
import { fetchHighJumpRanking, fetchRankingCalculation } from '../data/rankingApi';

const calc: RankingCalculation = {
  averagePerformanceScore: 1500,
  disciplineList: ['High Jump'],
  results: [],
};

function row(id: number, athlete: string, slug: string): RankingRow {
  return {
    id,
    place: 1,
    worldPlace: 1,
    athlete,
    athleteUrlSlug: slug,
    nationality: 'CZE',
    rankingScore: 1500,
    previousPlace: 1,
    previousRankingScore: 1500,
  };
}

beforeEach(() => {
  vi.mocked(fetchRankingCalculation).mockReset();
  vi.mocked(fetchRankingCalculation).mockResolvedValue(calc);
});

test('shows the diadem for Klára, matching her name diacritic-insensitively', async () => {
  // The ranking (and the saved favorite) carry the accented spelling.
  mocks.favorites.current = [
    { id: 'f1', athlete_slug: 'krejcirikova', athlete_name: 'Klára Krejčířiková', gender: 'women' },
  ];
  vi.mocked(fetchHighJumpRanking).mockResolvedValue({
    rankDate: '2026-07-01',
    rows: [row(7, 'Klára Krejčířiková', 'krejcirikova')],
  });

  render(<AthleteLookup />);
  fireEvent.click(await screen.findByText('★ Klára Krejčířiková'));

  const name = await screen.findByText('Klára Krejčířiková', { selector: '.lookup-name' });
  await waitFor(() => expect(name.querySelector('.klara-diadem')).toBeInTheDocument());
});

test('does not show the diadem for other athletes', async () => {
  mocks.favorites.current = [
    { id: 'f2', athlete_slug: 'tamberi', athlete_name: 'Gianmarco Tamberi', gender: 'men' },
  ];
  vi.mocked(fetchHighJumpRanking).mockResolvedValue({
    rankDate: '2026-07-01',
    rows: [row(42, 'Gianmarco Tamberi', 'tamberi')],
  });

  render(<AthleteLookup />);
  fireEvent.click(await screen.findByText('★ Gianmarco Tamberi'));

  const name = await screen.findByText('Gianmarco Tamberi', { selector: '.lookup-name' });
  expect(name.querySelector('.klara-diadem')).toBeNull();
});
