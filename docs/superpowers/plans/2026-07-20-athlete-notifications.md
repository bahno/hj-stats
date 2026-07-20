# Athlete Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email opted-in users about changes to their favorited high-jumpers — new results (checked daily) and ranking place/score/qualification changes (checked weekly, the day EA publishes) — with per-athlete, per-trigger control.

**Architecture:** A single daily Supabase-Cron edge function (`notify-poll`) fetches each favorited athlete's current data from the European Athletics API, diffs it against a stored per-athlete snapshot, and emails per-user digests via Resend. Ranking diffs only fire the first day a new `rankDate` is observed (self-correcting "day after publish"). Pure diff/format logic lives in `_shared/detectors.ts` and is unit-tested with vitest; the edge function is thin I/O orchestration. A token-based `notify-unsubscribe` function powers the one-click unsubscribe link.

**Tech Stack:** React 18 + TypeScript + Vite (frontend), Supabase (Postgres + RLS + Deno edge functions + Cron), Resend (email), vitest + React Testing Library (tests).

## Global Constraints

- Email is **opt-in**: `notification_settings.email_enabled` defaults to **false**. Never email a user who has not opted in.
- Every email includes a working one-click **unsubscribe** link (token-based, no auth).
- **No double-sends:** `notification_deliveries` has `unique(user_id, kind, period)`; the poller checks it before sending.
- `ranking_snapshots` and `notification_deliveries` are **service-role only** — RLS enabled, zero anon/auth policies. The client never reads them.
- Snapshots are **per-athlete, global** (one row per `(athlete_slug, gender)`), shared across all users who favorite that athlete.
- EA API is undocumented — every per-athlete fetch/detector runs in isolation; a failure skips that trigger for that athlete and is logged, never failing the run or other users' digests.
- Frontend must keep working when `supabase` is `null` (auth not configured) — mirror the existing null-guards in `src/data/userData.ts`.
- Gender is always `'men' | 'women'`. Default `notify_prefs` is `{place:true, score:true, result:true, qualification:true}`.
- Match existing code style: 2-space indent, single quotes, no semicolon-free lines (semicolons used), named exports.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0002_notifications.sql`

**Interfaces:**
- Produces (schema consumed by every later task):
  - `notification_settings(user_id uuid pk, email_enabled bool, unsubscribe_token uuid, last_results_date text, last_ranking_week text, created_at, updated_at)`
  - `favorites.notify_prefs jsonb` (new column)
  - `ranking_snapshots(athlete_slug text, gender text, rank_date text, world_place int, european_place int, ranking_score numeric, results jsonb, qualification jsonb, captured_at)` pk `(athlete_slug, gender)`
  - `notification_deliveries(id uuid pk, user_id uuid, kind text, period text, sent_at, status text, error text, summary jsonb)` unique `(user_id, kind, period)`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0002_notifications.sql`:

```sql
-- Per-user notification settings. Opt-in: email_enabled defaults false.
create table public.notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_enabled boolean not null default false,
  unsubscribe_token uuid not null default gen_random_uuid(),
  last_results_date text,        -- ISO date of last daily results digest sent
  last_ranking_week text,        -- rankDate of last weekly ranking digest sent
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-athlete, per-trigger opt-out lives on the favorite itself.
alter table public.favorites
  add column notify_prefs jsonb not null
  default '{"place":true,"score":true,"result":true,"qualification":true}'::jsonb;

-- Latest known ranking state per athlete (global; shared across users).
create table public.ranking_snapshots (
  athlete_slug text not null,
  gender text not null check (gender in ('men', 'women')),
  rank_date text,
  world_place int,
  european_place int,
  ranking_score numeric,
  results jsonb not null default '[]'::jsonb,
  qualification jsonb,
  captured_at timestamptz not null default now(),
  primary key (athlete_slug, gender)
);

-- Delivery log for idempotency + audit.
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('results', 'ranking')),
  period text not null,
  sent_at timestamptz not null default now(),
  status text not null default 'sent',
  error text,
  summary jsonb,
  unique (user_id, kind, period)
);

-- RLS. Users own their settings; snapshots + deliveries are service-role only.
alter table public.notification_settings enable row level security;
alter table public.ranking_snapshots enable row level security;
alter table public.notification_deliveries enable row level security;

create policy "own notification_settings - select" on public.notification_settings
  for select using (auth.uid() = user_id);
create policy "own notification_settings - update" on public.notification_settings
  for update using (auth.uid() = user_id);
-- No policies on ranking_snapshots / notification_deliveries: service role bypasses RLS,
-- so anon/auth clients get zero access (deny-by-default).

-- Auto-create a settings row for every new user, alongside the existing profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.notification_settings (user_id) values (new.id);
  return new;
end;
$$;

-- Backfill settings rows for users who signed up before this migration.
insert into public.notification_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;
```

- [ ] **Step 2: Validate the SQL**

If the Supabase CLI is available locally, run:
`supabase db reset` (applies all migrations to the local shadow DB).
Expected: completes with no error; `notification_settings`, `ranking_snapshots`, `notification_deliveries` created and `favorites.notify_prefs` present.

If the CLI is not available, review against `supabase/migrations/0001_init.sql` for consistency: confirm the `handle_new_user()` redefinition preserves the original `profiles` insert, all three tables have RLS enabled, and only `notification_settings` has owner policies.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_notifications.sql
git commit -m "feat: notifications schema (settings, snapshots, deliveries, notify_prefs)"
```

---

### Task 2: Data layer — settings & favorite prefs

**Files:**
- Modify: `src/data/types.ts` (add notification types)
- Modify: `src/data/userData.ts` (add functions; extend `Favorite`)
- Create: `src/data/notifications.test.ts`

**Interfaces:**
- Consumes: `supabase` from `../lib/supabase`; `mockSupabase` from `../test/supabaseMock`.
- Produces:
  - `type NotifyPrefs = { place: boolean; score: boolean; result: boolean; qualification: boolean }`
  - `interface NotificationSettings { email_enabled: boolean; unsubscribe_token: string }`
  - `interface Favorite { id; athlete_slug; athlete_name; gender; notify_prefs: NotifyPrefs }`
  - `getNotificationSettings(userId: string): Promise<NotificationSettings | null>`
  - `updateNotificationSettings(userId: string, patch: Partial<Pick<NotificationSettings,'email_enabled'>>): Promise<void>`
  - `updateFavoriteNotifyPrefs(userId: string, slug: string, gender: Gender, prefs: NotifyPrefs): Promise<void>`
  - `DEFAULT_NOTIFY_PREFS: NotifyPrefs`

- [ ] **Step 1: Add types to `src/data/types.ts`**

Append:

```typescript
export type NotifyPrefs = {
  place: boolean;
  score: boolean;
  result: boolean;
  qualification: boolean;
};

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  place: true,
  score: true,
  result: true,
  qualification: true,
};

export interface NotificationSettings {
  email_enabled: boolean;
  unsubscribe_token: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/data/notifications.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase } from '../test/supabaseMock';

vi.mock('../lib/supabase', () => ({ supabase: null as unknown }));
import * as supa from '../lib/supabase';
import {
  getNotificationSettings,
  updateNotificationSettings,
  updateFavoriteNotifyPrefs,
  listFavorites,
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- src/data/notifications.test.ts`
Expected: FAIL — `getNotificationSettings is not a function` / `notify_prefs` undefined.

- [ ] **Step 4: Implement in `src/data/userData.ts`**

Update imports and the `Favorite` interface, and append the new functions:

```typescript
import { supabase } from '../lib/supabase';
import type { Gender, NotifyPrefs, NotificationSettings } from './types';
import { DEFAULT_NOTIFY_PREFS } from './types';

export interface Favorite {
  id: string;
  athlete_slug: string;
  athlete_name: string;
  gender: Gender;
  notify_prefs: NotifyPrefs;
}
```

Change `listFavorites` to select and normalise `notify_prefs`:

```typescript
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
```

Update `addFavorite`'s select to include `notify_prefs` and normalise the return:

```typescript
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
```

Append the new functions:

```typescript
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
  const { error } = await supabase
    .from('favorites')
    .update({ notify_prefs: prefs })
    .eq('user_id', userId)
    .eq('athlete_slug', slug)
    .eq('gender', gender);
  if (error) throw error;
}
```

Re-export the default for consumers:

```typescript
export { DEFAULT_NOTIFY_PREFS } from './types';
export type { NotifyPrefs, NotificationSettings } from './types';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- src/data/notifications.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite to check nothing broke**

Run: `npm run test -- src/data`
Expected: PASS. If `userData.test.ts` asserts the old `Favorite` shape, update those expectations to include `notify_prefs`.

- [ ] **Step 7: Commit**

```bash
git add src/data/types.ts src/data/userData.ts src/data/notifications.test.ts
git commit -m "feat: data layer for notification settings and favorite prefs"
```

---

### Task 3: FavoritesContext round-trips prefs

**Files:**
- Modify: `src/hooks/FavoritesContext.tsx`
- Create: `src/hooks/useFavoritesPrefs.test.tsx`

**Interfaces:**
- Consumes: `Favorite`, `updateFavoriteNotifyPrefs`, `NotifyPrefs` from `../data/userData`.
- Produces: `FavoritesValue.updatePrefs(slug: string, gender: Gender, prefs: NotifyPrefs): Promise<void>` — optimistic update of `favorites[i].notify_prefs`, persisted via `updateFavoriteNotifyPrefs`, rolled back on error.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useFavoritesPrefs.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listFavorites = vi.fn();
const updateFavoriteNotifyPrefs = vi.fn();
vi.mock('../data/userData', () => ({
  listFavorites: (...a: unknown[]) => listFavorites(...a),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  updateFavoriteNotifyPrefs: (...a: unknown[]) => updateFavoriteNotifyPrefs(...a),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import { FavoritesProvider, useFavorites } from './FavoritesContext';

function Probe() {
  const { favorites, updatePrefs } = useFavorites();
  const f = favorites[0];
  return (
    <div>
      <span data-testid="result-pref">{f ? String(f.notify_prefs.result) : 'none'}</span>
      {f && (
        <button
          onClick={() =>
            updatePrefs(f.athlete_slug, f.gender, { ...f.notify_prefs, result: false })
          }
        >
          toggle
        </button>
      )}
    </div>
  );
}

beforeEach(() => {
  listFavorites.mockResolvedValue([
    {
      id: 'f1',
      athlete_slug: 's',
      athlete_name: 'A',
      gender: 'men',
      notify_prefs: { place: true, score: true, result: true, qualification: true },
    },
  ]);
  updateFavoriteNotifyPrefs.mockResolvedValue(undefined);
});

describe('FavoritesContext.updatePrefs', () => {
  it('optimistically updates the favorite and persists', async () => {
    render(
      <FavoritesProvider>
        <Probe />
      </FavoritesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('result-pref').textContent).toBe('true'));
    await userEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('result-pref').textContent).toBe('false');
    expect(updateFavoriteNotifyPrefs).toHaveBeenCalledWith('u1', 's', 'men', {
      place: true,
      score: true,
      result: false,
      qualification: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/hooks/useFavoritesPrefs.test.tsx`
Expected: FAIL — `updatePrefs is not a function`.

- [ ] **Step 3: Implement in `src/hooks/FavoritesContext.tsx`**

Add to imports:

```tsx
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  updateFavoriteNotifyPrefs,
  type Favorite,
} from '../data/userData';
import type { NotifyPrefs } from '../data/types';
```

Extend the interface:

```tsx
interface FavoritesValue {
  favorites: Favorite[];
  loading: boolean;
  isFavorite: (slug: string, gender: Gender) => boolean;
  toggle: (fav: NewFavorite) => Promise<void>;
  updatePrefs: (slug: string, gender: Gender, prefs: NotifyPrefs) => Promise<void>;
}
```

Add the callback (place it next to `toggle`, before the `useMemo`):

```tsx
const updatePrefs = useCallback(
  async (slug: string, gender: Gender, prefs: NotifyPrefs) => {
    if (!user) return;
    const prev = favorites;
    setFavorites((cur) =>
      cur.map((f) =>
        f.athlete_slug === slug && f.gender === gender ? { ...f, notify_prefs: prefs } : f,
      ),
    );
    try {
      await updateFavoriteNotifyPrefs(user.id, slug, gender, prefs);
    } catch (e) {
      setFavorites(prev);
      throw e;
    }
  },
  [user, favorites],
);
```

Include it in the memoised value:

```tsx
const value = useMemo<FavoritesValue>(
  () => ({ favorites, loading, isFavorite, toggle, updatePrefs }),
  [favorites, loading, isFavorite, toggle, updatePrefs],
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/hooks/useFavoritesPrefs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run related suites**

Run: `npm run test -- src/hooks`
Expected: PASS (existing `useFavorites.test.tsx` still green).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/FavoritesContext.tsx src/hooks/useFavoritesPrefs.test.tsx
git commit -m "feat: FavoritesContext.updatePrefs for per-athlete notify prefs"
```

---

### Task 4: Pure detectors & digest builders

**Files:**
- Create: `supabase/functions/_shared/detectors.ts`
- Create: `supabase/functions/_shared/detectors.test.ts`

Note: vitest's default include globs pick up `**/*.test.ts` project-wide, so this test runs with the normal `npm run test`. `detectors.ts` is pure TS with no Deno imports, so it imports cleanly under Node.

**Interfaces:**
- Produces:
  - `type Gender = 'men' | 'women'`
  - `interface ResultItem { date: string; competition: string; mark: string }`
  - `interface QualificationState { qualified: boolean; place: number | null; target: number | null }`
  - `interface RankingState { rankDate: string; worldPlace: number | null; europeanPlace: number | null; rankingScore: number | null; results: ResultItem[]; qualification: QualificationState | null }`
  - `interface Snapshot { rank_date: string | null; world_place: number | null; european_place: number | null; ranking_score: number | null; results: ResultItem[]; qualification: QualificationState | null }`
  - `interface NotifyPrefs { place: boolean; score: boolean; result: boolean; qualification: boolean }`
  - `resultKey(r: ResultItem): string`
  - `diffResults(prev: ResultItem[], curr: ResultItem[]): ResultItem[]`
  - `diffPlace(prev: Snapshot, curr: RankingState): PlaceChange[]`
  - `diffScore(prev: Snapshot, curr: RankingState): ScoreChange | null`
  - `diffQualification(prev: Snapshot, curr: RankingState): QualChange | null`
  - `interface AthleteEvents { slug: string; name: string; gender: Gender; results: ResultItem[]; place: PlaceChange[]; score: ScoreChange | null; qualification: QualChange | null }`
  - `filterByPrefs(ev: AthleteEvents, prefs: NotifyPrefs): AthleteEvents`
  - `buildResultsDigest(userName: string, events: AthleteEvents[]): EmailPayload | null`
  - `buildRankingDigest(userName: string, events: AthleteEvents[]): EmailPayload | null`
  - `interface EmailPayload { subject: string; html: string; text: string }`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/detectors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  diffResults,
  diffPlace,
  diffScore,
  diffQualification,
  filterByPrefs,
  buildResultsDigest,
  buildRankingDigest,
  type Snapshot,
  type RankingState,
  type AthleteEvents,
} from './detectors';

const emptySnap: Snapshot = {
  rank_date: null,
  world_place: null,
  european_place: null,
  ranking_score: null,
  results: [],
  qualification: null,
};

const curr = (over: Partial<RankingState> = {}): RankingState => ({
  rankDate: '07 JUL 2026',
  worldPlace: 10,
  europeanPlace: 3,
  rankingScore: 1234,
  results: [],
  qualification: null,
  ...over,
});

describe('diffResults', () => {
  it('treats every current result as new when prev is empty (caller seeds on first run)', () => {
    // diffResults is pure: with no prior results, all current results are "new".
    // The first-run seeding policy lives in the poller (Task 7), which skips
    // notifications when the snapshot did not previously exist.
    const out = diffResults([], [{ date: '2026-07-05', competition: 'X', mark: '2.30' }]);
    expect(out).toHaveLength(1);
  });

  it('returns only new results by key', () => {
    const prev = [{ date: '2026-07-05', competition: 'X', mark: '2.30' }];
    const now = [
      { date: '2026-07-05', competition: 'X', mark: '2.30' },
      { date: '2026-07-12', competition: 'Y', mark: '2.28' },
    ];
    const out = diffResults(prev, now);
    expect(out).toEqual([{ date: '2026-07-12', competition: 'Y', mark: '2.28' }]);
  });
});

describe('diffPlace', () => {
  it('detects an improvement (lower number = up)', () => {
    const out = diffPlace({ ...emptySnap, european_place: 5, world_place: 12 }, curr());
    expect(out).toEqual([
      { scope: 'european', from: 5, to: 3, direction: 'up' },
      { scope: 'world', from: 12, to: 10, direction: 'up' },
    ]);
  });

  it('returns [] when unchanged', () => {
    const out = diffPlace({ ...emptySnap, european_place: 3, world_place: 10 }, curr());
    expect(out).toEqual([]);
  });
});

describe('diffScore', () => {
  it('detects a score change with delta', () => {
    const out = diffScore({ ...emptySnap, ranking_score: 1200 }, curr());
    expect(out).toEqual({ from: 1200, to: 1234, delta: 34 });
  });
  it('null when unchanged', () => {
    expect(diffScore({ ...emptySnap, ranking_score: 1234 }, curr())).toBeNull();
  });
});

describe('diffQualification', () => {
  it('detects entering the quota', () => {
    const out = diffQualification(
      { ...emptySnap, qualification: { qualified: false, place: 40, target: 32 } },
      curr({ qualification: { qualified: true, place: 30, target: 32 } }),
    );
    expect(out).toEqual({ from: false, to: true, place: 30, target: 32 });
  });
  it('null when qualified state unchanged', () => {
    const out = diffQualification(
      { ...emptySnap, qualification: { qualified: true, place: 30, target: 32 } },
      curr({ qualification: { qualified: true, place: 29, target: 32 } }),
    );
    expect(out).toBeNull();
  });
});

describe('filterByPrefs', () => {
  const ev: AthleteEvents = {
    slug: 's',
    name: 'A',
    gender: 'men',
    results: [{ date: '2026-07-12', competition: 'Y', mark: '2.28' }],
    place: [{ scope: 'european', from: 5, to: 3, direction: 'up' }],
    score: { from: 1200, to: 1234, delta: 34 },
    qualification: null,
  };
  it('drops trigger types the user disabled', () => {
    const out = filterByPrefs(ev, { place: false, score: true, result: true, qualification: true });
    expect(out.place).toEqual([]);
    expect(out.score).not.toBeNull();
    expect(out.results).toHaveLength(1);
  });
});

describe('digest builders', () => {
  const withResults: AthleteEvents = {
    slug: 's',
    name: 'Ada Jumper',
    gender: 'men',
    results: [{ date: '2026-07-12', competition: 'Rome GP', mark: '2.30' }],
    place: [],
    score: null,
    qualification: null,
  };
  it('buildResultsDigest returns null when no athlete has results', () => {
    expect(buildResultsDigest('Sam', [{ ...withResults, results: [] }])).toBeNull();
  });
  it('buildResultsDigest includes athlete name and mark', () => {
    const out = buildResultsDigest('Sam', [withResults]);
    expect(out).not.toBeNull();
    expect(out!.text).toContain('Ada Jumper');
    expect(out!.text).toContain('2.30');
    expect(out!.html).toContain('Ada Jumper');
  });
  it('buildRankingDigest returns null when no ranking changes', () => {
    expect(buildRankingDigest('Sam', [withResults])).toBeNull();
  });
  it('buildRankingDigest summarises a place move', () => {
    const out = buildRankingDigest('Sam', [
      { ...withResults, results: [], place: [{ scope: 'european', from: 5, to: 3, direction: 'up' }] },
    ]);
    expect(out).not.toBeNull();
    expect(out!.text).toContain('European');
    expect(out!.text).toContain('3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- supabase/functions/_shared/detectors.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement `supabase/functions/_shared/detectors.ts`**

```typescript
// Pure diff + digest logic for athlete notifications. No IO, no Deno APIs —
// unit-tested with vitest and imported by the notify-poll edge function.

export type Gender = 'men' | 'women';

export interface ResultItem {
  date: string;
  competition: string;
  mark: string;
}

export interface QualificationState {
  qualified: boolean;
  place: number | null;
  target: number | null;
}

export interface RankingState {
  rankDate: string;
  worldPlace: number | null;
  europeanPlace: number | null;
  rankingScore: number | null;
  results: ResultItem[];
  qualification: QualificationState | null;
}

export interface Snapshot {
  rank_date: string | null;
  world_place: number | null;
  european_place: number | null;
  ranking_score: number | null;
  results: ResultItem[];
  qualification: QualificationState | null;
}

export interface NotifyPrefs {
  place: boolean;
  score: boolean;
  result: boolean;
  qualification: boolean;
}

export interface PlaceChange {
  scope: 'world' | 'european';
  from: number | null;
  to: number | null;
  direction: 'up' | 'down';
}

export interface ScoreChange {
  from: number | null;
  to: number | null;
  delta: number;
}

export interface QualChange {
  from: boolean;
  to: boolean;
  place: number | null;
  target: number | null;
}

export interface AthleteEvents {
  slug: string;
  name: string;
  gender: Gender;
  results: ResultItem[];
  place: PlaceChange[];
  score: ScoreChange | null;
  qualification: QualChange | null;
}

export interface EmailPayload {
  subject: string;
  html: string;
  text: string;
}

export function resultKey(r: ResultItem): string {
  return `${r.date}|${r.competition}|${r.mark}`;
}

export function diffResults(prev: ResultItem[], curr: ResultItem[]): ResultItem[] {
  const seen = new Set(prev.map(resultKey));
  return curr.filter((r) => !seen.has(resultKey(r)));
}

function placeChange(
  scope: 'world' | 'european',
  from: number | null,
  to: number | null,
): PlaceChange | null {
  if (to == null || from == null || from === to) return null;
  return { scope, from, to, direction: to < from ? 'up' : 'down' };
}

export function diffPlace(prev: Snapshot, curr: RankingState): PlaceChange[] {
  const out: PlaceChange[] = [];
  const eu = placeChange('european', prev.european_place, curr.europeanPlace);
  if (eu) out.push(eu);
  const w = placeChange('world', prev.world_place, curr.worldPlace);
  if (w) out.push(w);
  return out;
}

export function diffScore(prev: Snapshot, curr: RankingState): ScoreChange | null {
  const to = curr.rankingScore;
  const from = prev.ranking_score;
  if (to == null || from == null || from === to) return null;
  return { from, to, delta: Math.round((to - from) * 100) / 100 };
}

export function diffQualification(prev: Snapshot, curr: RankingState): QualChange | null {
  const now = curr.qualification;
  const was = prev.qualification;
  if (!now || !was) return null;
  if (now.qualified === was.qualified) return null;
  return { from: was.qualified, to: now.qualified, place: now.place, target: now.target };
}

export function filterByPrefs(ev: AthleteEvents, prefs: NotifyPrefs): AthleteEvents {
  return {
    ...ev,
    results: prefs.result ? ev.results : [],
    place: prefs.place ? ev.place : [],
    score: prefs.score ? ev.score : null,
    qualification: prefs.qualification ? ev.qualification : null,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

const CAP: Record<'world' | 'european', string> = { world: 'World', european: 'European' };

export function buildResultsDigest(userName: string, events: AthleteEvents[]): EmailPayload | null {
  const withResults = events.filter((e) => e.results.length > 0);
  if (withResults.length === 0) return null;

  const lines: string[] = [];
  const htmlItems: string[] = [];
  for (const e of withResults) {
    for (const r of e.results) {
      lines.push(`- ${e.name}: ${r.mark} at ${r.competition} (${r.date})`);
      htmlItems.push(
        `<li><strong>${esc(e.name)}</strong>: ${esc(r.mark)} at ${esc(r.competition)} <em>(${esc(r.date)})</em></li>`,
      );
    }
  }
  const text = `Hi ${userName},\n\nNew results from athletes you follow:\n\n${lines.join('\n')}`;
  const html = `<p>Hi ${esc(userName)},</p><p>New results from athletes you follow:</p><ul>${htmlItems.join('')}</ul>`;
  return { subject: `New results: ${withResults.length} of your athletes competed`, html, text };
}

export function buildRankingDigest(userName: string, events: AthleteEvents[]): EmailPayload | null {
  const lines: string[] = [];
  const htmlItems: string[] = [];

  for (const e of events) {
    const parts: string[] = [];
    for (const p of e.place) {
      parts.push(`${CAP[p.scope]} rank ${p.from} → ${p.to} (${p.direction})`);
    }
    if (e.score) parts.push(`score ${e.score.from} → ${e.score.to} (${e.score.delta >= 0 ? '+' : ''}${e.score.delta})`);
    if (e.qualification) {
      parts.push(e.qualification.to ? 'now inside the qualification quota' : 'dropped out of the qualification quota');
    }
    if (parts.length === 0) continue;
    lines.push(`- ${e.name}: ${parts.join('; ')}`);
    htmlItems.push(`<li><strong>${esc(e.name)}</strong>: ${esc(parts.join('; '))}</li>`);
  }

  if (lines.length === 0) return null;
  const text = `Hi ${userName},\n\nRanking updates for athletes you follow:\n\n${lines.join('\n')}`;
  const html = `<p>Hi ${esc(userName)},</p><p>Ranking updates for athletes you follow:</p><ul>${htmlItems.join('')}</ul>`;
  return { subject: `Ranking update: ${lines.length} of your athletes moved`, html, text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- supabase/functions/_shared/detectors.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/detectors.ts supabase/functions/_shared/detectors.test.ts
git commit -m "feat: pure notification detectors and digest builders"
```

---

### Task 5: EA API client for Deno (with pure parsers)

**Files:**
- Create: `supabase/functions/_shared/ea.ts`
- Create: `supabase/functions/_shared/ea.test.ts`

**Interfaces:**
- Consumes: `RankingState`, `ResultItem`, `QualificationState`, `Gender` from `./detectors`.
- Produces:
  - `parseResults(profile: unknown): ResultItem[]` (pure)
  - `type RoadToLite = { entryNumber: number | null; qualifications: Array<{ urlSlug: string; qualified: boolean; qualificationPosition: number | null }> }`
  - `parseRoadTo(raw: unknown): RoadToLite` (pure)
  - `qualificationFor(road: RoadToLite | null, slug: string): QualificationState | null` (pure)
  - `buildRankingState(row: RankingRowLite, rankDate: string, results: ResultItem[], qual: QualificationState | null): RankingState` (pure)
  - `fetchRoadTo(gender: Gender, deps?: FetchDeps): Promise<RoadToLite>` (IO)
  - `fetchAthleteState(slug: string, gender: Gender, deps?: FetchDeps, roadTo?: RoadToLite | null): Promise<RankingState | null>` (IO; `deps.fetchJson` injectable for tests; `roadTo` pre-fetched per gender by the poller)
  - `type RankingRowLite = { europeanPlace: number | null; worldPlace: number | null; rankingScore: number | null; calculationId: number | null }`

Reuses the verified endpoint already mapped in `src/data/birminghamApi.ts`:
`worldAthletics.getCompetitionQualifyingSystem` (competitionId 7192415 = Road to Birmingham 2026; eventId 10229615 men / 10229526 women). Each entry carries `competitor.urlSlug` (matches the ranking slug), `qualified`, and `qualificationPosition`.

- [ ] **Step 1: Write the failing test (pure parsers only)**

Create `supabase/functions/_shared/ea.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseResults, buildRankingState, parseRoadTo, qualificationFor } from './ea';

describe('parseResults', () => {
  it('maps a profile results-by-year structure into flat ResultItem[]', () => {
    const profile = {
      resultsByYear: {
        activeYear: 2026,
        resultsByEvent: [
          {
            discipline: 'High Jump',
            results: [
              { date: '12 JUL 2026', competition: 'Rome GP', mark: '2.30' },
              { date: '05 JUL 2026', competition: 'Oslo', mark: '2.28' },
            ],
          },
        ],
      },
    };
    const out = parseResults(profile);
    expect(out).toEqual([
      { date: '12 JUL 2026', competition: 'Rome GP', mark: '2.30' },
      { date: '05 JUL 2026', competition: 'Oslo', mark: '2.28' },
    ]);
  });

  it('returns [] for an unexpected shape', () => {
    expect(parseResults(null)).toEqual([]);
    expect(parseResults({})).toEqual([]);
  });
});

describe('buildRankingState', () => {
  it('assembles a RankingState', () => {
    const s = buildRankingState(
      { europeanPlace: 3, worldPlace: 10, rankingScore: 1234, calculationId: 999 },
      '12 JUL 2026',
      [{ date: '12 JUL 2026', competition: 'Rome GP', mark: '2.30' }],
      { qualified: true, place: 30, target: 32 },
    );
    expect(s.rankDate).toBe('12 JUL 2026');
    expect(s.europeanPlace).toBe(3);
    expect(s.results).toHaveLength(1);
    expect(s.qualification?.qualified).toBe(true);
  });
});

describe('parseRoadTo', () => {
  it('reduces the qualifying-system response to slug/qualified/position', () => {
    const raw = {
      entryNumber: 30,
      qualifications: [
        {
          qualified: true,
          qualificationPosition: 12,
          competitor: { urlSlug: 'italy/gianmarco-tamberi-14375750' },
        },
        {
          qualified: false,
          qualificationPosition: null,
          competitor: { urlSlug: 'ukraine/oleh-doroshchuk-14803002' },
        },
      ],
    };
    const out = parseRoadTo(raw);
    expect(out.entryNumber).toBe(30);
    expect(out.qualifications).toEqual([
      { urlSlug: 'italy/gianmarco-tamberi-14375750', qualified: true, qualificationPosition: 12 },
      { urlSlug: 'ukraine/oleh-doroshchuk-14803002', qualified: false, qualificationPosition: null },
    ]);
  });

  it('returns an empty structure for an unexpected shape', () => {
    expect(parseRoadTo(null)).toEqual({ entryNumber: null, qualifications: [] });
  });
});

describe('qualificationFor', () => {
  const road = {
    entryNumber: 30,
    qualifications: [
      { urlSlug: 'a', qualified: true, qualificationPosition: 12 },
      { urlSlug: 'b', qualified: false, qualificationPosition: null },
    ],
  };
  it('maps a matched entry to QualificationState (target = entryNumber)', () => {
    expect(qualificationFor(road, 'a')).toEqual({ qualified: true, place: 12, target: 30 });
    expect(qualificationFor(road, 'b')).toEqual({ qualified: false, place: null, target: 30 });
  });
  it('returns null when the athlete is not in the system, or road is null', () => {
    expect(qualificationFor(road, 'zzz')).toBeNull();
    expect(qualificationFor(null, 'a')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- supabase/functions/_shared/ea.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `supabase/functions/_shared/ea.ts`**

```typescript
// European Athletics API client for the notify-poll edge function.
// Mirrors src/data/rankingApi.ts but runs under Deno and adds a per-athlete
// state assembler. Pure parsers are split out so they are unit-testable.
import type {
  Gender,
  RankingState,
  ResultItem,
  QualificationState,
} from './detectors.ts';

const EA_TRPC = 'https://api.european-athletics.com/trpc';

export type RankingRowLite = {
  europeanPlace: number | null;
  worldPlace: number | null;
  rankingScore: number | null;
  calculationId: number | null;
};

export type RoadToLite = {
  entryNumber: number | null;
  qualifications: Array<{ urlSlug: string; qualified: boolean; qualificationPosition: number | null }>;
};

// Road to Birmingham 2026 (2026 European Athletics Championships). Same IDs as
// src/data/birminghamApi.ts, verified 2026-07-11.
const BIRMINGHAM_COMPETITION_ID = 7192415;
const HIGH_JUMP_EVENT_ID: Record<Gender, number> = { men: 10229615, women: 10229526 };

export interface FetchDeps {
  fetchJson: (url: string) => Promise<unknown>;
}

const realDeps: FetchDeps = {
  async fetchJson(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};

function trpcUrl(proc: string, input: unknown): string {
  return `${EA_TRPC}/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
}

function unwrap(body: unknown): unknown {
  const b = body as { result?: { data?: { json?: unknown } }; error?: unknown };
  if (b?.error) throw new Error('EA tRPC error');
  return b?.result?.data?.json;
}

// --- pure parsers -----------------------------------------------------------

export function parseResults(profile: unknown): ResultItem[] {
  const p = profile as {
    resultsByYear?: { resultsByEvent?: Array<{ results?: Array<Record<string, unknown>> }> };
  };
  const events = p?.resultsByYear?.resultsByEvent;
  if (!Array.isArray(events)) return [];
  const out: ResultItem[] = [];
  for (const ev of events) {
    for (const r of ev.results ?? []) {
      const date = String(r.date ?? '');
      const competition = String(r.competition ?? '');
      const mark = String(r.mark ?? '');
      if (date && mark) out.push({ date, competition, mark });
    }
  }
  return out;
}

export function buildRankingState(
  row: RankingRowLite,
  rankDate: string,
  results: ResultItem[],
  qual: QualificationState | null,
): RankingState {
  return {
    rankDate,
    worldPlace: row.worldPlace,
    europeanPlace: row.europeanPlace,
    rankingScore: row.rankingScore,
    results,
    qualification: qual,
  };
}

export function parseRoadTo(raw: unknown): RoadToLite {
  const r = raw as {
    entryNumber?: number;
    qualifications?: Array<{
      qualified?: boolean;
      qualificationPosition?: number | null;
      competitor?: { urlSlug?: string };
    }>;
  };
  const list = Array.isArray(r?.qualifications) ? r.qualifications : [];
  return {
    entryNumber: typeof r?.entryNumber === 'number' ? r.entryNumber : null,
    qualifications: list
      .filter((q) => q?.competitor?.urlSlug)
      .map((q) => ({
        urlSlug: String(q.competitor!.urlSlug),
        qualified: Boolean(q.qualified),
        qualificationPosition: q.qualificationPosition ?? null,
      })),
  };
}

export function qualificationFor(road: RoadToLite | null, slug: string): QualificationState | null {
  if (!road) return null;
  const entry = road.qualifications.find((q) => q.urlSlug === slug);
  if (!entry) return null;
  return { qualified: entry.qualified, place: entry.qualificationPosition, target: road.entryNumber };
}

// --- IO ---------------------------------------------------------------------

/** Resolve a favorited athlete's slug to their current ranking row by scanning
 *  the ranking list (the EA API has no search procedure). */
async function findRow(
  slug: string,
  gender: Gender,
  deps: FetchDeps,
): Promise<{ row: RankingRowLite; rankDate: string; waId: number | null } | null> {
  const first = unwrap(await deps.fetchJson(trpcUrl('worldAthletics.getRanking', {
    eventGroup: 'high-jump',
    gender,
  }))) as { pages?: number; rankDate?: string; rankings?: Array<Record<string, unknown>> };
  const pages = first?.pages ?? 1;
  const rankDate = String(first?.rankDate ?? '');
  const all = [...(first?.rankings ?? [])];
  for (let page = 2; page <= pages; page++) {
    const next = unwrap(await deps.fetchJson(trpcUrl('worldAthletics.getRanking', {
      eventGroup: 'high-jump',
      gender,
      page,
    }))) as { rankings?: Array<Record<string, unknown>> };
    all.push(...(next?.rankings ?? []));
  }
  const match = all.find((r) => String(r.athleteUrlSlug ?? '') === slug);
  if (!match) return null;
  const waId = Number(String(match.athleteUrlSlug ?? '').match(/-(\d+)$/)?.[1] ?? '') || null;
  return {
    rankDate,
    waId,
    row: {
      europeanPlace: Number(match.place) || null,
      worldPlace: Number(match.worldPlace) || null,
      rankingScore: Number(match.rankingScore) || null,
      calculationId: Number(match.id) || null,
    },
  };
}

/** Fetch the Road to Birmingham qualifying system for a gender (one call covers
 *  every athlete of that gender — the poller fetches this once per gender). */
export async function fetchRoadTo(gender: Gender, deps: FetchDeps = realDeps): Promise<RoadToLite> {
  const raw = unwrap(
    await deps.fetchJson(
      trpcUrl('worldAthletics.getCompetitionQualifyingSystem', {
        competitionId: BIRMINGHAM_COMPETITION_ID,
        eventId: HIGH_JUMP_EVENT_ID[gender],
      }),
    ),
  );
  return parseRoadTo(raw);
}

export async function fetchAthleteState(
  slug: string,
  gender: Gender,
  deps: FetchDeps = realDeps,
  roadTo: RoadToLite | null = null,
): Promise<RankingState | null> {
  const found = await findRow(slug, gender, deps);
  if (!found) return null;

  let results: ResultItem[] = [];
  if (found.waId != null) {
    try {
      const profile = unwrap(
        await deps.fetchJson(trpcUrl('worldAthletics.getAthleteProfile', { id: found.waId })),
      );
      results = parseResults(profile);
    } catch {
      results = []; // graceful degradation — skip results for this athlete
    }
  }

  // Qualification comes from the per-gender road-to system the poller pre-fetched.
  // qualificationFor returns null when roadTo is null (fetch failed) or the athlete
  // isn't in the system — diffQualification then stays quiet. Graceful degradation.
  const qualification = qualificationFor(roadTo, slug);

  return buildRankingState(found.row, found.rankDate, results, qualification);
}
```

Note: `roadTo` is optional and defaults to `null`, so the pure-parser tests and any caller that doesn't need qualification still work. The poller (Task 7) fetches road-to once per gender and passes it in.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- supabase/functions/_shared/ea.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ea.ts supabase/functions/_shared/ea.test.ts
git commit -m "feat: EA API client + pure parsers for notify poller"
```

---

### Task 6: Email dispatch (Channel interface + Resend)

**Files:**
- Create: `supabase/functions/_shared/dispatch.ts`
- Create: `supabase/functions/_shared/dispatch.test.ts`

**Interfaces:**
- Consumes: `EmailPayload` from `./detectors`.
- Produces:
  - `interface Channel { send(to: string, payload: EmailPayload): Promise<void> }`
  - `buildResendBody(from: string, to: string, payload: EmailPayload): Record<string, unknown>` (pure)
  - `appendUnsubscribe(payload: EmailPayload, url: string): EmailPayload` (pure)
  - `class EmailChannel implements Channel` (constructor `(apiKey: string, from: string, fetchImpl?: typeof fetch)`)

- [ ] **Step 1: Write the failing test (pure helpers)**

Create `supabase/functions/_shared/dispatch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildResendBody, appendUnsubscribe } from './dispatch';

describe('buildResendBody', () => {
  it('maps payload to the Resend API shape', () => {
    const body = buildResendBody('HJ <no-reply@hj.dev>', 'u@x.com', {
      subject: 'S',
      html: '<p>h</p>',
      text: 't',
    });
    expect(body).toEqual({
      from: 'HJ <no-reply@hj.dev>',
      to: ['u@x.com'],
      subject: 'S',
      html: '<p>h</p>',
      text: 't',
    });
  });
});

describe('appendUnsubscribe', () => {
  it('adds the unsubscribe link to html and text', () => {
    const out = appendUnsubscribe({ subject: 'S', html: '<p>h</p>', text: 't' }, 'https://x/u?token=abc');
    expect(out.text).toContain('https://x/u?token=abc');
    expect(out.html).toContain('https://x/u?token=abc');
    expect(out.html).toContain('Unsubscribe');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- supabase/functions/_shared/dispatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `supabase/functions/_shared/dispatch.ts`**

```typescript
// Pluggable notification channels. v1 ships EmailChannel (Resend); the Channel
// interface lets Telegram/WhatsApp slot in later without touching the poller.
import type { EmailPayload } from './detectors.ts';

export interface Channel {
  send(to: string, payload: EmailPayload): Promise<void>;
}

export function buildResendBody(
  from: string,
  to: string,
  payload: EmailPayload,
): Record<string, unknown> {
  return { from, to: [to], subject: payload.subject, html: payload.html, text: payload.text };
}

export function appendUnsubscribe(payload: EmailPayload, url: string): EmailPayload {
  return {
    subject: payload.subject,
    text: `${payload.text}\n\n—\nUnsubscribe: ${url}`,
    html: `${payload.html}<hr/><p style="font-size:12px;color:#888">You get these because you enabled notifications. <a href="${url}">Unsubscribe</a>.</p>`,
  };
}

export class EmailChannel implements Channel {
  constructor(
    private apiKey: string,
    private from: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, payload: EmailPayload): Promise<void> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildResendBody(this.from, to, payload)),
    });
    if (!res.ok) {
      throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- supabase/functions/_shared/dispatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/dispatch.ts supabase/functions/_shared/dispatch.test.ts
git commit -m "feat: pluggable email dispatch channel (Resend)"
```

---

### Task 7: `notify-poll` orchestration edge function

**Files:**
- Create: `supabase/functions/notify-poll/index.ts`

**Interfaces:**
- Consumes: `fetchAthleteState` (`./ea.ts` → import as `../_shared/ea.ts`), all detectors/digests (`../_shared/detectors.ts`), `EmailChannel`/`appendUnsubscribe` (`../_shared/dispatch.ts`), Supabase service-role client.
- Produces: an HTTP endpoint invoked by Supabase Cron. Supports `?dry=1` to compute and log without sending.

This task is I/O orchestration over already-tested pure units. It is verified by manual local invocation (`supabase functions serve`) rather than vitest, because it depends on Deno + remote imports.

- [ ] **Step 1: Implement `supabase/functions/notify-poll/index.ts`**

```typescript
// Daily Supabase-Cron poller. For every favorited athlete of an opted-in user,
// fetch current EA state, diff against the stored snapshot, and email per-user
// digests: new results daily; ranking changes only when a new rankDate appears.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchAthleteState, fetchRoadTo, type RoadToLite } from '../_shared/ea.ts';
import {
  diffResults,
  diffPlace,
  diffScore,
  diffQualification,
  filterByPrefs,
  buildResultsDigest,
  buildRankingDigest,
  type AthleteEvents,
  type Snapshot,
  type NotifyPrefs,
  type Gender,
} from '../_shared/detectors.ts';
import { EmailChannel, appendUnsubscribe } from '../_shared/dispatch.ts';

const cors = { 'Access-Control-Allow-Origin': '*' };

Deno.serve(async (req) => {
  const dry = new URL(req.url).searchParams.has('dry');
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const channel = new EmailChannel(
    Deno.env.get('RESEND_API_KEY') ?? '',
    Deno.env.get('NOTIFY_FROM_EMAIL') ?? 'HJ Stats <onboarding@resend.dev>',
  );
  const unsubBase = `${Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.functions.supabase.co')}/notify-unsubscribe`;
  const today = new Date().toISOString().slice(0, 10);

  // 1. Opted-in users + their favorites.
  const { data: settings } = await admin
    .from('notification_settings')
    .select('user_id, unsubscribe_token, last_results_date, last_ranking_week')
    .eq('email_enabled', true);
  const optedIn = settings ?? [];
  if (optedIn.length === 0) return json({ ok: true, users: 0 }, cors);

  const userIds = optedIn.map((s) => s.user_id);
  const { data: favRows } = await admin
    .from('favorites')
    .select('user_id, athlete_slug, athlete_name, gender, notify_prefs')
    .in('user_id', userIds);
  const favorites = favRows ?? [];

  // 2. Fetch each distinct athlete once; compute events vs snapshot.
  type Key = string;
  const key = (slug: string, g: string): Key => `${g}:${slug}`;
  const distinct = new Map<Key, { slug: string; gender: Gender; name: string }>();
  for (const f of favorites) {
    distinct.set(key(f.athlete_slug, f.gender), {
      slug: f.athlete_slug,
      gender: f.gender as Gender,
      name: f.athlete_name,
    });
  }

  // Pre-fetch the road-to qualifying system once per gender present among favorites
  // (one call covers all athletes of that gender). Best-effort: null on failure.
  const roadToByGender = new Map<Gender, RoadToLite | null>();
  for (const g of new Set([...distinct.values()].map((a) => a.gender))) {
    try {
      roadToByGender.set(g, await fetchRoadTo(g));
    } catch (e) {
      console.error(`road-to fetch failed for ${g}:`, e);
      roadToByGender.set(g, null);
    }
  }

  const athleteEvents = new Map<Key, AthleteEvents>();
  let rankingWeek: string | null = null;

  for (const [k, a] of distinct) {
    try {
      const state = await fetchAthleteState(a.slug, a.gender, undefined, roadToByGender.get(a.gender) ?? null);
      if (!state) continue;
      rankingWeek = rankingWeek ?? state.rankDate;

      const { data: snapRow } = await admin
        .from('ranking_snapshots')
        .select('*')
        .eq('athlete_slug', a.slug)
        .eq('gender', a.gender)
        .maybeSingle();
      const snap = (snapRow as Snapshot | null) ?? {
        rank_date: null,
        world_place: null,
        european_place: null,
        ranking_score: null,
        results: [],
        qualification: null,
      };
      const firstRun = snapRow == null;
      const rankAdvanced = snap.rank_date != null && state.rankDate !== snap.rank_date;

      athleteEvents.set(k, {
        slug: a.slug,
        name: a.name,
        gender: a.gender,
        // Daily: new results (skip on first run — nothing to compare).
        results: firstRun ? [] : diffResults(snap.results ?? [], state.results),
        // Weekly: only when a new rankDate appears (and not first run).
        place: !firstRun && rankAdvanced ? diffPlace(snap, state) : [],
        score: !firstRun && rankAdvanced ? diffScore(snap, state) : null,
        qualification: !firstRun && rankAdvanced ? diffQualification(snap, state) : null,
      });

      // Upsert the new snapshot.
      if (!dry) {
        await admin.from('ranking_snapshots').upsert({
          athlete_slug: a.slug,
          gender: a.gender,
          rank_date: state.rankDate,
          world_place: state.worldPlace,
          european_place: state.europeanPlace,
          ranking_score: state.rankingScore,
          results: state.results,
          qualification: state.qualification,
          captured_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error(`athlete ${k} failed:`, e); // graceful degradation
    }
  }

  // 3. Per user: assemble events filtered by prefs, send digests, log deliveries.
  let sent = 0;
  for (const s of optedIn) {
    const { data: userRes } = await admin.auth.admin.getUserById(s.user_id);
    const email = userRes?.user?.email;
    if (!email) continue;
    const name = email.split('@')[0];
    const unsubUrl = `${unsubBase}?token=${s.unsubscribe_token}`;

    const myFavs = favorites.filter((f) => f.user_id === s.user_id);
    const events: AthleteEvents[] = [];
    for (const f of myFavs) {
      const ev = athleteEvents.get(key(f.athlete_slug, f.gender));
      if (ev) events.push(filterByPrefs(ev, f.notify_prefs as NotifyPrefs));
    }

    // Daily results digest — idempotent per (user, 'results', today).
    if (s.last_results_date !== today) {
      const digest = buildResultsDigest(name, events);
      if (digest) {
        await deliver(admin, channel, email, appendUnsubscribe(digest, unsubUrl), {
          user_id: s.user_id,
          kind: 'results',
          period: today,
        }, dry);
        await admin.from('notification_settings').update({ last_results_date: today }).eq('user_id', s.user_id);
        sent++;
      }
    }

    // Weekly ranking digest — idempotent per (user, 'ranking', rankingWeek).
    if (rankingWeek && s.last_ranking_week !== rankingWeek) {
      const digest = buildRankingDigest(name, events);
      if (digest) {
        await deliver(admin, channel, email, appendUnsubscribe(digest, unsubUrl), {
          user_id: s.user_id,
          kind: 'ranking',
          period: rankingWeek,
        }, dry);
        await admin.from('notification_settings').update({ last_ranking_week: rankingWeek }).eq('user_id', s.user_id);
        sent++;
      }
    }
  }

  return json({ ok: true, users: optedIn.length, athletes: distinct.size, sent, dry }, cors);
});

async function deliver(
  admin: ReturnType<typeof createClient>,
  channel: EmailChannel,
  email: string,
  payload: { subject: string; html: string; text: string },
  meta: { user_id: string; kind: string; period: string },
  dry: boolean,
): Promise<void> {
  // Idempotency: skip if already delivered for this (user, kind, period).
  const { data: existing } = await admin
    .from('notification_deliveries')
    .select('id')
    .eq('user_id', meta.user_id)
    .eq('kind', meta.kind)
    .eq('period', meta.period)
    .maybeSingle();
  if (existing) return;

  let status = 'sent';
  let error: string | null = null;
  if (!dry) {
    try {
      await channel.send(email, payload);
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
    }
  } else {
    status = 'dry';
  }
  await admin.from('notification_deliveries').insert({
    user_id: meta.user_id,
    kind: meta.kind,
    period: meta.period,
    status,
    error,
    summary: { subject: payload.subject },
  });
}

function json(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Type-check the function with Deno (if available)**

Run: `deno check supabase/functions/notify-poll/index.ts`
Expected: no type errors. (If the Deno CLI is unavailable, skip; deployment will type-check.)

- [ ] **Step 3: Manual dry-run verification (requires Supabase CLI + local stack)**

```bash
supabase functions serve notify-poll --no-verify-jwt
# in another shell:
curl "http://localhost:54321/functions/v1/notify-poll?dry=1"
```
Expected: JSON `{ ok: true, users: N, athletes: M, sent: 0, dry: true }` and rows appear in `notification_deliveries` with `status='dry'`. No emails are sent.

If the local stack is unavailable, record this step as deferred to the operator-setup verification in Task 9 and proceed.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/notify-poll/index.ts
git commit -m "feat: notify-poll daily cron orchestration"
```

---

### Task 8: `notify-unsubscribe` edge function

**Files:**
- Create: `supabase/functions/notify-unsubscribe/index.ts`

**Interfaces:**
- Consumes: Supabase service-role client; `unsubscribe_token` from `notification_settings`.
- Produces: `GET /notify-unsubscribe?token=<uuid>` → sets `email_enabled=false`, returns a small HTML confirmation.

- [ ] **Step 1: Implement `supabase/functions/notify-unsubscribe/index.ts`**

```typescript
// One-click unsubscribe. The token is the capability — no auth required.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function page(msg: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center"><h1>HJ Stats</h1><p>${msg}</p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return page('Missing unsubscribe token.', 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await admin
    .from('notification_settings')
    .update({ email_enabled: false, updated_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .select('user_id');

  if (error) return page('Something went wrong. Please try again later.', 500);
  if (!data || data.length === 0) return page('This unsubscribe link is no longer valid.', 404);
  return page('You have been unsubscribed from athlete notifications.');
});
```

- [ ] **Step 2: Type-check (if Deno available)**

Run: `deno check supabase/functions/notify-unsubscribe/index.ts`
Expected: no type errors.

- [ ] **Step 3: Manual verification (if local stack available)**

```bash
supabase functions serve notify-unsubscribe --no-verify-jwt
curl "http://localhost:54321/functions/v1/notify-unsubscribe?token=BOGUS"
```
Expected: HTML page "This unsubscribe link is no longer valid." (404). With a real token from `notification_settings`, the matching row flips `email_enabled=false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/notify-unsubscribe/index.ts
git commit -m "feat: notify-unsubscribe endpoint"
```

---

### Task 9: Notifications UI in AccountPage

**Files:**
- Create: `src/components/NotificationSettings.tsx`
- Modify: `src/auth/AccountPage.tsx` (render `<NotificationSettings />`)
- Create: `src/components/NotificationSettings.test.tsx`
- Modify: `src/styles.css` (small styles for the toggle grid — optional, keep minimal)

**Interfaces:**
- Consumes: `useAuth`, `useFavorites` (`favorites`, `updatePrefs`), `getNotificationSettings`, `updateNotificationSettings`, `NotifyPrefs`.
- Produces: `<NotificationSettings />` — master email toggle + per-favorite trigger checkboxes.

- [ ] **Step 1: Write the failing test**

Create `src/components/NotificationSettings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getNotificationSettings = vi.fn();
const updateNotificationSettings = vi.fn();
const updatePrefs = vi.fn();

vi.mock('../data/userData', () => ({
  getNotificationSettings: (...a: unknown[]) => getNotificationSettings(...a),
  updateNotificationSettings: (...a: unknown[]) => updateNotificationSettings(...a),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.com' } }) }));
vi.mock('../hooks/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [
      {
        id: 'f1',
        athlete_slug: 's',
        athlete_name: 'Ada Jumper',
        gender: 'men',
        notify_prefs: { place: true, score: true, result: true, qualification: true },
      },
    ],
    updatePrefs: (...a: unknown[]) => updatePrefs(...a),
  }),
}));

import { NotificationSettings } from './NotificationSettings';

beforeEach(() => {
  getNotificationSettings.mockResolvedValue({ email_enabled: false, unsubscribe_token: 't' });
  updateNotificationSettings.mockResolvedValue(undefined);
  updatePrefs.mockResolvedValue(undefined);
});

describe('NotificationSettings', () => {
  it('enables email via the master toggle', async () => {
    render(<NotificationSettings />);
    const master = await screen.findByLabelText(/email me about my favorites/i);
    expect((master as HTMLInputElement).checked).toBe(false);
    await userEvent.click(master);
    await waitFor(() =>
      expect(updateNotificationSettings).toHaveBeenCalledWith('u1', { email_enabled: true }),
    );
  });

  it('toggling a trigger calls updatePrefs when email is enabled', async () => {
    getNotificationSettings.mockResolvedValue({ email_enabled: true, unsubscribe_token: 't' });
    render(<NotificationSettings />);
    const resultBox = await screen.findByLabelText(/Ada Jumper.*result/i);
    await userEvent.click(resultBox);
    expect(updatePrefs).toHaveBeenCalledWith('s', 'men', {
      place: true,
      score: true,
      result: false,
      qualification: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/NotificationSettings.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/NotificationSettings.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useFavorites } from '../hooks/FavoritesContext';
import { getNotificationSettings, updateNotificationSettings } from '../data/userData';
import type { NotifyPrefs } from '../data/types';

const TRIGGERS: Array<{ key: keyof NotifyPrefs; label: string }> = [
  { key: 'place', label: 'Place' },
  { key: 'score', label: 'Score' },
  { key: 'result', label: 'Result' },
  { key: 'qualification', label: 'Qualification' },
];

export function NotificationSettings() {
  const { user } = useAuth();
  const { favorites, updatePrefs } = useFavorites();
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    getNotificationSettings(user.id)
      .then((s) => setEmailEnabled(Boolean(s?.email_enabled)))
      .finally(() => setLoaded(true));
  }, [user]);

  if (!user) return null;

  async function toggleEmail() {
    const next = !emailEnabled;
    setEmailEnabled(next); // optimistic
    setMessage('');
    try {
      await updateNotificationSettings(user!.id, { email_enabled: next });
    } catch {
      setEmailEnabled(!next);
      setMessage('Could not save notification setting.');
    }
  }

  function toggleTrigger(slug: string, gender: 'men' | 'women', prefs: NotifyPrefs, key: keyof NotifyPrefs) {
    void updatePrefs(slug, gender, { ...prefs, [key]: !prefs[key] }).catch(() =>
      setMessage('Could not save athlete preference.'),
    );
  }

  return (
    <section className="notif-settings">
      <h3>Email notifications</h3>
      <label className="notif-master">
        <input
          type="checkbox"
          checked={emailEnabled}
          onChange={toggleEmail}
          disabled={!loaded}
        />
        <span>Email me about my favorites</span>
      </label>
      <p className="muted">Sent to {user.email}. New results daily; ranking changes weekly.</p>

      {favorites.length === 0 ? (
        <p className="muted">Star an athlete to choose what you get notified about.</p>
      ) : (
        <ul className="notif-list">
          {favorites.map((f) => (
            <li key={f.id} className="notif-row">
              <span className="notif-name">{f.athlete_name}</span>
              <span className="notif-triggers">
                {TRIGGERS.map((t) => (
                  <label key={t.key} aria-label={`${f.athlete_name} ${t.label}`}>
                    <input
                      type="checkbox"
                      checked={f.notify_prefs[t.key]}
                      disabled={!emailEnabled}
                      onChange={() => toggleTrigger(f.athlete_slug, f.gender, f.notify_prefs, t.key)}
                    />
                    {t.label}
                  </label>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="lookup-msg">{message}</p>}
    </section>
  );
}
```

- [ ] **Step 4: Render it in `src/auth/AccountPage.tsx`**

Add the import near the top:

```tsx
import { NotificationSettings } from '../components/NotificationSettings';
```

Render it just before the `account-actions` div (after the `{message && ...}` line):

```tsx
      {message && <p className="lookup-msg">{message}</p>}

      <NotificationSettings />

      <div className="account-actions">
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- src/components/NotificationSettings.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the whole suite + build**

Run: `npm run test`
Expected: PASS.
Run: `npm run build`
Expected: `tsc -b` + `vite build` succeed (confirms edge-function files under `supabase/` are excluded from the app tsconfig, as the existing `delete-account` function already is).

- [ ] **Step 7: Commit**

```bash
git add src/components/NotificationSettings.tsx src/components/NotificationSettings.test.tsx src/auth/AccountPage.tsx src/styles.css
git commit -m "feat: notification settings UI (master toggle + per-athlete triggers)"
```

---

### Task 10: Operator setup docs

**Files:**
- Create: `docs/notifications-setup.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write `docs/notifications-setup.md`**

````markdown
# Athlete Notifications — Operator Setup

The notification code ships dormant. To turn it on:

## 1. Resend
- Create a Resend account and verify a sender domain (or use `onboarding@resend.dev` for testing).
- Copy an API key.

## 2. Supabase secrets
```bash
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set NOTIFY_FROM_EMAIL="HJ Stats <no-reply@yourdomain>"
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

## 3. Apply the migration
```bash
supabase db push        # applies 0002_notifications.sql
```

## 4. Deploy functions
```bash
supabase functions deploy notify-poll
supabase functions deploy notify-unsubscribe
```

## 5. Schedule the daily cron
In the Supabase dashboard → Database → Cron (or via SQL with pg_cron + pg_net),
invoke `notify-poll` once a day, e.g. 06:00 UTC:
```sql
select cron.schedule(
  'notify-poll-daily',
  '0 6 * * *',
  $$ select net.http_post(
       url := 'https://<project-ref>.functions.supabase.co/notify-poll',
       headers := '{"Authorization":"Bearer <service-role-key>"}'::jsonb
     ) $$
);
```

## 6. Smoke test
```bash
curl "https://<project-ref>.functions.supabase.co/notify-poll?dry=1" \
  -H "Authorization: Bearer <service-role-key>"
```
Expect `{ ok: true, ... , dry: true }` and `status='dry'` rows in
`notification_deliveries`, with no emails sent. Remove `?dry=1` to send for real.

## Notes
- First run only seeds snapshots — no emails until data changes.
- Qualification tracks the Road to Birmingham 2026 (European Championships) qualifying
  system; it fires when an athlete enters or drops out of the quota. If the road-to
  endpoint is unavailable on a run, qualification is skipped for that run (results and
  ranking still send).
````

- [ ] **Step 2: Commit**

```bash
git add docs/notifications-setup.md
git commit -m "docs: notifications operator setup guide"
```

---

## Self-Review

**Spec coverage:**
- Two cadences (daily results / weekly ranking, rankDate-gated) → Task 7 orchestration. ✓
- Four triggers (place/score/result/qualification) → Task 4 detectors; qualification wired live via Road to Birmingham road-to system (Task 5 `fetchRoadTo`/`qualificationFor`, Task 7 per-gender prefetch). ✓
- Per-athlete, per-trigger control → Tasks 2, 3, 9. ✓
- Opt-in default off + unsubscribe → Task 1 (default false), Task 8 (unsubscribe), Task 6 (`appendUnsubscribe`). ✓
- Idempotency (`unique(user_id, kind, period)` + last_* guards) → Task 1 schema, Task 7 `deliver()`. ✓
- Service-role-only snapshots/deliveries → Task 1 RLS. ✓
- Pluggable channel → Task 6 `Channel` interface. ✓
- Graceful degradation → Task 5 (results try/catch, `qualificationFor` null-safe), Task 7 (per-gender road-to try/catch, per-athlete try/catch). ✓
- Resend provisioning as operator action → Task 10. ✓
- Pure logic vitest-tested, edge functions thin → Tasks 4/5/6 tested; 7/8 manual. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code. ✓

**Type consistency:** `NotifyPrefs`, `AthleteEvents`, `Snapshot`, `RankingState`, `EmailPayload`, `Channel` names/signatures are consistent across Tasks 4–9. `filterByPrefs`, `buildResultsDigest`, `buildRankingDigest`, `fetchAthleteState`, `appendUnsubscribe`, `EmailChannel` used in Task 7 all match their defining tasks. ✓

**Note for implementers:** Tasks 1→2→3 and 4→5→6→7 have ordering dependencies; Task 4 (detectors) is a dependency of 5, 6, 7. Task 9 depends on 2 and 3. Tasks can be parallelized as: {1}, then {2, 4} in parallel, then {3, 5, 6}, then {7, 8, 9}, then {10}.
