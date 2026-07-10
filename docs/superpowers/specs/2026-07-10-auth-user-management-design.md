# Auth & User Data — Design Spec

**Date:** 2026-07-10
**Branch:** `feat/auth-user-management`
**Status:** Approved design, pending implementation plan

## Goal

Let visitors of hj-stats create an account and sign in so they can save
per-user data — **preferences** and **favorite athletes** — that follows them
across devices. Today the app is a purely static, client-side React + TypeScript
+ Vite SPA deployed to GitHub Pages via a GitHub Actions build (`npm run build`
on push to `main`). There is no backend.

## Decisions (from brainstorming)

- **Purpose:** save per-user data across devices.
- **Backend:** Supabase (hosted Postgres + Auth). No server for us to run.
- **Auth method:** email + password, with email confirmation.
- **User management:** self-service accounts (profile, change password, sign
  out, delete account). No admin-over-others.
- **Saved data (v1):** favorite athletes + preferences.
- **Account deletion:** full delete via a Supabase Edge Function.

## Non-goals (YAGNI, explicitly out of v1)

- No admin panel / role management over other users.
- No OAuth / magic-link (email + password only).
- No saved calculator scenarios (deferred).
- No avatar upload (display name only; no Storage bucket).
- No live-network tests against a real Supabase project.

## Architecture

The app stays a static SPA. All persistence goes through the Supabase JS SDK
directly from the browser, protected by Row-Level Security (RLS). Auth is
**additive** — every existing public feature keeps working for signed-out users.

```
Browser (React SPA on GitHub Pages)
  ├─ existing public features (Calculator, AthleteLookup, external ranking API)
  └─ NEW: Supabase JS SDK
        ├─ Auth (email+password, session in localStorage)
        └─ Postgres (profiles, favorites) guarded by RLS
              └─ Edge Function: delete-account (elevated privilege)
```

### 1. Supabase client & configuration

- New dependency: `@supabase/supabase-js`.
- `src/lib/supabase.ts` — singleton client from `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. The anon key is browser-safe by design (RLS is what
  protects data, not key secrecy).
- **Auth-disabled mode:** if the env vars are absent, `supabase` is `null`. The
  app runs fully as today, with auth UI hidden. This keeps local dev and
  contributors-without-keys unbroken, and means a bad/missing config degrades
  gracefully instead of crashing.
- `.env.example` committed with the two variable names; `.env.local` added to
  `.gitignore`. In CI, the two keys are GitHub Actions repo **Variables** wired
  into the `npm run build` step's env.
- Supabase Auth "Redirect URLs" configured for both the Pages origin
  (`https://bahno.github.io/hj-stats/`) and `http://localhost:5173`.

### 2. Data model (Postgres + RLS)

Migration SQL committed under `supabase/migrations/`.

**`profiles`** — one row per user, holds preferences.
| column          | type        | notes                                  |
| --------------- | ----------- | -------------------------------------- |
| `id`            | uuid PK     | references `auth.users(id)` on delete cascade |
| `display_name`  | text        | nullable                               |
| `default_gender`| text        | `'men' | 'women'`, nullable            |
| `created_at`    | timestamptz | default `now()`                        |

Auto-created on signup via a trigger on `auth.users` (`handle_new_user`).

**`favorites`** — starred athletes.
| column         | type        | notes                                       |
| -------------- | ----------- | ------------------------------------------- |
| `id`           | uuid PK     | default `gen_random_uuid()`                 |
| `user_id`      | uuid        | references `auth.users(id)` on delete cascade |
| `athlete_slug` | text        | stable id = `RankingRow.athleteUrlSlug`     |
| `athlete_name` | text        | denormalized for display                    |
| `gender`       | text        | `'men' | 'women'` (an athlete is per-list)  |
| `created_at`   | timestamptz | default `now()`                             |
|                |             | UNIQUE `(user_id, athlete_slug, gender)`    |

**RLS:** enabled on both tables. Policies restrict `select/insert/update/delete`
to rows where `auth.uid() = id` (profiles) / `auth.uid() = user_id` (favorites).

### 3. Auth layer

- `src/auth/AuthContext.tsx` — React context exposing
  `{ session, user, loading, signUp, signIn, signOut }`. Subscribes to
  `supabase.auth.onAuthStateChange` and seeds from `getSession()`. When
  `supabase` is `null`, provides a stable "no auth available" value.
- `src/auth/AuthModal.tsx` — login ↔ signup toggle, email + password, styled to
  match existing cards/inputs (`.card`, `.field`, `.text-input`). States:
  idle, submitting, error (inline, `.lookup-msg` style), and
  "check your email to confirm" after signup.
- `src/auth/AccountPage.tsx` — edit `display_name`, change password
  (`supabase.auth.updateUser`), sign out, and delete account (calls the Edge
  Function, then signs out).

### 4. Per-user data access

- `src/data/userData.ts` — typed functions:
  `getProfile`, `updateProfile`, `listFavorites`, `addFavorite`,
  `removeFavorite`. All return typed results and surface errors to callers.
- `src/hooks/usePreferences.ts` and `src/hooks/useFavorites.ts` — load on
  session change, expose state + mutators, apply optimistic updates with
  rollback on failure.

### 5. UI integration

- **Nav** (`src/components/Nav.tsx`): account affordance on the right. Signed
  out → "Sign in" button (opens `AuthModal`). Signed in → display-name menu
  (Account, Sign out). A third view `'account'` is added to `View`.
- **AthleteLookup**: ★ toggle on the result header and on candidate rows; a
  "Favorites" strip to reopen a saved athlete (re-runs the existing search by
  slug/name). Signed out → ★ opens the sign-in modal.
- **Preferences**: `default_gender` seeds the initial `GenderToggle` value in
  Calculator and AthleteLookup; changing it while signed in persists.

### 6. Edge Function: `delete-account`

- `supabase/functions/delete-account/index.ts`. Verifies the caller's JWT,
  then uses the service-role client to delete the `auth.users` row (cascades to
  `profiles` and `favorites`). Invoked from `AccountPage` via
  `supabase.functions.invoke('delete-account')`; on success the client signs out.

### 7. Error handling

- Supabase unconfigured → public app, auth UI hidden, no crashes.
- Network / auth errors → inline messages in forms, matching `.lookup-msg`.
- Unconfirmed email → explicit "check your email" state; sign-in of an
  unconfirmed account surfaces the Supabase error.
- Favorites / preferences write failure → revert the optimistic update and show
  an inline error.

### 8. Testing (vitest + @testing-library, matching existing `*.test.ts`)

- `userData` and the hooks against a **mocked** Supabase client (success and
  error paths, optimistic rollback).
- Auth-context logic (session seeding, state transitions, null-client mode).
- Auth form validation (empty/invalid email, password rules, mode toggle).
- No tests hit a live Supabase project.

## Deployment / config checklist

1. Create a Supabase project; run the migration SQL; configure Auth redirect URLs.
2. Deploy the `delete-account` Edge Function.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as GitHub Actions repo
   Variables; reference them in the build step env of `.github/workflows/deploy.yml`.
4. Locally, copy `.env.example` → `.env.local` with the same two values.

## File map (new / changed)

```
src/lib/supabase.ts                     (new)
src/auth/AuthContext.tsx                (new)
src/auth/AuthModal.tsx                  (new)
src/auth/AccountPage.tsx                (new)
src/data/userData.ts                    (new)
src/hooks/usePreferences.ts             (new)
src/hooks/useFavorites.ts               (new)
src/components/Nav.tsx                   (changed — account affordance, 'account' view)
src/components/AthleteLookup.tsx         (changed — favorites ★ + strip)
src/components/Calculator.tsx            (changed — default_gender preference)
src/App.tsx                              (changed — AuthProvider, account view, modal)
src/styles.css                           (changed — auth/account/favorites styles)
supabase/migrations/0001_init.sql        (new)
supabase/functions/delete-account/index.ts (new)
.env.example                             (new)
.gitignore                               (changed — .env.local)
.github/workflows/deploy.yml             (changed — inject env vars)
```
