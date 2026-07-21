-- Defense-in-depth: pin ownership on the POST-update row for the two owner
-- UPDATE policies. Postgres already applies each policy's USING clause as an
-- implicit WITH CHECK when none is given (so a user cannot reassign a row's
-- user_id to someone else), but stating WITH CHECK explicitly is the documented
-- best practice and removes the subtlety. ALTER POLICY leaves the existing
-- USING clause unchanged.
alter policy "own favorites - update" on public.favorites
  with check (auth.uid() = user_id);

alter policy "own notification_settings - update" on public.notification_settings
  with check (auth.uid() = user_id);
