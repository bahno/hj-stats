import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import type { RankingRow, RankingCalculation } from '../data/rankingApi';

const mocks = vi.hoisted(() => ({
  user: { current: { id: 'u1' } as { id: string } | null },
  favorites: { current: [] as any[] },
  toggle: vi.fn(),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));
vi.mock('../hooks/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: mocks.favorites.current,
    isFavorite: () => false,
    toggle: mocks.toggle,
    loading: false,
  }),
}));
// Avoid real network from the ranking API on mount.
vi.mock('../data/athleteResultsApi', () => ({
  athleteIdFromSlug: () => 1,
  fetchAthleteResults: vi.fn(async () => []),
}));
vi.mock('../data/rankingApi', async (orig) => ({
  ...(await orig<typeof import('../data/rankingApi')>()),
  fetchRanking: vi.fn(async () => ({ rankDate: '', rows: [] })),
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
import { fetchRanking, fetchRankingCalculation } from '../data/rankingApi';

/** The event group slug the most recent ranking fetch ran against. */
function lastRankingSlug(): string | undefined {
  const calls = vi.mocked(fetchRanking).mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  mocks.user.current = { id: 'u1' };
  mocks.favorites.current = [
    {
      id: 'f1',
      athlete_slug: 'tamberi',
      athlete_name: 'Gianmarco Tamberi',
      gender: 'men',
      event_groups: ['high-jump'],
    },
  ];
  vi.mocked(fetchRanking).mockReset();
  vi.mocked(fetchRankingCalculation).mockReset();
  vi.mocked(fetchRanking).mockResolvedValue({ rankDate: '', rows: [] });
  mocks.toggle.mockReset().mockResolvedValue(undefined);
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
  vi.mocked(fetchRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row] });
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
  vi.mocked(fetchRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row1, row2] });

  render(<AthleteLookup />);

  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), {
    target: { value: 'Tamberi' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Get ranking' }));

  const [star] = await screen.findAllByRole('button', { name: 'Add favorite' });
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
  vi.mocked(fetchRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row] });
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

test('surfaces the 50-favorite cap instead of failing silently', async () => {
  // The cap is a database trigger, so the client only learns about it from the
  // error it raises — the star must say so rather than quietly doing nothing.
  mocks.toggle.mockRejectedValue(new Error('favorite limit reached (50)'));
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
  vi.mocked(fetchRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row, { ...row, id: 43, athlete: 'Lorenzo Tamberi', athleteUrlSlug: 'lorenzo-tamberi' }] });

  render(<AthleteLookup />);
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Tamberi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Get ranking' }));

  const [star] = await screen.findAllByRole('button', { name: 'Add favorite' });
  fireEvent.click(star);

  expect(await screen.findByText(/50-favorite limit/i)).toBeInTheDocument();
});

test('starring an athlete records the event group they were found in', async () => {
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
  vi.mocked(fetchRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row, { ...row, id: 43, athlete: 'Lorenzo Tamberi', athleteUrlSlug: 'lorenzo-tamberi' }] });

  render(<AthleteLookup />);
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'javelin-throw' } });
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Tamberi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Get ranking' }));

  const [star] = await screen.findAllByRole('button', { name: 'Add favorite' });
  fireEvent.click(star);

  expect(mocks.toggle).toHaveBeenCalledWith(
    expect.objectContaining({ athlete_slug: 'tamberi', event_groups: ['javelin-throw'] }),
  );
});

test("a favorite chip searches the athlete's own discipline, not the selected one", async () => {
  mocks.favorites.current = [
    {
      id: 'f1',
      athlete_slug: 'duplantis',
      athlete_name: 'Armand Duplantis',
      gender: 'men',
      event_groups: ['pole-vault'],
    },
  ];
  vi.mocked(fetchRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [] });

  render(<AthleteLookup />);
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'shot-put' } });
  fireEvent.click(await screen.findByText('★ Armand Duplantis'));

  await waitFor(() =>
    expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('pole-vault'),
  );
  expect(lastRankingSlug()).toBe('pole-vault');
});

test('a favorite chip keeps the selected event when the athlete is followed in it', async () => {
  mocks.favorites.current = [
    {
      id: 'f1',
      athlete_slug: 'duplantis',
      athlete_name: 'Armand Duplantis',
      gender: 'men',
      event_groups: ['pole-vault', 'long-jump'],
    },
  ];
  vi.mocked(fetchRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [] });

  render(<AthleteLookup />);
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'long-jump' } });
  fireEvent.click(await screen.findByText('★ Armand Duplantis'));

  await waitFor(() => expect(lastRankingSlug()).toBe('long-jump'));
});

test('prompts unauthenticated users to sign in when starring', async () => {
  mocks.user.current = null;
  mocks.favorites.current = [];
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
  vi.mocked(fetchRanking).mockResolvedValue({ rankDate: '2026-07-01', rows: [row, { ...row, id: 43, athlete: 'Lorenzo Tamberi', athleteUrlSlug: 'lorenzo-tamberi' }] });

  render(<AthleteLookup />);
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Tamberi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Get ranking' }));

  const [star] = await screen.findAllByRole('button', { name: 'Add favorite' });
  fireEvent.click(star);

  expect(await screen.findByText('Sign in to save favorites.')).toBeInTheDocument();
  expect(mocks.toggle).not.toHaveBeenCalled();
});
