-- A favorite was a person + gender with no event group, so starring someone in
-- the 100m and starring them in the pole vault were the same row, and the star
-- lit up in all 36 groups. The product answer is that a favorite stays one
-- person -- it does not burn the 50-favorite cap once per discipline -- and
-- carries the set of event groups they are followed in.
--
-- Stored as the groups' ranking API slugs, the same gender-neutral values as
-- profiles.default_event. No check constraint on the values, for the same
-- reason: the slug list is regenerated from World Athletics into
-- src/data/event_groups.json, so a constraint here would drift silently.
alter table public.favorites add column event_groups text[] not null default '{}'::text[];

-- Every existing row predates all-disciplines support, so every one of them is
-- a high jump favorite. New rows carry the group the star was clicked in; the
-- empty default only applies to a writer that forgot, and an empty set is
-- honest ("followed in nothing") rather than a wrong guess.
update public.favorites set event_groups = array['high-jump'] where event_groups = '{}';

-- Same abuse bound as 0005's length checks on the free-text columns: this one
-- is user-writable too, and 36 is every group there is.
alter table public.favorites
  add constraint favorites_event_groups_count check (cardinality(event_groups) <= 36);

-- 0005 revoked blanket update on favorites and grants column by column.
grant update (event_groups) on public.favorites to authenticated;
