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

test('clicking a favorite star in the candidates list does not select the row', async () => {
  const row1: RankingRow = {
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
  const row2: RankingRow = {
    id: 43,
    place: 2,
    worldPlace: 4,
    athlete: 'Lorenzo Tamberi',
    athleteUrlSlug: 'lorenzo-tamberi',
    nationality: 'ITA',
    rankingScore: 1390,
    previousPlace: 3,
    previousRankingScore: 1375,
  };
  vi.mocked(fetchHighJumpRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row1, row2] });

  render(<AthleteLookup />);

  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), {
    target: { value: 'Tamberi' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Get ranking' }));

  const star = await screen.findByRole('button', { name: 'Add favorite' });
  fireEvent.click(star);

  expect(fetchRankingCalculation).not.toHaveBeenCalled();
});

test('switching gender clears the selected favorite name and result', async () => {
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
  vi.mocked(fetchHighJumpRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row] });
  vi.mocked(fetchRankingCalculation).mockResolvedValue({
    averagePerformanceScore: 1400,
    disciplineList: ['High Jump'],
    results: [],
  });

  render(<AthleteLookup />);
  fireEvent.click(await screen.findByText('★ Gianmarco Tamberi'));
  await screen.findByText('Gianmarco Tamberi', { selector: '.lookup-name' });
  expect((screen.getByPlaceholderText('e.g. Tamberi') as HTMLInputElement).value).toBe(
    'Gianmarco Tamberi',
  );

  fireEvent.click(screen.getByRole('switch', { name: 'Gender' }));

  expect((screen.getByPlaceholderText('e.g. Tamberi') as HTMLInputElement).value).toBe('');
  expect(screen.queryByText('Gianmarco Tamberi', { selector: '.lookup-name' })).toBeNull();
});
