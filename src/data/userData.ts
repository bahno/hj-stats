import { supabase } from '../lib/supabase';
import type { Gender } from './types';

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
    .select('id, athlete_slug, athlete_name, gender')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Favorite[] | null) ?? [];
}

export async function addFavorite(
  userId: string,
  fav: { athlete_slug: string; athlete_name: string; gender: Gender },
): Promise<Favorite> {
  if (!supabase) throw new Error('Auth is not configured');
  const { data, error } = await supabase
    .from('favorites')
    .insert({ user_id: userId, ...fav })
    .select('id, athlete_slug, athlete_name, gender')
    .single();
  if (error) throw error;
  return data as Favorite;
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
