import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { expect, test, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { current: { id: 'u1' } as { id: string } | null },
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));
vi.mock('../data/userData', () => ({
  listFavorites: mocks.listFavorites,
  addFavorite: mocks.addFavorite,
  removeFavorite: mocks.removeFavorite,
}));

import { FavoritesProvider, useFavorites } from './FavoritesContext';

let toggleFn: (f: any) => Promise<void>;
function Probe() {
  const { favorites, isFavorite, toggle } = useFavorites();
  toggleFn = toggle;
  return (
    <div>
      count:{favorites.length} fav:{String(isFavorite('tamberi', 'men'))}
    </div>
  );
}

beforeEach(() => {
  mocks.user.current = { id: 'u1' };
  mocks.listFavorites.mockReset().mockResolvedValue([]);
  mocks.addFavorite.mockReset();
  mocks.removeFavorite.mockReset();
});

test('loads favorites for the signed-in user', async () => {
  mocks.listFavorites.mockResolvedValue([
    { id: 'f1', athlete_slug: 'tamberi', athlete_name: 'Tamberi', gender: 'men' },
  ]);
  render(
    <FavoritesProvider>
      <Probe />
    </FavoritesProvider>,
  );
  await waitFor(() => expect(screen.getByText('count:1 fav:true')).toBeInTheDocument());
});

test('toggle adds a favorite optimistically', async () => {
  mocks.addFavorite.mockResolvedValue({
    id: 'f2',
    athlete_slug: 'tamberi',
    athlete_name: 'Tamberi',
    gender: 'men',
  });
  render(
    <FavoritesProvider>
      <Probe />
    </FavoritesProvider>,
  );
  await waitFor(() => expect(screen.getByText('count:0 fav:false')).toBeInTheDocument());
  await act(async () => {
    await toggleFn({ athlete_slug: 'tamberi', athlete_name: 'Tamberi', gender: 'men' });
  });
  expect(screen.getByText('count:1 fav:true')).toBeInTheDocument();
  expect(mocks.addFavorite).toHaveBeenCalledOnce();
});
