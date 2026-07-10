import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * The Supabase client, or `null` when the env vars are absent. A null client
 * means "auth-disabled mode": the app runs as a public, client-only SPA and all
 * account features hide themselves. This keeps local dev and CI builds without
 * secrets from crashing.
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export const isAuthEnabled = supabase !== null;
