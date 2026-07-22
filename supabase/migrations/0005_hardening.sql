-- Hardening pass from the 2026-07 code review. Five independent fixes:
--   1. let a failed delivery retry instead of being permanently "delivered"
--   2. column-level grants so users can't write the poller's bookkeeping columns
--   3. a per-user favorites cap + length bounds on user-supplied text
--   4. per-gender ranking-week bookkeeping (men's and women's lists publish apart)
--   5. an INSERT policy on notification_settings so a missing row can self-heal

-- 1. Delivery retries ------------------------------------------------------
-- deliver() records status='error' rows for observability, but the old
-- unique(user_id, kind, period) constraint meant a later retry's INSERT would
-- be rejected — and the existence check treated the error row as proof of
-- delivery. Scope uniqueness to rows that actually sent, so a failed period
-- can be attempted again while a delivered one still can't double-send.
-- Look the constraint up rather than trusting Postgres' generated name.
do $$
declare
  con text;
begin
  select conname into con
  from pg_constraint
  where conrelid = 'public.notification_deliveries'::regclass
    and contype = 'u'
    and conkey @> array[
      (select attnum from pg_attribute where attrelid = conrelid and attname = 'user_id'),
      (select attnum from pg_attribute where attrelid = conrelid and attname = 'kind'),
      (select attnum from pg_attribute where attrelid = conrelid and attname = 'period')
    ];
  if con is not null then
    execute format('alter table public.notification_deliveries drop constraint %I', con);
  end if;
end;
$$;

create unique index notification_deliveries_sent_once
  on public.notification_deliveries (user_id, kind, period)
  where status = 'sent';

-- 2. Column-level write grants ---------------------------------------------
-- RLS decides which *rows* a user may touch, never which columns. Without
-- these grants an authenticated user can PATCH their own settings row and
-- clear last_results_date / last_ranking_week, forcing the poller to re-send
-- every digest on its next run. Grants close that; the RLS policies still
-- restrict each user to their own row.
revoke update on public.notification_settings from authenticated, anon;
-- user_id is included because PostgREST's upsert compiles to ON CONFLICT DO
-- UPDATE over *every* column in the payload, user_id among them — without the
-- grant, the self-healing upsert in updateNotificationSettings() is refused.
-- It stays safe: 0003's WITH CHECK pins the post-update row to auth.uid(), so
-- a user still cannot hand their row to somebody else.
grant update (email_enabled, updated_at, user_id) on public.notification_settings to authenticated;

-- display_name has been unused since the account-settings field was removed
-- (commit 381b5a8) and was an unbounded user-writable text column.
alter table public.profiles drop column display_name;

revoke update on public.profiles from authenticated, anon;
grant update (default_gender) on public.profiles to authenticated;

-- notify_prefs is the only favorites column a user has any reason to edit;
-- slug/name/gender identify the row and are set once at insert time, and
-- intro_sent is the poller's bookkeeping (written with the service role).
revoke update on public.favorites from authenticated, anon;
grant update (notify_prefs) on public.favorites to authenticated;

-- 3. Abuse bounds on favorites ---------------------------------------------
-- Every favorite multiplies the poller's per-run work, so cap the row count
-- and bound the free-text columns (both are user-supplied and were unbounded).
alter table public.favorites
  add constraint favorites_slug_length check (length(athlete_slug) between 1 and 200),
  add constraint favorites_name_length check (length(athlete_name) between 1 and 200);

create function public.enforce_favorites_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from public.favorites where user_id = new.user_id) >= 50 then
    raise exception 'favorite limit reached (50)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger favorites_limit
  before insert on public.favorites
  for each row execute function public.enforce_favorites_limit();

-- 4. Per-gender ranking week ------------------------------------------------
-- The men's and women's ranking lists publish independently, so a single
-- last_ranking_week column meant a user following both genders only ever got
-- digests keyed to whichever list the poller happened to read first. Move to
-- a jsonb map: {"men": "<rankDate>", "women": "<rankDate>"}.
alter table public.notification_settings
  add column last_ranking_weeks jsonb not null default '{}'::jsonb;

update public.notification_settings
  set last_ranking_weeks = jsonb_build_object('men', last_ranking_week, 'women', last_ranking_week)
  where last_ranking_week is not null;

alter table public.notification_settings drop column last_ranking_week;

-- 5. Self-healing settings row ---------------------------------------------
-- handle_new_user() creates this row, but if that trigger ever fails the user
-- is left with no settings row and no client-side way to create one. An INSERT
-- policy pinned to their own id lets the client upsert its way out.
create policy "own notification_settings - insert" on public.notification_settings
  for insert with check (auth.uid() = user_id);
