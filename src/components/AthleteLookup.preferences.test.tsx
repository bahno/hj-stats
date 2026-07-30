import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';

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
  fetchRanking: vi.fn(async () => ({ rankDate: '26 JUL 2026', rows: [] })),
  fetchRankingCalculation: vi.fn(),
}));
vi.mock('../data/birminghamApi', async (orig) => ({
  ...(await orig<typeof import('../data/birminghamApi')>()),
  fetchRoadToBirmingham: vi.fn(async () => {
    throw new Error('Birmingham does not stage this event');
  }),
}));

import { AthleteLookup } from './AthleteLookup';

beforeEach(() => {
  prefs.defaultGender = null;
  prefs.defaultEvent = null;
  prefs.setDefaultEvent.mockClear();
});

test('opens on the saved event group, in the saved gender', async () => {
  prefs.defaultGender = 'women';
  prefs.defaultEvent = 'shot-put';
  render(<AthleteLookup />);

  await waitFor(() =>
    expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('shot-put'),
  );
  expect(screen.getByLabelText('Gender')).toHaveAttribute('aria-checked', 'true');
});

test('a saved event survives with no saved gender, staying on the default gender', async () => {
  prefs.defaultEvent = 'javelin-throw';
  render(<AthleteLookup />);

  await waitFor(() =>
    expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('javelin-throw'),
  );
  expect(screen.getByLabelText('Gender')).toHaveAttribute('aria-checked', 'false');
});

test('picking an event saves it as the new default', async () => {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'javelin-throw' } });

  await waitFor(() => expect(prefs.setDefaultEvent).toHaveBeenCalledWith('javelin-throw'));
});

test('switching gender saves the counterpart slug, not the one just left', async () => {
  render(<AthleteLookup />);
  fireEvent.change(screen.getByLabelText('Event'), { target: { value: '110mh' } });
  prefs.setDefaultEvent.mockClear();

  fireEvent.click(screen.getByLabelText('Gender'));

  // Men's 110mH maps to women's 100mH; saving '110mh' would resolve to nothing
  // on the next load.
  await waitFor(() => expect(prefs.setDefaultEvent).toHaveBeenCalledWith('100mh'));
});

test('falls back to high jump when the saved slug is not a real group', async () => {
  prefs.defaultEvent = 'quidditch';
  render(<AthleteLookup />);

  await waitFor(() =>
    expect((screen.getByLabelText('Event') as HTMLSelectElement).value).toBe('high-jump'),
  );
});
