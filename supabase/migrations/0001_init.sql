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
