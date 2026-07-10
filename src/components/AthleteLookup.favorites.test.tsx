import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { current: { id: 'u1' } as { id: string } | null },
  favorites: { current: [] as any[] },
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));
vi.mock('../hooks/useFavorites', () => ({
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
}));

import { AthleteLookup } from './AthleteLookup';

beforeEach(() => {
  mocks.user.current = { id: 'u1' };
  mocks.favorites.current = [
    { id: 'f1', athlete_slug: 'tamberi', athlete_name: 'Gianmarco Tamberi', gender: 'men' },
  ];
});

test('shows a favorites strip for signed-in users', async () => {
  render(<AthleteLookup />);
  await waitFor(() =>
    expect(screen.getByText('★ Gianmarco Tamberi')).toBeInTheDocument(),
  );
});
