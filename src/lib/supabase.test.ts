import { expect, test } from 'vitest';
import { supabase, isAuthEnabled } from './supabase';

// In the test env VITE_SUPABASE_* are unset, so the client degrades to null.
test('supabase is null when env vars are absent', () => {
  expect(supabase).toBeNull();
});

test('isAuthEnabled reflects client presence', () => {
  expect(isAuthEnabled).toBe(false);
});
