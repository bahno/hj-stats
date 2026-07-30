import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import type { RankingRow, RankingCalculation } from '../data/rankingApi';

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

beforeEach(() => {
  vi.mocked(fetchRanking).mockReset().mockResolvedValue({ rankDate: '26 JUL 2026', rows: [row] });
  vi.mocked(fetchRankingCalculation).mockReset().mockResolvedValue(calc);
});

function selectEvent(mainEvent: string) {
  fireEvent.change(screen.getByLabelText('Event'), {
    target: { value: mainEvent },
  });
}

test('defaults to high jump and offers every event group for the selected gender', () => {
  render(<AthleteLookup />);
  const select = screen.getByLabelText('Event') as HTMLSelectElement;
  expect(select.value).toBe('high-jump');
  // 18 Track & Field groups per gender, across the three families.
  expect(select.querySelectorAll('option')).toHaveLength(18);
  expect(select.querySelectorAll('optgroup')).toHaveLength(3);
  expect(screen.getByRole('option', { name: '110mH' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: '100mH' })).not.toBeInTheDocument();
});

test('searching runs against the selected event group, not high jump', async () => {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: '100m' } });
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Jacobs' } });
  fireEvent.click(screen.getByText('Get ranking'));

  await screen.findByText(row.athlete, { selector: '.lookup-name' });
  expect(vi.mocked(fetchRanking).mock.calls.every(([slug]) => slug === '100m')).toBe(true);
  expect(screen.getByText('ITA · 100m')).toBeInTheDocument();
});

test('a result shows the event group its marks belong to, with no unit on a time', async () => {
  render(<AthleteLookup />);
  selectEvent('100m');
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Jacobs' } });
  fireEvent.click(screen.getByText('Get ranking'));

  await screen.findByText(row.athlete, { selector: '.lookup-name' });
  const meta = await screen.findByText(/9\.95/, { selector: '.comp-meta' });
  // A sprint time reads "9.95", never "9.95 m" (or "9.95 s").
  expect(meta.textContent).toContain('9.95');
  expect(meta.textContent).not.toContain('9.95 ');
});

test('shows the simulator for a track event, which the old gate blocked', async () => {
  // This used to assert the opposite: scoring_table.json held high jump alone, so every
  // other group got a "scoring table hasn't been loaded" message instead of a simulator.
  // src/data/scoring/ now covers all 36 groups, so the gate is gone.
  render(<AthleteLookup />);
  selectEvent('100m');
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Jacobs' } });
  fireEvent.click(screen.getByText('Get ranking'));

  await screen.findByText(row.athlete, { selector: '.lookup-name' });
  // The table is fetched on demand, so the simulator arrives a tick after the athlete.
  expect(await screen.findByText('Simulate a result')).toBeInTheDocument();
  expect(screen.queryByTestId('no-scoring-table')).not.toBeInTheDocument();
});

test('keeps the simulator for high jump, which does have a scoring table', async () => {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Jacobs' } });
  fireEvent.click(screen.getByText('Get ranking'));

  await screen.findByText(row.athlete, { selector: '.lookup-name' });
  expect(await screen.findByText('Simulate a result')).toBeInTheDocument();
});

test('switching gender carries the event over, mapping the hurdles to their counterpart', async () => {
  render(<AthleteLookup />);
  selectEvent('110mh');
  const select = screen.getByLabelText('Event') as HTMLSelectElement;
  expect(select.value).toBe('110mh');

  fireEvent.click(screen.getByLabelText('Gender'));

  await waitFor(() => expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('100mh'));
  expect(screen.getByRole('option', { name: '100mH' })).toBeInTheDocument();
});

test('changing the event clears the athlete already on screen', async () => {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Jacobs' } });
  fireEvent.click(screen.getByText('Get ranking'));
  await screen.findByText(row.athlete, { selector: '.lookup-name' });

  selectEvent('shot-put');

  await waitFor(() =>
    expect(screen.queryByText(row.athlete, { selector: '.lookup-name' })).not.toBeInTheDocument(),
  );
});
