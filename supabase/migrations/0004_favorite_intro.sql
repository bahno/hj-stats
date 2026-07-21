-- Per-favorite flag: has the one-time "here's where they stand" résumé been
-- sent yet? Defaults false so every favorite (existing and new) gets the résumé
-- once, on the first ranking update after it was starred. The poller sets it
-- true after including the résumé in a delivered ranking digest.
alter table public.favorites
  add column intro_sent boolean not null default false;
