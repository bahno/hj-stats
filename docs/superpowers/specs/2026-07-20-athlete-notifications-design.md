# Athlete Notifications — Design Spec

**Date:** 2026-07-20
**Branch:** `athlete-notification`
**Status:** Approved for planning

## Summary

Opted-in users receive **email** notifications about their favorited high-jumpers.
Two cadences, driven by a single self-correcting **daily** Supabase-Cron edge function:

- **New results — checked daily.** When a favorited athlete records a new competition
  result, the user gets a **daily results digest** (at most one email per day, only on
  days with ≥1 new result).
- **Ranking changes — checked weekly, the day after EA publishes.** Place, score, and
  qualification changes are diffed and emailed **the first day a new `rankDate` is
  observed** — automatically the day after European Athletics publishes, with no
  hardcoded publish weekday. One **weekly ranking digest** per new ranking week.

Users have **per-athlete, per-trigger** control (Place / Score / Result / Qualification).
Email is **opt-in (default off)** with a mandatory one-click unsubscribe.

Email provider: **Resend**. Code ships dormant until the user provisions a Resend API
key as a Supabase function secret; exact setup steps are part of the deliverable.

## Goals

- Notify users of the four change types on their favorites, via email, at the right cadence.
- Per-athlete, per-trigger opt-out; global opt-in.
- No double-sends; no emailing users who did not opt in.
- Channel dispatch is pluggable so Telegram/WhatsApp can be added later without rework.

## Non-goals (v1)

- Telegram / WhatsApp / Instagram / browser-push delivery (architected for, not built).
- Instagram is infeasible (no unsolicited-notification API) — permanently dropped.
- In-app notification bell / notification center.
- Real-time (sub-daily) alerts.

## Architecture & data flow

```
Supabase Cron (daily)
        │
        ▼
 [notify-poll edge function]  (service role)
   1. Collect distinct favorited athletes for users with email_enabled = true
   2. For each athlete: fetch current data from EA API
        - profile results list        (for daily new-result detection)
        - ranking place/score + rankDate (for weekly ranking detection)
        - road-to qualification state  (for weekly qualification detection)
      Load prior snapshot, compute diffs, upsert new snapshot.
   3. DAILY path: any athlete with a new result since snapshot -> mark result events.
   4. WEEKLY path: only if current rankDate > snapshot.rank_date ->
        compute place/score/qualification diffs -> mark ranking events.
   5. Per user: assemble events for their favorites, filtered by each favorite's
      notify_prefs. Build up to two digests (daily results, weekly ranking).
   6. For each digest with >=1 event and not already sent for its period ->
      send email via Resend -> log delivery.
        │
        ▼
 [notify-unsubscribe edge function]  <-- one-click link in every email footer
      token -> notification_settings.email_enabled = false
```

The static frontend stays static; all push logic is server-side. Snapshots are what make
"new result" and "qualification change" detectable (the EA API only exposes week-over-week
deltas for place/score, not the other two).

### Why one daily cron instead of daily + weekly crons

EA's ranking publish day drifts and can be late. Gating the ranking path on an observed
`rankDate` change makes "the day after they publish" self-correcting regardless of the
actual publish day, and collapses the schedule to a single job. On days with no new
`rankDate`, the ranking path is a cheap no-op.

## Data model — migration `supabase/migrations/0002_notifications.sql`

- **`notification_settings`** (user-level, RLS owner-only)
  - `user_id uuid primary key references auth.users(id) on delete cascade`
  - `email_enabled boolean not null default false`  (opt-in)
  - `unsubscribe_token uuid not null default gen_random_uuid()`
  - `last_results_date text`   (idempotency helper; date of last daily digest)
  - `last_ranking_week text`   (idempotency helper; rankDate of last weekly digest)
  - `created_at`, `updated_at timestamptz`
  - Auto-created for new users via the existing `handle_new_user()` trigger (extend it),
    or lazily upserted on first settings read. **Decision: extend `handle_new_user()`**
    to insert a `notification_settings` row alongside the profile row.

- **`favorites.notify_prefs jsonb`** — new column, default
  `'{"place":true,"score":true,"result":true,"qualification":true}'::jsonb`.
  Per-athlete per-trigger control co-located with the favorite. Existing RLS owner
  policies cover select/insert/delete but NOT update — the migration must add an
  `"own favorites - update"` policy (`for update using (auth.uid() = user_id)`) or
  `notify_prefs` edits silently update 0 rows under RLS. Backfill existing rows with
  the default.

- **`ranking_snapshots`** (service-role only; RLS enabled, no anon/auth policies)
  - `athlete_slug text`, `gender text`, primary key `(athlete_slug, gender)`
  - `rank_date text` (EA week, e.g. `"30 JUN 2026"`)
  - `world_place int`, `european_place int`, `ranking_score numeric`
  - `results jsonb`         (stable identifiers of known competition results)
  - `qualification jsonb`   (road-to state: in/out of quota, target score, etc.)
  - `captured_at timestamptz not null default now()`
  - Holds the **latest** known state per athlete; upserted each run.

- **`notification_deliveries`** (service-role only; RLS enabled, no anon/auth policies)
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid references auth.users(id) on delete cascade`
  - `kind text check (kind in ('results','ranking'))`
  - `period text`  (daily: ISO date; weekly: rankDate week)
  - `sent_at timestamptz`, `status text`, `error text`
  - `summary jsonb` (what was included)
  - `unique (user_id, kind, period)` -> idempotency; a re-run never double-sends.

Snapshots and deliveries are never read by the client; only the poller (service role)
touches them.

## Backend components

Kept as small isolated units. Pure logic separated from Deno/IO so it is vitest-testable.

- **`supabase/functions/_shared/ea.ts`** — Deno EA API client. Mirrors
  `src/data/rankingApi.ts` logic: fetch ranking row (place/score/rankDate), athlete
  profile results, road-to qualification. Network + parsing only.
- **`supabase/functions/_shared/detectors.ts`** — **pure functions**, no IO:
  - `diffResults(prevResults, currResults) -> NewResult[]`
  - `diffPlace(prev, curr) -> PlaceChange | null`
  - `diffScore(prev, curr) -> ScoreChange | null`
  - `diffQualification(prev, curr) -> QualChange | null`
  - `buildResultsDigest(user, events) -> EmailPayload | null`
  - `buildRankingDigest(user, events) -> EmailPayload | null`
  These are the primary unit-test surface (mirrors the `src/engine/*` pure-function style).
- **`supabase/functions/_shared/dispatch.ts`** — `Channel` interface + `EmailChannel`
  (Resend HTTP API). Pluggable; Telegram/WhatsApp implement the same interface later.
- **`supabase/functions/notify-poll/index.ts`** — thin orchestration of the flow above.
  Per-athlete detector failures are caught and skipped (graceful degradation) so one bad
  athlete or endpoint never fails the whole run or blocks other users' digests.
- **`supabase/functions/notify-unsubscribe/index.ts`** — `GET ?token=...` flips
  `email_enabled = false` for the matching `unsubscribe_token`; returns a simple
  confirmation page. No auth required (token is the capability).

## Frontend

- **`src/data/userData.ts`** gains: `getNotificationSettings(userId)`,
  `updateNotificationSettings(userId, patch)`, `updateFavoriteNotifyPrefs(userId, slug,
  gender, prefs)`. `listFavorites` also selects `notify_prefs`.
- **`AccountPage`**: master **"Email me about my favorites"** toggle bound to
  `notification_settings.email_enabled`; shows the destination (auth email).
- **Favorites list** (in `AthleteLookup` favorites view / Account): each favorite shows
  four compact toggles — **Place / Score / Result / Qualification** — bound to
  `favorites.notify_prefs`. Defaults all on. Disabled/greyed when the master toggle is off.
- `FavoritesContext` extended so `notify_prefs` round-trips with each favorite.

## Error handling & correctness

- **Opt-in default OFF** + mandatory unsubscribe link in every email.
- **Idempotency:** `notification_deliveries unique(user_id, kind, period)` plus the
  `last_results_date` / `last_ranking_week` guards prevent double-sends on re-run.
- **First run is silent:** no snapshot to diff against yet; snapshots are seeded, nothing
  is emailed. Expected and documented.
- **Graceful degradation:** each detector runs in isolation; a failing endpoint (e.g.
  road-to scrape) skips that trigger for that athlete and is logged, without failing the
  digest or the run.
- **Politeness:** EA fetches run with bounded concurrency, sequential-ish, to avoid
  hammering the undocumented API.
- **Secrets:** Resend API key + Supabase service-role key stored as Supabase function
  secrets, never in the repo or client bundle.

## Testing

- **`detectors.ts`** — vitest unit tests: new-result detection (incl. empty first run),
  place up/down/no-change, score change, qualification enter/leave quota, per-trigger
  filtering, digest assembly (empty -> no email). Pure functions, no mocks needed.
- **Frontend** — React Testing Library: master toggle persists; per-athlete trigger
  toggles persist and disable when master is off. Matches existing `*.test.tsx` pattern.
- **Edge-function I/O** — EA client and Resend calls mocked; orchestration covered at the
  unit level via the pure pieces. (Edge `index.ts` stays thin.)

## Risks

- **Resend provisioning is a user action.** Code ships dormant; sending requires a Resend
  account, API key as a Supabase secret, and a verified sender domain. Setup steps are
  delivered as docs.
- **EA API is undocumented** (schema/host can change; road-to is HTML scraping). Mitigated
  by isolated detectors + graceful degradation. Qualification is the most fragile trigger.
- **Publish-day drift** handled by the `rankDate`-gated weekly path (see rationale above).

## Deliverable: operator setup steps (documented, not automated)

1. Create a Resend account; verify a sender domain (or use Resend onboarding domain for
   testing).
2. `supabase secrets set RESEND_API_KEY=... NOTIFY_FROM_EMAIL=...`.
3. Deploy functions: `supabase functions deploy notify-poll notify-unsubscribe`.
4. Schedule the daily cron (Supabase Cron / `pg_cron` + `pg_net`) to invoke `notify-poll`.
5. Apply migration `0002_notifications.sql`.

## Out-of-scope follow-ups (noted, not built)

- Telegram / WhatsApp channels via the `Channel` interface.
- In-app notification center.
- User-editable notification email distinct from the auth email.
