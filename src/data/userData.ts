import { supabase } from '../lib/supabase';
import type { Gender, NotifyPrefs, NotificationSettings } from './types';
import { DEFAULT_NOTIFY_PREFS } from './types';

export interface Profile {
  id: string;
  display_name: string | null;
  default_gender: Gender | null;
}

export interface Favorite {
  id: string;
  athlete_slug: string;
  athlete_name: string;
  gender: Gender;
  notify_prefs: NotifyPrefs;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, default_gender')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, 'display_name' | 'default_gender'>>,
): Promise<void> {
  if (!supabase) throw new Error('Auth is not configured');
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

export async function listFavorites(userId: string): Promise<Favorite[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('favorites')
    .select('id, athlete_slug, athlete_name, gender, notify_prefs')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as Favorite[] | null) ?? []).map((f) => ({
    ...f,
    notify_prefs: { ...DEFAULT_NOTIFY_PREFS, ...(f.notify_prefs ?? {}) },
  }));
}

export async function addFavorite(
  userId: string,
  fav: { athlete_slug: string; athlete_name: string; gender: Gender },
): Promise<Favorite> {
  if (!supabase) throw new Error('Auth is not configured');
  const { data, error } = await supabase
    .from('favorites')
    .insert({ user_id: userId, ...fav })
    .select('id, athlete_slug, athlete_name, gender, notify_prefs')
    .single();
  if (error) throw error;
  const row = data as Favorite;
  return { ...row, notify_prefs: { ...DEFAULT_NOTIFY_PREFS, ...(row.notify_prefs ?? {}) } };
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

export async function updateNotificationSettings(
  userId: string,
  patch: Partial<Pick<NotificationSettings, 'email_enabled'>>,
): Promise<void> {
  if (!supabase) throw new Error('Auth is not configured');
  const { error } = await supabase
    .from('notification_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function updateFavoriteNotifyPrefs(
  userId: string,
  slug: string,
  gender: Gender,
  prefs: NotifyPrefs,
): Promise<void> {
  if (!supabase) throw new Error('Auth is not configured');
  const { data, error } = await supabase
    .from('favorites')
    .update({ notify_prefs: prefs })
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
