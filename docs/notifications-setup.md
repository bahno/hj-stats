# Athlete Notifications — Operator Setup

The notification code ships dormant. To turn it on:

## 1. Resend
- Create a Resend account and verify a sender domain (or use `onboarding@resend.dev` for testing).
- Copy an API key.

## 2. Supabase secrets
```bash
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set NOTIFY_FROM_EMAIL="HJ Stats <no-reply@yourdomain>"
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

## 3. Apply the migration
```bash
supabase db push        # applies 0002_notifications.sql
```

## 4. Deploy functions
```bash
supabase functions deploy notify-poll
supabase functions deploy notify-unsubscribe
```

## 5. Schedule the daily cron
In the Supabase dashboard → Database → Cron (or via SQL with pg_cron + pg_net),
invoke `notify-poll` once a day, e.g. 06:00 UTC:
```sql
select cron.schedule(
  'notify-poll-daily',
  '0 6 * * *',
  $$ select net.http_post(
       url := 'https://<project-ref>.functions.supabase.co/notify-poll',
       headers := '{"Authorization":"Bearer <service-role-key>"}'::jsonb
     ) $$
);
```

## 6. Smoke test
```bash
curl "https://<project-ref>.functions.supabase.co/notify-poll?dry=1" \
  -H "Authorization: Bearer <service-role-key>"
```
Expect `{ ok: true, ... , dry: true }`. A dry run has **no side effects**: it sends no
emails, writes no `notification_deliveries` rows, and does not touch the per-user
idempotency guards — it only logs a preview of what it *would* send to the function logs
(view with `supabase functions logs notify-poll`). Remove `?dry=1` to send for real.

## Notes
- First run only seeds snapshots — no emails until data changes.
- **Delivery reliability (v1 limitation):** the per-athlete snapshot and the per-user
  `last_*` guards advance on each run independently of whether the email actually sent.
  If a send fails (e.g. a Resend outage), that run's new results/ranking changes have
  already been folded into the snapshot and will NOT be re-sent on a later run — that
  digest is dropped. Transient failures surface as `status='error'` rows in
  `notification_deliveries`. A future version would decouple per-user delivery from the
  global snapshot (a per-user outbox / last-seen) to make delivery at-least-once.
- Qualification tracks the Road to Birmingham 2026 (European Championships) qualifying
  system; it fires when an athlete enters or drops out of the quota. If the road-to
  endpoint is unavailable on a run, qualification is skipped for that run (results and
  ranking still send).
