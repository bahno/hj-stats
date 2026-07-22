import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
    toggle: vi.fn(() => Promise.resolve()),
    loading: false,
  }),
}));
vi.mock('../data/athleteResultsApi', () => ({
  athleteIdFromSlug: () => 1,
  fetchAthleteHighJumpResults: vi.fn(async () => []),
}));
vi.mock('../data/rankingApi', async (orig) => ({
  ...(await orig<typeof import('../data/rankingApi')>()),
  fetchHighJumpRanking: vi.fn(),
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

function row(id: number, athlete: string, slug: string): RankingRow {
  return {
    id,
    place: id,
    worldPlace: id,
    athlete,
    athleteUrlSlug: slug,
    nationality: 'ITA',
    rankingScore: 1400 - id,
    previousPlace: null,
    previousRankingScore: null,
  };
}

const CALC: RankingCalculation = {
  averagePerformanceScore: 1400,
  disciplineList: ['High Jump'],
  results: [],
};

const ROWS = [row(42, 'Gianmarco Tamberi', 'tamberi'), row(43, 'Ada Jumper', 'ada-jumper')];

beforeEach(() => {
  mocks.favorites.current = [
    { id: 'f1', athlete_slug: 'tamberi', athlete_name: 'Gianmarco Tamberi', gender: 'men' },
    { id: 'f2', athlete_slug: 'ada-jumper', athlete_name: 'Ada Jumper', gender: 'men' },
  ];
  vi.mocked(fetchHighJumpRanking).mockReset().mockResolvedValue({
    rankDate: '2026-07-01',
    rows: ROWS,
  });
  vi.mocked(fetchRankingCalculation).mockReset();
});

test('a slow earlier lookup cannot overwrite a newer one', async () => {
  // Click athlete A (slow), then athlete B (fast). B must win and stay won,
  // even though A's request resolves last.
  const deferred: Array<(v: RankingCalculation) => void> = [];
  vi.mocked(fetchRankingCalculation).mockImplementation(
    () => new Promise<RankingCalculation>((resolve) => deferred.push(resolve)),
  );

  render(<AthleteLookup />);

  fireEvent.click(await screen.findByText('★ Gianmarco Tamberi')); // A — first
  await waitFor(() => expect(deferred).toHaveLength(1));
  fireEvent.click(screen.getByText('★ Ada Jumper')); // B — second
  await waitFor(() => expect(deferred).toHaveLength(2));

  deferred[1](CALC); // B resolves first
  await screen.findByText('Ada Jumper', { selector: '.lookup-name' });

  deferred[0](CALC); // A resolves late — must be discarded
  await waitFor(() =>
    expect(screen.queryByText('Gianmarco Tamberi', { selector: '.lookup-name' })).toBeNull(),
  );
  expect(screen.getByText('Ada Jumper', { selector: '.lookup-name' })).toBeInTheDocument();
});

test('a lookup in flight when the gender changes does not repopulate the result', async () => {
  const deferred: Array<(v: RankingCalculation) => void> = [];
  vi.mocked(fetchRankingCalculation).mockImplementation(
    () => new Promise<RankingCalculation>((resolve) => deferred.push(resolve)),
  );

  render(<AthleteLookup />);

  fireEvent.click(await screen.findByText('★ Gianmarco Tamberi'));
  await waitFor(() => expect(deferred).toHaveLength(1));

  fireEvent.click(screen.getByRole('switch', { name: 'Gender' })); // switch away
  deferred[0](CALC); // the men's lookup lands after the switch

  // Give the resolved lookup every chance to render before asserting it didn't:
  // checking immediately would pass even without the guard, since the gender
  // switch clears the result on its own.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(screen.queryByText('Gianmarco Tamberi', { selector: '.lookup-name' })).toBeNull();
});
