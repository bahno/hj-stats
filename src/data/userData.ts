import { supabase } from '../lib/supabase';
import type { Gender, NotifyPrefs, NotificationSettings } from './types';
import { DEFAULT_NOTIFY_PREFS } from './types';

export interface Profile {
  id: string;
  default_gender: Gender | null;
  // An event group's ranking API slug. Gender-neutral, so it is resolved
  // against default_gender at read time.
  default_event: string | null;
}

export interface Favorite {
  id: string;
  athlete_slug: string;
  athlete_name: string;
  gender: Gender;
  /** The event groups this athlete is followed in, as ranking API slugs. A
   *  favorite is one person; this says which of their disciplines to report on. */
  event_groups: string[];
  notify_prefs: NotifyPrefs;
}

const FAVORITE_COLUMNS = 'id, athlete_slug, athlete_name, gender, event_groups, notify_prefs';

export async function getProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, default_gender, default_event')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, 'default_gender' | 'default_event'>>,
): Promise<void> {
  if (!supabase) throw new Error('Auth is not configured');
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

export async function listFavorites(userId: string): Promise<Favorite[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('favorites')
    .select(FAVORITE_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as Favorite[] | null) ?? []).map(normalizeFavorite);
}

export async function addFavorite(
  userId: string,
  fav: { athlete_slug: string; athlete_name: string; gender: Gender; event_groups: string[] },
): Promise<Favorite> {
  if (!supabase) throw new Error('Auth is not configured');
  const { data, error } = await supabase
    .from('favorites')
    .insert({ user_id: userId, ...fav })
    .select(FAVORITE_COLUMNS)
    .single();
  if (error) throw error;
  return normalizeFavorite(data as Favorite);
}

/** Rows written before a column existed come back null; the callers all treat
 *  these as plain values, so fill them in once here rather than everywhere. */
function normalizeFavorite(f: Favorite): Favorite {
  return {
    ...f,
    event_groups: f.event_groups ?? [],
    notify_prefs: { ...DEFAULT_NOTIFY_PREFS, ...(f.notify_prefs ?? {}) },
  };
}

export async function removeFavorite(
  userId: string,
  slug: string,
  gender: Gender,
): Promise<void> {
  if (!supabase) throw new Error('Auth is not configured');
  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('user_id', userId)
    .eq('athlete_slug', slug)
    .eq('gender', gender);
  if (error) throw error;
}

export async function getNotificationSettings(
  userId: string,
): Promise<NotificationSettings | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('notification_settings')
    .select('email_enabled, unsubscribe_token')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as NotificationSettings | null) ?? null;
}

/**
 * Upsert rather than update: the row is normally created by the handle_new_user
 * trigger, but if that ever failed the user would otherwise have no settings row
 * and no way to make one. Upserting lets the client heal itself (the matching
 * INSERT policy pins the row to auth.uid()).
 */
export async function updateNotificationSettings(
  userId: string,
  patch: Partial<Pick<NotificationSettings, 'email_enabled'>>,
): Promise<void> {
  if (!supabase) throw new Error('Auth is not configured');
  const { error } = await supabase
    .from('notification_settings')
    .upsert(
      { user_id: userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
}

export async function updateFavoriteNotifyPrefs(
  userId: string,
  slug: string,
  gender: Gender,
  prefs: NotifyPrefs,
): Promise<void> {
  await patchFavorite(userId, slug, gender, { notify_prefs: prefs });
}

export async function updateFavoriteEventGroups(
  userId: string,
  slug: string,
  gender: Gender,
  groups: string[],
): Promise<void> {
  await patchFavorite(userId, slug, gender, { event_groups: groups });
}

/** An empty result means the row is missing or RLS refused it — both are
 *  failures the caller must see, since PostgREST reports neither as an error. */
async function patchFavorite(
  userId: string,
  slug: string,
  gender: Gender,
  patch: Partial<Pick<Favorite, 'notify_prefs' | 'event_groups'>>,
): Promise<void> {
  if (!supabase) throw new Error('Auth is not configured');
  const { data, error } = await supabase
    .from('favorites')
    .update(patch)
    .eq('user_id', userId)
    .eq('athlete_slug', slug)
    .eq('gender', gender)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Favorite not found or not updatable');
  }
}

export { DEFAULT_NOTIFY_PREFS } from './types';
export type { NotifyPrefs, NotificationSettings } from './types';
