import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase } from '../test/supabaseMock';

vi.mock('../lib/supabase', () => ({ supabase: null as unknown }));
import * as supa from '../lib/supabase';
import {
  getNotificationSettings,
  updateNotificationSettings,
  updateFavoriteNotifyPrefs,
  listFavorites,
  addFavorite,
  DEFAULT_NOTIFY_PREFS,
} from './userData';

beforeEach(() => {
  (supa as { supabase: unknown }).supabase = null;
});

describe('notification settings data layer', () => {
  it('returns null settings when supabase is not configured', async () => {
    expect(await getNotificationSettings('u1')).toBeNull();
  });

  it('reads settings row', async () => {
    (supa as { supabase: unknown }).supabase = mockSupabase({
      from: () => ({
        data: { email_enabled: true, unsubscribe_token: 'tok-1' },
        error: null,
      }),
    });
    const s = await getNotificationSettings('u1');
    expect(s).toEqual({ email_enabled: true, unsubscribe_token: 'tok-1' });
  });

  it('throws when updating settings without supabase', async () => {
    await expect(updateNotificationSettings('u1', { email_enabled: true })).rejects.toThrow();
  });

  it('throws when updating favorite prefs without supabase', async () => {
    await expect(
      updateFavoriteNotifyPrefs('u1', 'slug', 'men', {
        place: true,
        score: false,
        result: true,
        qualification: true,
      }),
    ).rejects.toThrow();
  });

  it('updateFavoriteNotifyPrefs resolves when the update affects a row', async () => {
    (supa as { supabase: unknown }).supabase = mockSupabase({
      from: () => ({
        data: [{ id: 'f1' }],
        error: null,
      }),
    });
    await expect(
      updateFavoriteNotifyPrefs('u1', 'slug', 'men', {
        place: true,
        score: false,
        result: true,
        qualification: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('updateFavoriteNotifyPrefs throws when the update affects no rows (RLS blocked)', async () => {
    (supa as { supabase: unknown }).supabase = mockSupabase({
      from: () => ({
        data: [],
        error: null,
      }),
    });
    await expect(
      updateFavoriteNotifyPrefs('u1', 'slug', 'men', {
        place: true,
        score: false,
        result: true,
        qualification: true,
      }),
    ).rejects.toThrow('Favorite not found or not updatable');
  });

  it('listFavorites returns notify_prefs from the row', async () => {
    (supa as { supabase: unknown }).supabase = mockSupabase({
      from: () => ({
        data: [
          {
            id: 'f1',
            athlete_slug: 's',
            athlete_name: 'A',
            gender: 'men',
            notify_prefs: { place: true, score: true, result: false, qualification: true },
          },
        ],
        error: null,
      }),
    });
    const rows = await listFavorites('u1');
    expect(rows[0].notify_prefs.result).toBe(false);
  });

  it('listFavorites defaults notify_prefs to all-true when the row value is null', async () => {
    (supa as { supabase: unknown }).supabase = mockSupabase({
      from: () => ({
        data: [
          {
            id: 'f1',
            athlete_slug: 's',
            athlete_name: 'A',
            gender: 'men',
            notify_prefs: null,
          },
        ],
        error: null,
      }),
    });
    const rows = await listFavorites('u1');
    expect(rows[0].notify_prefs).toEqual({
      place: true,
      score: true,
      result: true,
      qualification: true,
    });
  });

  it('listFavorites merges a partial notify_prefs over the defaults', async () => {
    (supa as { supabase: unknown }).supabase = mockSupabase({
      from: () => ({
        data: [
          {
            id: 'f1',
            athlete_slug: 's',
            athlete_name: 'A',
            gender: 'men',
            notify_prefs: { result: false },
          },
        ],
        error: null,
      }),
    });
    const rows = await listFavorites('u1');
    expect(rows[0].notify_prefs).toEqual({
      place: true,
      score: true,
      result: false,
      qualification: true,
    });
  });

  it('addFavorite merges a null notify_prefs on the insert-return row over the defaults', async () => {
    (supa as { supabase: unknown }).supabase = mockSupabase({
      from: () => ({
        data: {
          id: 'f2',
          athlete_slug: 's2',
          athlete_name: 'B',
          gender: 'women',
          notify_prefs: null,
        },
        error: null,
      }),
    });
    const fav = await addFavorite('u1', { athlete_slug: 's2', athlete_name: 'B', gender: 'women' });
    expect(fav.notify_prefs).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(fav.notify_prefs).toEqual({
      place: true,
      score: true,
      result: true,
      qualification: true,
    });
  });

  it('addFavorite merges a partial notify_prefs on the insert-return row over the defaults', async () => {
    (supa as { supabase: unknown }).supabase = mockSupabase({
      from: () => ({
        data: {
          id: 'f3',
          athlete_slug: 's3',
          athlete_name: 'C',
          gender: 'men',
          notify_prefs: { qualification: false },
        },
        error: null,
      }),
    });
    const fav = await addFavorite('u1', { athlete_slug: 's3', athlete_name: 'C', gender: 'men' });
    expect(fav.notify_prefs).toEqual({
      place: true,
      score: true,
      result: true,
      qualification: false,
    });
  });
});
