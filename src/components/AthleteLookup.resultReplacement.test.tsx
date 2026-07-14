import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import type { RankingRow, RankingCalculation, CountingResult } from '../data/rankingApi';
import type { AthleteResult } from '../data/athleteResultsApi';

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../hooks/FavoritesContext', () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggle: vi.fn(), loading: false }),
}));
vi.mock('../hooks/usePreferences', () => ({ usePreferences: () => ({ defaultGender: null }) }));
vi.mock('../data/rankingApi', async (orig) => ({
  ...(await orig<typeof import('../data/rankingApi')>()),
  fetchHighJumpRanking: vi.fn(),
  fetchRankingCalculation: vi.fn(),
}));
vi.mock('../data/birminghamApi', async (orig) => ({
  ...(await orig<typeof import('../data/birminghamApi')>()),
  // No Road to Birmingham data: keeps the athlete on the World window for this test.
  fetchRoadToBirmingham: vi.fn(async () => {
    throw new Error('no road');
  }),
}));
vi.mock('../data/athleteResultsApi', async (orig) => ({
  ...(await orig<typeof import('../data/athleteResultsApi')>()),
  fetchAthleteHighJumpResults: vi.fn(),
}));

import { AthleteLookup } from './AthleteLookup';
import { fetchHighJumpRanking, fetchRankingCalculation } from '../data/rankingApi';
import { fetchAthleteHighJumpResults } from '../data/athleteResultsApi';

const row: RankingRow = {
  id: 1,
  place: 1,
  worldPlace: 1,
  athlete: 'Oleh Doroshchuk',
  athleteUrlSlug: 'ukraine/oleh-doroshchuk-14803002',
  nationality: 'UKR',
  rankingScore: 1314,
  previousPlace: 1,
  previousRankingScore: 1314,
};

function counting(
  date: string,
  competition: string,
  category: string,
  place: string,
  mark: string,
  resultScore: number,
  placingScore: number,
): CountingResult {
  return {
    date, competition, discipline: 'High Jump', category, race: 'F', place, mark,
    resultScore, placingScore, performanceScore: resultScore + placingScore,
  };
}

const calc: RankingCalculation = {
  averagePerformanceScore: 1314,
  disciplineList: ['High Jump'],
  results: [
    counting('16 SEP 2025', 'World Championships, Tokyo', 'OW', '4.', '2.31', 1188, 190), // 1378
    counting('28 AUG 2025', 'Weltklasse Zürich', 'DF', '2.', '2.30', 1179, 150), // 1329
    counting('21 MAR 2026', 'World Indoor Champs, Toruń', 'GW', '1.', '2.30', 1179, 140), // 1319
    counting('22 AUG 2025', 'Memorial van Damme, Bruxelles', 'GW', '1.', '2.25', 1135, 140), // 1275
    counting('16 AUG 2025', 'Silesia Memorial, Chorzów', 'GW', '3.', '2.28', 1161, 110), // 1271
  ],
};

function ar(
  date: string,
  competition: string,
  category: string,
  race: string,
  place: string,
  mark: string,
  resultScore: number,
): AthleteResult {
  return {
    // Same competition (e.g. a qual and its final) shares a competitionId.
    date, competition, competitionId: competition, discipline: 'High Jump',
    category, race, place, mark, notLegal: false, resultScore,
  };
}

// The athlete's full HJ result list (2025-2026), including qualification rounds and
// out-of-window results the pool logic must exclude.
const fullResults: AthleteResult[] = [
  ar('08 MAR 2025', 'EuroIndoor Final', 'A', 'F', '1.', '2.34', 1215), // out of window (before start)
  ar('06 JUN 2025', 'Golden Gala, Roma', 'GW', 'F', '2.', '2.30', 1179), // out of window
  ar('16 AUG 2025', 'Silesia Memorial, Chorzów', 'GW', 'F', '3.', '2.28', 1161), // counting
  ar('22 AUG 2025', 'Memorial van Damme, Bruxelles', 'GW', 'F', '1.', '2.25', 1135), // counting
  ar('28 AUG 2025', 'Weltklasse Zürich', 'DF', 'F', '2.', '2.30', 1179), // counting
  ar('14 SEP 2025', 'World Championships, Tokyo', 'OW', 'Q1', '1.', '2.25', 1135), // qualification round
  ar('16 SEP 2025', 'World Championships, Tokyo', 'OW', 'F', '4.', '2.31', 1188), // counting
  ar('21 MAR 2026', 'World Indoor Champs, Toruń', 'GW', 'F', '1.', '2.30', 1179), // counting
  ar('19 JUN 2026', 'Doha Meeting - Diamond Discipline', 'GW', 'F', '3.', '2.24', 1126), // the 6th (1236)
  ar('10 JUL 2026', 'Herculis, Monaco', 'GW', 'F', '1.', '2.32', 1197), // out of window (after end)
];

beforeEach(() => {
  vi.mocked(fetchHighJumpRanking).mockReset().mockResolvedValue({ rankDate: '08 JUL 2026', rows: [row] });
  vi.mocked(fetchRankingCalculation).mockReset().mockResolvedValue(calc);
  vi.mocked(fetchAthleteHighJumpResults).mockReset().mockResolvedValue(fullResults);
});

async function lookup() {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByPlaceholderText('e.g. Tamberi'), { target: { value: 'Doroshchuk' } });
  fireEvent.click(screen.getByRole('button', { name: /get ranking/i }));
  await screen.findByText('Oleh Doroshchuk');
}

test('offers a remove control on each counting competition once results load', async () => {
  await lookup();
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /remove this competition/i })).toHaveLength(5),
  );
});

test('removing a counting competition slots in the next best and recomputes the ranking', async () => {
  await lookup();
  // Wait for the remove controls (results loaded), then remove Chorzów.
  await waitFor(() => expect(screen.getAllByRole('button', { name: /remove this competition/i })).toHaveLength(5));

  const chorzow = screen.getByText('Silesia Memorial, Chorzów').closest('.comp-item') as HTMLElement;
  fireEvent.click(within(chorzow).getByRole('button', { name: /remove this competition/i }));

  // The removed competition is greyed, the next best (Doha, 1236) slides in as a substitute.
  expect(chorzow.className).toContain('removed');
  const doha = await screen.findByText('Doha Meeting - Diamond Discipline');
  const dohaItem = doha.closest('.comp-item') as HTMLElement;
  expect(dohaItem.className).toContain('substitute');
  expect(within(dohaItem).getByText('1236')).toBeInTheDocument();

  // avg(1378,1329,1319,1275,1236) = 1307, down 7 from 1314.
  const summary = screen.getByTestId('recount-summary');
  expect(within(summary).getByText('1307')).toBeInTheDocument();
  expect(within(summary).getByText(/▼ 7/)).toBeInTheDocument();
});

test('reset restores the original counting set', async () => {
  await lookup();
  await waitFor(() => expect(screen.getAllByRole('button', { name: /remove this competition/i })).toHaveLength(5));
  const chorzow = screen.getByText('Silesia Memorial, Chorzów').closest('.comp-item') as HTMLElement;
  fireEvent.click(within(chorzow).getByRole('button', { name: /remove this competition/i }));

  expect(screen.getByTestId('recount-summary')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /reset/i }));

  expect(screen.queryByTestId('recount-summary')).not.toBeInTheDocument();
  expect(screen.queryByText('Doha Meeting - Diamond Discipline')).not.toBeInTheDocument();
});
