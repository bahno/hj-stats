import { expect, test, vi, beforeEach } from 'vitest';
import { mockSupabase } from '../test/supabaseMock';

const { holder } = vi.hoisted(() => ({ holder: { current: null as any } }));
vi.mock('../lib/supabase', () => ({
  get supabase() {
    return holder.current;
  },
}));

import { getProfile, listFavorites, addFavorite } from './userData';

beforeEach(() => {
  holder.current = null;
});

test('getProfile returns null in auth-disabled mode', async () => {
  expect(await getProfile('u1')).toBeNull();
});

test('getProfile returns the row', async () => {
  holder.current = mockSupabase({
    from: () => ({
      data: { id: 'u1', display_name: 'Gia', default_gender: 'men' },
      error: null,
    }),
  });
  expect(await getProfile('u1')).toEqual({
    id: 'u1',
    display_name: 'Gia',
    default_gender: 'men',
  });
});

test('listFavorites returns [] when data is null', async () => {
  holder.current = mockSupabase({ from: () => ({ data: null, error: null }) });
  expect(await listFavorites('u1')).toEqual([]);
});

test('addFavorite throws on error', async () => {
  holder.current = mockSupabase({
    from: () => ({ data: null, error: { message: 'duplicate' } }),
  });
  await expect(
    addFavorite('u1', { athlete_slug: 'x', athlete_name: 'X', gender: 'men' }),
  ).rejects.toBeTruthy();
});
