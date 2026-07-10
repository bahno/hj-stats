# Auth & User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email+password accounts to hj-stats so users can save preferences (default gender) and favorite athletes across devices, via Supabase, without adding a server we run.

**Architecture:** The app stays a static React+TS+Vite SPA on GitHub Pages. Persistence goes through the Supabase JS SDK directly from the browser, guarded by Row-Level Security. Auth is additive: signed-out users keep every existing feature, and if Supabase env vars are absent the app runs in "auth-disabled" mode with auth UI hidden. Account deletion uses a Supabase Edge Function.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + @testing-library/react, `@supabase/supabase-js`, Supabase (Postgres + Auth + Edge Functions/Deno).

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-10-auth-user-management-design.md`.
- Branch: `feat/auth-user-management`.
- `Gender` type is `'men' | 'women'`, imported from `src/data/types.ts`.
- Vite `base` is `/hj-stats/`; tests run under jsdom with `globals: true` (no need to import `describe/test/expect`, but importing from `vitest` is also fine and used by existing tests).
- The Supabase anon key is browser-safe; never introduce the service-role key into client code (`src/`). The service-role key is used ONLY inside the Edge Function.
- Every persistence function must no-op or throw a clear error when `supabase` is `null` — never crash the public app.
- Follow existing style: small focused files, className-driven styling in `src/styles.css`, `data-testid` for test hooks where existing code uses them.

---

### Task 1: Supabase client, env typing, and config

**Files:**
- Modify: `package.json` (add `@supabase/supabase-js`)
- Create: `src/lib/supabase.ts`
- Modify: `src/vite-env.d.ts`
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `.github/workflows/deploy.yml:23-25` (the `npm run build` step)
- Test: `src/lib/supabase.test.ts`

**Interfaces:**
- Produces: `supabase: SupabaseClient | null` and `isAuthEnabled: boolean` from `src/lib/supabase.ts`.

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install @supabase/supabase-js
```
Expected: `package.json` gains `"@supabase/supabase-js"` under dependencies; `npm ci`-able lockfile updated.

- [ ] **Step 2: Add env var typing**

Replace `src/vite-env.d.ts` with:
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: Write the failing test**

Create `src/lib/supabase.test.ts`:
```ts
import { expect, test } from 'vitest';
import { supabase, isAuthEnabled } from './supabase';

// In the test env VITE_SUPABASE_* are unset, so the client degrades to null.
test('supabase is null when env vars are absent', () => {
  expect(supabase).toBeNull();
});

test('isAuthEnabled reflects client presence', () => {
  expect(isAuthEnabled).toBe(false);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- src/lib/supabase.test.ts`
Expected: FAIL — cannot resolve `./supabase`.

- [ ] **Step 5: Implement the client**

Create `src/lib/supabase.ts`:
```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- src/lib/supabase.test.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Add config files**

Create `.env.example`:
```
# Copy to .env.local and fill in from your Supabase project settings (Project → API).
# Both values are browser-safe (the anon key relies on Row-Level Security, not secrecy).
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Add to `.gitignore` (under the "OS / editor" section or a new "Env" section):
```
# Local env
.env.local
.env.*.local
```

- [ ] **Step 8: Wire env vars into the CI build**

In `.github/workflows/deploy.yml`, change the build step from:
```yaml
      - run: npm run build
```
to:
```yaml
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}
```
(These are GitHub Actions repo **Variables**, set later in the deployment checklist — not secrets, since the anon key is public.)

- [ ] **Step 9: Verify build still succeeds without env vars**

Run: `npm run build`
Expected: PASS (app builds; auth-disabled mode).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/lib/supabase.ts src/lib/supabase.test.ts src/vite-env.d.ts .env.example .gitignore .github/workflows/deploy.yml
git commit -m "feat: add Supabase client with auth-disabled fallback"
```

---

### Task 2: Database schema (migration + RLS)

**Files:**
- Create: `supabase/migrations/0001_init.sql`

This task has no vitest coverage — SQL correctness is verified by review and by running it against a Supabase project during deployment. Keep it a discrete, reviewable unit.

**Interfaces:**
- Produces: tables `profiles(id, display_name, default_gender, created_at)` and `favorites(id, user_id, athlete_slug, athlete_name, gender, created_at)`, both RLS-protected; a `handle_new_user` trigger that inserts a `profiles` row on signup.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0001_init.sql`:
```sql
-- Profiles: one row per user, holds preferences.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  default_gender text check (default_gender in ('men', 'women')),
  created_at timestamptz not null default now()
);

-- Favorites: starred athletes, identified by their World Athletics url slug.
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  athlete_slug text not null,
  athlete_name text not null,
  gender text not null check (gender in ('men', 'women')),
  created_at timestamptz not null default now(),
  unique (user_id, athlete_slug, gender)
);

-- Row-Level Security: users only ever see or touch their own rows.
alter table public.profiles enable row level security;
alter table public.favorites enable row level security;

create policy "own profile - select" on public.profiles
  for select using (auth.uid() = id);
create policy "own profile - update" on public.profiles
  for update using (auth.uid() = id);

create policy "own favorites - select" on public.favorites
  for select using (auth.uid() = user_id);
create policy "own favorites - insert" on public.favorites
  for insert with check (auth.uid() = user_id);
create policy "own favorites - delete" on public.favorites
  for delete using (auth.uid() = user_id);

-- Auto-create a profile row when a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Sanity-check the SQL locally (optional but recommended)**

If the Supabase CLI is available: `supabase db lint` or apply to a local stack. Otherwise verify by review against the design doc's data model table.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: add profiles and favorites schema with RLS"
```

---

### Task 3: Auth context and useAuth hook

**Files:**
- Create: `src/auth/AuthContext.tsx`
- Test: `src/auth/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.ts`.
- Produces:
  - `AuthProvider` (React component wrapping children).
  - `useAuth(): { session, user, loading, signIn, signUp, signOut }` where
    - `session: Session | null`, `user: User | null`, `loading: boolean`
    - `signIn(email: string, password: string): Promise<{ error: Error | null }>`
    - `signUp(email: string, password: string): Promise<{ error: Error | null; needsConfirmation: boolean }>`
    - `signOut(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/auth/AuthContext.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';

const { holder } = vi.hoisted(() => ({ holder: { current: null as any } }));
vi.mock('../lib/supabase', () => ({
  get supabase() {
    return holder.current;
  },
}));

import { AuthProvider, useAuth } from './AuthContext';

function Probe() {
  const { loading, user } = useAuth();
  return <div>{loading ? 'loading' : `user:${user?.email ?? 'none'}`}</div>;
}

beforeEach(() => {
  holder.current = null;
});

test('reports no user in auth-disabled mode (null client)', async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByText('user:none')).toBeInTheDocument());
});

test('seeds the user from an existing session', async () => {
  holder.current = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { email: 'a@b.com' } } },
        error: null,
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  };
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByText('user:a@b.com')).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/auth/AuthContext.test.tsx`
Expected: FAIL — cannot resolve `./AuthContext`.

- [ ] **Step 3: Implement the context**

Create `src/auth/AuthContext.tsx`:
```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ error: Error | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      async signIn(email, password) {
        if (!supabase) return { error: new Error('Sign-in is unavailable') };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error };
      },
      async signUp(email, password) {
        if (!supabase)
          return { error: new Error('Sign-up is unavailable'), needsConfirmation: false };
        const { data, error } = await supabase.auth.signUp({ email, password });
        // When email confirmation is on, Supabase returns a user with no session.
        return { error, needsConfirmation: !error && !data.session };
      },
      async signOut() {
        if (supabase) await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/auth/AuthContext.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/AuthContext.tsx src/auth/AuthContext.test.tsx
git commit -m "feat: add AuthProvider and useAuth"
```

---

### Task 4: User-data access layer

**Files:**
- Create: `src/test/supabaseMock.ts`
- Create: `src/data/userData.ts`
- Test: `src/data/userData.test.ts`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.ts`; `Gender` from `src/data/types.ts`.
- Produces:
  - `Profile { id: string; display_name: string | null; default_gender: Gender | null }`
  - `Favorite { id: string; athlete_slug: string; athlete_name: string; gender: Gender }`
  - `getProfile(userId): Promise<Profile | null>`
  - `updateProfile(userId, patch: Partial<Pick<Profile, 'display_name' | 'default_gender'>>): Promise<void>`
  - `listFavorites(userId): Promise<Favorite[]>`
  - `addFavorite(userId, { athlete_slug, athlete_name, gender }): Promise<Favorite>`
  - `removeFavorite(userId, slug, gender): Promise<void>`
- Also produces reusable test helper `mockSupabase(...)` in `src/test/supabaseMock.ts`.

- [ ] **Step 1: Write the reusable Supabase mock**

Create `src/test/supabaseMock.ts`:
```ts
import { vi } from 'vitest';

export interface QueryResult {
  data: unknown;
  error: unknown;
}

/**
 * A chainable, awaitable stand-in for a Supabase query builder. Every method
 * (`select`, `eq`, `order`, `insert`, `update`, `delete`, `single`,
 * `maybeSingle`, ...) returns the same proxy, and awaiting the proxy resolves to
 * the single configured result.
 */
function queryChain(result: QueryResult) {
  const promise = Promise.resolve(result);
  const proxy: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return promise.then.bind(promise);
        if (prop === 'catch') return promise.catch.bind(promise);
        if (prop === 'finally') return promise.finally.bind(promise);
        return () => proxy;
      },
    },
  );
  return proxy;
}

export interface MockOptions {
  /** Result returned for a `.from(table)` chain. */
  from?: (table: string) => QueryResult;
  auth?: Record<string, unknown>;
  functions?: Record<string, unknown>;
}

export function mockSupabase(opts: MockOptions = {}) {
  return {
    from: vi.fn((table: string) =>
      queryChain(opts.from ? opts.from(table) : { data: null, error: null }),
    ),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
      ...(opts.auth ?? {}),
    },
    functions: {
      invoke: vi.fn(async () => ({ data: {}, error: null })),
      ...(opts.functions ?? {}),
    },
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `src/data/userData.test.ts`:
```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/data/userData.test.ts`
Expected: FAIL — cannot resolve `./userData`.

- [ ] **Step 4: Implement the data layer**

Create `src/data/userData.ts`:
```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/data/userData.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 6: Commit**

```bash
git add src/test/supabaseMock.ts src/data/userData.ts src/data/userData.test.ts
git commit -m "feat: add user-data access layer for profiles and favorites"
```

---

### Task 5: Preferences and favorites hooks

**Files:**
- Create: `src/hooks/usePreferences.ts`
- Create: `src/hooks/useFavorites.ts`
- Test: `src/hooks/useFavorites.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3); `getProfile/updateProfile/listFavorites/addFavorite/removeFavorite` and `Favorite` (Task 4); `Gender` from `src/data/types.ts`.
- Produces:
  - `usePreferences(): { defaultGender: Gender | null; setDefaultGender(g: Gender): Promise<void>; loading: boolean }`
  - `useFavorites(): { favorites: Favorite[]; loading: boolean; isFavorite(slug, gender): boolean; toggle(fav: { athlete_slug; athlete_name; gender }): Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useFavorites.test.tsx`:
```tsx
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

import { useFavorites } from './useFavorites';

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
  render(<Probe />);
  await waitFor(() => expect(screen.getByText('count:1 fav:true')).toBeInTheDocument());
});

test('toggle adds a favorite optimistically', async () => {
  mocks.addFavorite.mockResolvedValue({
    id: 'f2',
    athlete_slug: 'tamberi',
    athlete_name: 'Tamberi',
    gender: 'men',
  });
  render(<Probe />);
  await waitFor(() => expect(screen.getByText('count:0 fav:false')).toBeInTheDocument());
  await act(async () => {
    await toggleFn({ athlete_slug: 'tamberi', athlete_name: 'Tamberi', gender: 'men' });
  });
  expect(screen.getByText('count:1 fav:true')).toBeInTheDocument();
  expect(mocks.addFavorite).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/hooks/useFavorites.test.tsx`
Expected: FAIL — cannot resolve `./useFavorites`.

- [ ] **Step 3: Write usePreferences**

Create `src/hooks/usePreferences.ts`:
```ts
import { useCallback, useEffect, useState } from 'react';
import type { Gender } from '../data/types';
import { useAuth } from '../auth/AuthContext';
import { getProfile, updateProfile } from '../data/userData';

export function usePreferences() {
  const { user } = useAuth();
  const [defaultGender, setGender] = useState<Gender | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setGender(null);
      return;
    }
    let active = true;
    setLoading(true);
    getProfile(user.id)
      .then((p) => {
        if (active) setGender(p?.default_gender ?? null);
      })
      .catch(() => {
        if (active) setGender(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const setDefaultGender = useCallback(
    async (g: Gender) => {
      if (!user) return;
      const prev = defaultGender;
      setGender(g); // optimistic
      try {
        await updateProfile(user.id, { default_gender: g });
      } catch (e) {
        setGender(prev); // rollback
        throw e;
      }
    },
    [user, defaultGender],
  );

  return { defaultGender, setDefaultGender, loading };
}
```

- [ ] **Step 4: Write useFavorites**

Create `src/hooks/useFavorites.ts`:
```ts
import { useCallback, useEffect, useState } from 'react';
import type { Gender } from '../data/types';
import { useAuth } from '../auth/AuthContext';
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  type Favorite,
} from '../data/userData';

type NewFavorite = { athlete_slug: string; athlete_name: string; gender: Gender };

export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setFavorites([]);
      return;
    }
    let active = true;
    setLoading(true);
    listFavorites(user.id)
      .then((rows) => {
        if (active) setFavorites(rows);
      })
      .catch(() => {
        if (active) setFavorites([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const isFavorite = useCallback(
    (slug: string, gender: Gender) =>
      favorites.some((f) => f.athlete_slug === slug && f.gender === gender),
    [favorites],
  );

  const toggle = useCallback(
    async (fav: NewFavorite) => {
      if (!user) return;
      const exists = favorites.find(
        (f) => f.athlete_slug === fav.athlete_slug && f.gender === fav.gender,
      );
      const prev = favorites;
      if (exists) {
        setFavorites((cur) => cur.filter((f) => f.id !== exists.id)); // optimistic
        try {
          await removeFavorite(user.id, fav.athlete_slug, fav.gender);
        } catch (e) {
          setFavorites(prev);
          throw e;
        }
      } else {
        try {
          const created = await addFavorite(user.id, fav);
          setFavorites((cur) => [created, ...cur]);
        } catch (e) {
          setFavorites(prev);
          throw e;
        }
      }
    },
    [user, favorites],
  );

  return { favorites, loading, isFavorite, toggle };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/hooks/useFavorites.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/usePreferences.ts src/hooks/useFavorites.ts src/hooks/useFavorites.test.tsx
git commit -m "feat: add usePreferences and useFavorites hooks"
```

---

### Task 6: Auth modal (login / signup)

**Files:**
- Create: `src/auth/AuthModal.tsx`
- Modify: `src/styles.css` (append auth-modal styles)
- Test: `src/auth/AuthModal.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3).
- Produces: `AuthModal({ onClose }: { onClose: () => void })` — a modal overlay with a login↔signup toggle.

- [ ] **Step 1: Write the failing test**

Create `src/auth/AuthModal.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ signIn: mocks.signIn, signUp: mocks.signUp }),
}));

import { AuthModal } from './AuthModal';

beforeEach(() => {
  mocks.signIn.mockReset().mockResolvedValue({ error: null });
  mocks.signUp.mockReset().mockResolvedValue({ error: null, needsConfirmation: true });
});

test('submits sign-in with entered credentials', async () => {
  const onClose = vi.fn();
  render(<AuthModal onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith('a@b.com', 'secret1'));
});

test('shows confirmation notice after sign-up', async () => {
  render(<AuthModal onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
  await waitFor(() =>
    expect(screen.getByText(/check your email/i)).toBeInTheDocument(),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/auth/AuthModal.test.tsx`
Expected: FAIL — cannot resolve `./AuthModal`.

- [ ] **Step 3: Implement the modal**

Create `src/auth/AuthModal.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext';

type Mode = 'signin' | 'signup';

export function AuthModal({ onClose }: { onClose: () => void }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmSent, setConfirmSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || password.length < 6) {
      setError('Enter an email and a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password);
        if (error) setError(error.message);
        else onClose();
      } else {
        const { error, needsConfirmation } = await signUp(email, password);
        if (error) setError(error.message);
        else if (needsConfirmation) setConfirmSent(true);
        else onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {confirmSent ? (
          <p className="auth-notice">
            Almost there — check your email to confirm your account, then sign in.
          </p>
        ) : (
          <form className="fields" onSubmit={submit}>
            <h2 className="auth-title">{mode === 'signin' ? 'Sign in' : 'Create account'}</h2>
            <label className="field">
              <span>Email</span>
              <input
                className="text-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="text-input"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <p className="lookup-msg">{error}</p>}
            <button className="lookup-btn" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
            <button
              type="button"
              className="auth-switch"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError('');
              }}
            >
              {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append modal styles**

Append to `src/styles.css`:
```css
/* --- Auth modal --- */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: grid;
  place-items: center;
  z-index: 100;
  padding: 1rem;
}
.modal {
  position: relative;
  width: min(24rem, 100%);
}
.modal-close {
  position: absolute;
  top: 0.5rem;
  right: 0.75rem;
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  color: inherit;
}
.auth-title {
  margin: 0 0 0.25rem;
  font-size: 1.1rem;
}
.auth-switch {
  background: none;
  border: none;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
  font-size: 0.85rem;
}
.auth-notice {
  margin: 0;
  line-height: 1.5;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/auth/AuthModal.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/auth/AuthModal.tsx src/auth/AuthModal.test.tsx src/styles.css
git commit -m "feat: add login/signup auth modal"
```

---

### Task 7: Edge Function for account deletion

**Files:**
- Create: `supabase/functions/delete-account/index.ts`

No vitest coverage (Deno runtime, deployed separately). Verified by review and by invoking against a deployed Supabase project during the deployment checklist.

**Interfaces:**
- Produces: an HTTP endpoint invocable via `supabase.functions.invoke('delete-account')` that deletes the calling user (cascades to `profiles`/`favorites`).

- [ ] **Step 1: Write the function**

Create `supabase/functions/delete-account/index.ts`:
```ts
// Supabase Edge Function (Deno). Deletes the authenticated user's auth record,
// which cascades to their profiles/favorites rows. Requires the caller's JWT.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Missing token' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const { error } = await admin.auth.admin.deleteUser(userData.user.id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/delete-account/index.ts
git commit -m "feat: add delete-account edge function"
```

---

### Task 8: Account page

**Files:**
- Create: `src/auth/AccountPage.tsx`
- Modify: `src/styles.css` (append account styles)
- Test: `src/auth/AccountPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3); `getProfile/updateProfile` (Task 4); `supabase` (for `functions.invoke` and `auth.updateUser`).
- Produces: `AccountPage()` — shows the user's email, editable display name, change-password field, sign-out, and delete-account.

- [ ] **Step 1: Write the failing test**

Create `src/auth/AccountPage.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.com' }, signOut: mocks.signOut }),
}));
vi.mock('../data/userData', () => ({
  getProfile: mocks.getProfile,
  updateProfile: mocks.updateProfile,
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth: {}, functions: {} } }));

import { AccountPage } from './AccountPage';

beforeEach(() => {
  mocks.signOut.mockReset();
  mocks.getProfile
    .mockReset()
    .mockResolvedValue({ id: 'u1', display_name: 'Gia', default_gender: 'men' });
  mocks.updateProfile.mockReset().mockResolvedValue(undefined);
});

test('shows the account email', async () => {
  render(<AccountPage />);
  await waitFor(() => expect(screen.getByText('a@b.com')).toBeInTheDocument());
});

test('saves an edited display name', async () => {
  render(<AccountPage />);
  await waitFor(() => expect(screen.getByDisplayValue('Gia')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Gianmarco' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() =>
    expect(mocks.updateProfile).toHaveBeenCalledWith('u1', { display_name: 'Gianmarco' }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/auth/AccountPage.test.tsx`
Expected: FAIL — cannot resolve `./AccountPage`.

- [ ] **Step 3: Implement the account page**

Create `src/auth/AccountPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getProfile, updateProfile } from '../data/userData';
import { supabase } from '../lib/supabase';

export function AccountPage() {
  const { user, signOut } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then((p) => setDisplayName(p?.display_name ?? ''));
  }, [user]);

  if (!user) return <section className="card account">Please sign in.</section>;

  async function saveProfile() {
    setMessage('');
    try {
      await updateProfile(user!.id, { display_name: displayName.trim() || null });
      setMessage('Profile saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed.');
    }
  }

  async function changePassword() {
    setMessage('');
    if (newPassword.length < 6) {
      setMessage('Password must be at least 6 characters.');
      return;
    }
    const { error } = await supabase!.auth.updateUser({ password: newPassword });
    setMessage(error ? error.message : 'Password updated.');
    if (!error) setNewPassword('');
  }

  async function deleteAccount() {
    if (!window.confirm('Permanently delete your account and saved data?')) return;
    const { error } = await supabase!.functions.invoke('delete-account');
    if (error) {
      setMessage(error.message);
      return;
    }
    await signOut();
  }

  return (
    <section className="card account">
      <h2 className="auth-title">Account</h2>
      <div className="account-email muted">{user.email}</div>

      <label className="field">
        <span>Display name</span>
        <input
          className="text-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <button className="lookup-btn" type="button" onClick={saveProfile}>
        Save profile
      </button>

      <label className="field">
        <span>New password</span>
        <input
          className="text-input"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </label>
      <button className="lookup-btn" type="button" onClick={changePassword}>
        Change password
      </button>

      {message && <p className="lookup-msg">{message}</p>}

      <div className="account-actions">
        <button type="button" className="auth-switch" onClick={() => signOut()}>
          Sign out
        </button>
        <button type="button" className="account-delete" onClick={deleteAccount}>
          Delete account
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Append account styles**

Append to `src/styles.css`:
```css
/* --- Account page --- */
.account {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.account-email {
  font-size: 0.9rem;
}
.account-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 0.5rem;
}
.account-delete {
  background: none;
  border: none;
  color: #c0392b;
  text-decoration: underline;
  cursor: pointer;
  font-size: 0.85rem;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/auth/AccountPage.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/auth/AccountPage.tsx src/auth/AccountPage.test.tsx src/styles.css
git commit -m "feat: add self-service account page"
```

---

### Task 9: Wire auth into Nav and App

**Files:**
- Modify: `src/components/Nav.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css` (append nav-account styles)
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `AuthProvider`, `useAuth` (Task 3); `AuthModal` (Task 6); `AccountPage` (Task 8).
- Produces: `App` renders inside `AuthProvider`; Nav shows a "Sign in" button (signed out) or a name button opening the account view (signed in); a new `'account'` view.

- [ ] **Step 1: Extend Nav with an account slot**

Replace `src/components/Nav.tsx`:
```tsx
import type { ReactNode } from 'react';

export type View = 'calculator' | 'rankings' | 'account';

const TABS: { id: View; label: string }[] = [
  { id: 'calculator', label: 'Calculator' },
  { id: 'rankings', label: 'Rankings' },
];

export function Nav({
  value,
  onChange,
  account,
}: {
  value: View;
  onChange: (v: View) => void;
  account: ReactNode;
}) {
  return (
    <nav className="nav" role="tablist" aria-label="View">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={value === t.id ? 'active' : ''}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
      <div className="nav-account">{account}</div>
    </nav>
  );
}
```

- [ ] **Step 2: Wire App with auth-aware account slot**

Replace `src/App.tsx`:
```tsx
import { useState } from 'react';
import { Calculator } from './components/Calculator';
import { AthleteLookup } from './components/AthleteLookup';
import { Nav, type View } from './components/Nav';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthModal } from './auth/AuthModal';
import { AccountPage } from './auth/AccountPage';
import { isAuthEnabled } from './lib/supabase';

function AccountSlot({
  onOpenAccount,
  onSignIn,
}: {
  onOpenAccount: () => void;
  onSignIn: () => void;
}) {
  const { user } = useAuth();
  if (!isAuthEnabled) return null;
  if (user) {
    return (
      <button type="button" className="nav-account-btn" onClick={onOpenAccount}>
        {user.email}
      </button>
    );
  }
  return (
    <button type="button" className="nav-account-btn" onClick={onSignIn}>
      Sign in
    </button>
  );
}

function Shell() {
  const [view, setView] = useState<View>('calculator');
  const [showAuth, setShowAuth] = useState(false);

  const body =
    view === 'calculator' ? (
      <Calculator />
    ) : view === 'rankings' ? (
      <AthleteLookup />
    ) : (
      <AccountPage />
    );

  return (
    <main className="app">
      <Nav
        value={view}
        onChange={setView}
        account={
          <AccountSlot
            onOpenAccount={() => setView('account')}
            onSignIn={() => setShowAuth(true)}
          />
        }
      />
      {body}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Confirm main.tsx renders App (usually no change needed)**

Read `src/main.tsx`; it should render `<App />`. No edit unless it wraps App in something conflicting. (Listed as "modify" only in case a provider import is desired there instead; prefer keeping AuthProvider in App.)

- [ ] **Step 4: Write the failing test**

Create `src/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

// Auth-disabled mode: null client → no account UI, public app still renders.
vi.mock('./lib/supabase', () => ({ supabase: null, isAuthEnabled: false }));

import App from './App';

test('renders the calculator and hides account UI when auth is disabled', () => {
  render(<App />);
  expect(screen.getByText('Calculator')).toBeInTheDocument();
  expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/App.test.tsx`
Expected: PASS.

- [ ] **Step 6: Append nav-account styles**

Append to `src/styles.css`:
```css
/* --- Nav account slot --- */
.nav-account {
  margin-left: auto;
}
.nav-account-btn {
  background: none;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  color: inherit;
  font-size: 0.85rem;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS (all tests, including existing ones).

- [ ] **Step 8: Commit**

```bash
git add src/components/Nav.tsx src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: wire auth modal and account view into the app shell"
```

---

### Task 10: Favorite athletes in AthleteLookup

**Files:**
- Modify: `src/components/AthleteLookup.tsx`
- Modify: `src/styles.css` (append favorites styles)
- Test: `src/components/AthleteLookup.favorites.test.tsx`

**Interfaces:**
- Consumes: `useFavorites` (Task 5); `useAuth` (Task 3); existing `RankingRow` (has `athleteUrlSlug`, `athlete`).
- Produces: a ★ toggle on the result header (and candidate rows) and a "Favorites" strip that re-runs the lookup for a saved athlete.

- [ ] **Step 1: Add a FavoriteStar and favorites strip to AthleteLookup**

In `src/components/AthleteLookup.tsx`:

1. Add imports at the top:
```tsx
import { useFavorites } from '../hooks/useFavorites';
import { useAuth } from '../auth/AuthContext';
```

2. Add a small star component at the bottom of the file:
```tsx
function FavoriteStar({
  slug,
  name,
  gender,
  onNeedSignIn,
}: {
  slug: string;
  name: string;
  gender: Gender;
  onNeedSignIn: () => void;
}) {
  const { user } = useAuth();
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(slug, gender);
  return (
    <button
      type="button"
      className={`fav-star ${active ? 'on' : ''}`}
      aria-pressed={active}
      aria-label={active ? 'Remove favorite' : 'Add favorite'}
      onClick={() => {
        if (!user) return onNeedSignIn();
        void toggle({ athlete_slug: slug, athlete_name: name, gender }).catch(() => {});
      }}
    >
      {active ? '★' : '☆'}
    </button>
  );
}
```

3. In the `AthleteLookup` component, pull in favorites and a sign-in signal. Add near the other hooks:
```tsx
  const { user } = useAuth();
  const { favorites } = useFavorites();
  const [needSignIn, setNeedSignIn] = useState(false);
```

4. Render a favorites strip above the form (only when signed in and non-empty). Insert right after the opening `<section ...>`:
```tsx
      {user && favorites.length > 0 && (
        <div className="fav-strip">
          {favorites.map((f) => (
            <button
              key={f.id}
              type="button"
              className="fav-chip"
              onClick={() => {
                setGender(f.gender);
                setQuery(f.athlete_name);
              }}
            >
              ★ {f.athlete_name}
            </button>
          ))}
        </div>
      )}
      {needSignIn && (
        <p className="lookup-msg">Sign in to save favorites.</p>
      )}
```

5. In the `Result` component, thread a `slug`/`gender` star into the header. Change the `lookup-head` block to include the star:
```tsx
      <div className="lookup-head">
        <div className="lookup-name">{row.athlete}</div>
        <div className="muted">{row.nationality} · High Jump</div>
        <FavoriteStar
          slug={row.athleteUrlSlug}
          name={row.athlete}
          gender={gender}
          onNeedSignIn={() => {}}
        />
      </div>
```
(Note: `Result` receives `found` which includes `gender` and `row`. The header star uses `onNeedSignIn={() => {}}` because the strip-level message covers the signed-out case; alternatively lift `setNeedSignIn` via props — keep the no-op to avoid prop drilling for v1.)

6. Wire `setNeedSignIn(true)` when a signed-out user clicks a candidate star. On candidate rows, add a star next to each candidate button inside the `candidates.map`:
```tsx
          <li key={c.id}>
            <button type="button" onClick={() => select(c)}>
              <span>{c.athlete}</span>
              <span className="muted">
                {c.nationality} · #<span className={placeClass(c.place)}>{c.place}</span> EU
              </span>
            </button>
            <FavoriteStar
              slug={c.athleteUrlSlug}
              name={c.athlete}
              gender={gender}
              onNeedSignIn={() => setNeedSignIn(true)}
            />
          </li>
```

- [ ] **Step 2: Write the test**

Create `src/components/AthleteLookup.favorites.test.tsx`:
```tsx
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
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- src/components/AthleteLookup.favorites.test.tsx`
Expected: PASS.

- [ ] **Step 4: Append favorites styles**

Append to `src/styles.css`:
```css
/* --- Favorites --- */
.fav-star {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  color: #e0a800;
  line-height: 1;
}
.fav-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}
.fav-chip {
  background: none;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
  color: inherit;
  font-size: 0.8rem;
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/AthleteLookup.tsx src/components/AthleteLookup.favorites.test.tsx src/styles.css
git commit -m "feat: add favorite athletes to the lookup view"
```

---

### Task 11: Apply default-gender preference

**Files:**
- Modify: `src/components/Calculator.tsx`
- Modify: `src/components/AthleteLookup.tsx`
- Test: `src/components/Calculator.preferences.test.tsx`

**Interfaces:**
- Consumes: `usePreferences` (Task 5).
- Produces: when signed in with a saved `default_gender`, Calculator and AthleteLookup open on that gender; changing gender in the Calculator persists it as the new default.

- [ ] **Step 1: Apply preference in Calculator**

In `src/components/Calculator.tsx`:

1. Add import:
```tsx
import { usePreferences } from '../hooks/usePreferences';
import { useEffect } from 'react';
```
(Extend the existing `react` import to include `useEffect` rather than adding a duplicate line: `import { useEffect, useMemo, useState } from 'react';`.)

2. Inside `Calculator`, after the existing state, add:
```tsx
  const { defaultGender, setDefaultGender } = usePreferences();

  // Adopt the saved preference once it loads (only if the user hasn't overridden).
  useEffect(() => {
    if (defaultGender && defaultGender !== gender) {
      setGender(defaultGender);
      setHeight(defaultHeightFor(scoringTable, defaultGender));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultGender]);
```

3. Change `handleGender` to persist:
```tsx
  function handleGender(next: Gender) {
    setGender(next);
    setHeight(defaultHeightFor(scoringTable, next));
    void setDefaultGender(next).catch(() => {});
  }
```

- [ ] **Step 2: Apply preference in AthleteLookup**

In `src/components/AthleteLookup.tsx`, add (near the other hooks added in Task 10):
```tsx
  const { defaultGender } = usePreferences();
  useEffect(() => {
    if (defaultGender) setGender(defaultGender);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultGender]);
```
Add `useEffect` to the existing `react` import and `import { usePreferences } from '../hooks/usePreferences';`.

- [ ] **Step 3: Write the test**

Create `src/components/Calculator.preferences.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('../hooks/usePreferences', () => ({
  usePreferences: () => ({
    defaultGender: 'women',
    setDefaultGender: vi.fn().mockResolvedValue(undefined),
    loading: false,
  }),
}));

import { Calculator } from './Calculator';

test('opens on the saved default gender', async () => {
  render(<Calculator />);
  // The women's gender switch is checked when the preference is applied.
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Gender' })).toHaveAttribute(
      'aria-checked',
      'true',
    ),
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/Calculator.preferences.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run build`
Expected: PASS (tests) and a clean TypeScript build.

- [ ] **Step 6: Commit**

```bash
git add src/components/Calculator.tsx src/components/AthleteLookup.tsx src/components/Calculator.preferences.test.tsx
git commit -m "feat: apply saved default-gender preference"
```

---

## Deployment checklist (manual, outside the code)

These steps light up the feature in production. Until they're done, the app runs in auth-disabled mode (public-only), which is the safe default.

1. **Create a Supabase project** (free tier). Note the Project URL and anon key (Project → Settings → API).
2. **Run the schema:** paste `supabase/migrations/0001_init.sql` into the SQL Editor and run it.
3. **Auth settings:** enable Email provider; keep "Confirm email" on. Add Redirect URLs: `https://bahno.github.io/hj-stats/` and `http://localhost:5173`.
4. **Deploy the Edge Function:** `supabase functions deploy delete-account` (the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars are provided to functions automatically).
5. **GitHub Actions Variables:** repo → Settings → Secrets and variables → Actions → Variables tab → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
6. **Local dev:** `cp .env.example .env.local` and fill in the same two values.
7. Push to `main` (or merge the branch) → the deploy workflow bakes the vars into the build.

---

## Final verification

- [ ] `npm test` — all suites pass.
- [ ] `npm run build` — clean TypeScript + Vite build.
- [ ] Manual smoke (with a real Supabase project configured in `.env.local`, `npm run dev`): sign up → confirm email → sign in → star an athlete → reload (favorite persists) → change gender in Calculator → reload (opens on that gender) → change display name → change password → sign out → sign in → delete account.
