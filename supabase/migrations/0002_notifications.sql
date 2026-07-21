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

-- 0001_init.sql enabled RLS on favorites with select/insert/delete policies only;
-- add the missing update policy so notify_prefs edits actually persist.
create policy "own favorites - update" on public.favorites
  for update using (auth.uid() = user_id);

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
