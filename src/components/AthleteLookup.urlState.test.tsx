import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import type { RankingRow, RankingCalculation } from '../data/rankingApi';

const { prefs } = vi.hoisted(() => ({
  prefs: {
    defaultGender: null as string | null,
    defaultEvent: null as string | null,
    setDefaultEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../hooks/usePreferences', () => ({
  usePreferences: () => ({
    defaultGender: prefs.defaultGender,
    defaultEvent: prefs.defaultEvent,
    setDefaultEvent: prefs.setDefaultEvent,
    setDefaultGender: vi.fn().mockResolvedValue(undefined),
    loading: false,
  }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock('../hooks/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [],
    isFavorite: () => false,
    toggle: vi.fn(),
    loading: false,
  }),
}));
vi.mock('../data/athleteResultsApi', () => ({
  athleteIdFromSlug: () => 1,
  fetchAthleteResults: vi.fn(async () => []),
}));
vi.mock('../data/rankingApi', async (orig) => ({
  ...(await orig<typeof import('../data/rankingApi')>()),
  fetchRanking: vi.fn(),
  fetchRankingCalculation: vi.fn(),
}));
vi.mock('../data/birminghamApi', async (orig) => ({
  ...(await orig<typeof import('../data/birminghamApi')>()),
  fetchRoadToBirmingham: vi.fn(async () => {
    throw new Error('Birmingham does not stage this event');
  }),
}));

import { AthleteLookup } from './AthleteLookup';
import { fetchRanking, fetchRankingCalculation } from '../data/rankingApi';

const row: RankingRow = {
  id: 42,
  place: 1,
  worldPlace: 3,
  athlete: 'Marcell Jacobs',
  athleteUrlSlug: 'italy/marcell-jacobs-1',
  nationality: 'ITA',
  rankingScore: 1400,
  previousPlace: 2,
  previousRankingScore: 1380,
};

const calc: RankingCalculation = {
  averagePerformanceScore: 1400,
  disciplineList: ['100 Metres'],
  results: [
    {
      date: '01 JUN 2026',
      competition: 'Golden Gala',
      category: 'A',
      race: 'F',
      place: '1.',
      mark: '9.95',
      resultScore: 1200,
      placingScore: 100,
      performanceScore: 1300,
    } as RankingCalculation['results'][number],
  ],
};

function withUrl(search: string) {
  window.history.replaceState(null, '', search);
}

function currentParams() {
  return new URLSearchParams(window.location.search);
}

beforeEach(() => {
  // test-setup.ts already resets the URL before each test.
  prefs.defaultGender = null;
  prefs.defaultEvent = null;
  prefs.setDefaultEvent.mockClear();
  vi.mocked(fetchRanking).mockReset().mockResolvedValue({ rankDate: '26 JUL 2026', rows: [row] });
  vi.mocked(fetchRankingCalculation).mockReset().mockResolvedValue(calc);
});

test('opens on the gender and event group named in the URL', async () => {
  withUrl('?gender=women&event=100m');
  render(<AthleteLookup />);

  await waitFor(() =>
    expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('100m'),
  );
  expect(screen.getByLabelText('Gender')).toHaveAttribute('aria-checked', 'true');
});

test('a link beats the saved default event', async () => {
  prefs.defaultGender = 'men';
  prefs.defaultEvent = 'shot-put';
  withUrl('?event=100m');
  render(<AthleteLookup />);

  await waitFor(() =>
    expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('100m'),
  );
  // Give the preference effect a chance to lose.
  await new Promise((r) => setTimeout(r, 0));
  expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('100m');
});

test('runs the athlete lookup named in the URL on load', async () => {
  withUrl('?event=100m&q=Jacobs');
  render(<AthleteLookup />);

  await screen.findByText(row.athlete, { selector: '.lookup-name' });
  expect(vi.mocked(fetchRanking).mock.calls.every(([slug]) => slug === '100m')).toBe(true);
});

test('picking an event puts it in the URL', async () => {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'javelin-throw' } });

  await waitFor(() => expect(currentParams().get('event')).toBe('javelin-throw'));
  expect(currentParams().get('gender')).toBe('men');
});

test('switching gender puts the counterpart slug in the URL', async () => {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: '110mh' } });
  fireEvent.click(screen.getByLabelText('Gender'));

  await waitFor(() => expect(currentParams().get('gender')).toBe('women'));
  expect(currentParams().get('event')).toBe('100mh');
});

test('a searched athlete lands in the URL, so the result is linkable', async () => {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Jacobs' } });
  fireEvent.click(screen.getByText('Get ranking'));

  await screen.findByText(row.athlete, { selector: '.lookup-name' });
  expect(currentParams().get('q')).toBe('Jacobs');
});

test('changing the event drops the stale athlete from the URL', async () => {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Jacobs' } });
  fireEvent.click(screen.getByText('Get ranking'));
  await screen.findByText(row.athlete, { selector: '.lookup-name' });

  fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'shot-put' } });

  await waitFor(() => expect(currentParams().get('q')).toBeNull());
});

test('an event slug the app does not know falls back instead of breaking', async () => {
  withUrl('?event=quidditch');
  render(<AthleteLookup />);

  expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('high-jump');
});
