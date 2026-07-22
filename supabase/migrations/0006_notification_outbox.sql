-- At-least-once delivery for digests.
--
-- 0005 stopped a failed send from being recorded as delivered, but that alone
-- doesn't produce a retry: the per-athlete ranking_snapshots row advances on
-- every run regardless of who the email reached, so the *next* run diffs
-- against the already-advanced snapshot, computes no events, builds a null
-- digest, and sends nothing. The changes are simply gone.
--
-- The outbox decouples per-user delivery from the global snapshot: whatever a
-- user was owed but didn't receive is parked here, merged with the next run's
-- events, and retried until it delivers.
create table public.notification_outbox (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'results' | 'ranking:men' | 'ranking:women' — one pending digest per stream.
  kind text not null,
  -- The period the retry should be logged under (an ISO date for results, a
  -- rankDate for ranking). Carried so a run that can't reach the ranking API
  -- still knows which period the pending digest belongs to.
  period text not null,
  -- AthleteEvents[], as handed to the digest builders.
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Service-role only, like ranking_snapshots and notification_deliveries: RLS on
-- with no policies at all is deny-by-default for anon and authenticated.
alter table public.notification_outbox enable row level security;
