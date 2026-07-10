import { afterEach, expect, test, vi } from 'vitest';

// The client is decided at module-eval time from import.meta.env, so we stub the
// env and re-import a fresh module per case. This keeps the test deterministic
// whether or not a local .env.local defines VITE_SUPABASE_* on the machine.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('supabase is null (auth-disabled mode) when env vars are absent', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
  vi.resetModules();
  const { supabase, isAuthEnabled } = await import('./supabase');
  expect(supabase).toBeNull();
  expect(isAuthEnabled).toBe(false);
});

test('supabase client is created when env vars are present', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  vi.resetModules();
  const { supabase, isAuthEnabled } = await import('./supabase');
  expect(supabase).not.toBeNull();
  expect(isAuthEnabled).toBe(true);
});
