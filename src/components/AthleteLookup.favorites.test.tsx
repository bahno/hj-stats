import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import type { RankingRow, RankingCalculation } from '../data/rankingApi';

const mocks = vi.hoisted(() => ({
  user: { current: { id: 'u1' } as { id: string } | null },
  favorites: { current: [] as any[] },
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));
vi.mock('../hooks/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: mocks.favorites.current,
    isFavorite: () => false,
    toggle: vi.fn(),
    loading: false,
  }),
}));
// Avoid real network from the ranking API on mount.
vi.mock('../data/rankingApi', async (orig) => ({
  ...(await orig<typeof import('../data/rankingApi')>()),
  fetchHighJumpRanking: vi.fn(async () => ({ rankDate: '', rows: [] })),
  fetchRankingCalculation: vi.fn(),
}));

import { AthleteLookup } from './AthleteLookup';
import { fetchHighJumpRanking, fetchRankingCalculation } from '../data/rankingApi';

beforeEach(() => {
  mocks.user.current = { id: 'u1' };
  mocks.favorites.current = [
    { id: 'f1', athlete_slug: 'tamberi', athlete_name: 'Gianmarco Tamberi', gender: 'men' },
  ];
  vi.mocked(fetchHighJumpRanking).mockReset();
  vi.mocked(fetchRankingCalculation).mockReset();
  vi.mocked(fetchHighJumpRanking).mockResolvedValue({ rankDate: '', rows: [] });
});

test('shows a favorites strip for signed-in users', async () => {
  render(<AthleteLookup />);
  await waitFor(() =>
    expect(screen.getByText('★ Gianmarco Tamberi')).toBeInTheDocument(),
  );
});

test('clicking a favorite chip re-runs the lookup and renders the result', async () => {
  const row: RankingRow = {
    id: 42,
    place: 1,
    worldPlace: 3,
    athlete: 'Gianmarco Tamberi',
    athleteUrlSlug: 'tamberi',
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
  vi.mocked(fetchHighJumpRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row] });
  vi.mocked(fetchRankingCalculation).mockResolvedValue(calc);

  render(<AthleteLookup />);

  const chip = await screen.findByText('★ Gianmarco Tamberi');
  fireEvent.click(chip);

  await waitFor(() =>
    expect(screen.getByText('Gianmarco Tamberi', { selector: '.lookup-name' })).toBeInTheDocument(),
  );
  expect(fetchRankingCalculation).toHaveBeenCalledWith(42);
});
