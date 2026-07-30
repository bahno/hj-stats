-- The rankings view lets a user pick any of the 36 event groups, but only the
-- gender of that selection survived a reload (profiles.default_gender). The
-- event group reset to high jump every time.
--
-- Stored as the group's ranking API slug ('high-jump', '100mh', ...), which is
-- gender-neutral: the pair (default_event, default_gender) resolves to exactly
-- one group. No check constraint on the value — the slug list lives in
-- src/data/event_groups.json and is regenerated from World Athletics, so a
-- constraint here would drift silently. The client resolves the slug through
-- findEventGroup() and falls back to high jump when it no longer names a group.
alter table public.profiles add column default_event text;

-- 0005 revoked blanket update on profiles and grants column by column.
grant update (default_event) on public.profiles to authenticated;
