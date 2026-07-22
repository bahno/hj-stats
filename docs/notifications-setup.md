# Athlete Notifications — Operator Setup

The notification code ships dormant. To turn it on:

## 1. Resend
- Create a Resend account and verify a sender domain (or use `onboarding@resend.dev` for testing).
- Copy an API key.

## 2. Supabase secrets
```bash
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set NOTIFY_FROM_EMAIL="HJ Stats <no-reply@yourdomain>"
supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
# Origins allowed to call delete-account from a browser (comma-separated).
supabase secrets set ALLOWED_ORIGINS="https://bahno.github.io"
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

`CRON_SECRET` is what actually protects `notify-poll` — see step 4. Without it
set, the function refuses to run and returns 503.

## 3. Apply the migrations
```bash
supabase db push        # applies 0002_notifications.sql .. 0005_hardening.sql
```

## 4. Deploy functions
```bash
# notify-poll is NOT a public endpoint. Deploy it with --no-verify-jwt so the
# CRON_SECRET header is the only way in: the default JWT check would accept the
# project's anon key, which ships publicly in the browser bundle — i.e. any
# visitor could trigger a full poll run.
supabase functions deploy notify-poll --no-verify-jwt
supabase functions deploy notify-unsubscribe --no-verify-jwt
supabase functions deploy delete-account
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
       headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb
     ) $$
);
```

## 6. Smoke test
```bash
curl "https://<project-ref>.functions.supabase.co/notify-poll?dry=1" \
  -H "x-cron-secret: <CRON_SECRET>"
```
Expect `{ ok: true, ... , dry: true }`. A dry run has **no side effects**: it sends no
emails, writes no `notification_deliveries` rows, and does not touch the per-user
idempotency guards — it only logs a preview of what it *would* send to the function logs
(view with `supabase functions logs notify-poll`). Remove `?dry=1` to send for real.

## Notes
- First run only seeds snapshots — no emails until data changes.
- **Delivery reliability:** a failed send no longer advances the per-user `last_*`
  guards, and the idempotency check only treats `status='sent'` rows as delivered, so
  the next run retries that digest. Failures are still recorded as `status='error'`
  rows in `notification_deliveries` for audit.
  **Remaining limitation:** the per-athlete *snapshot* still advances regardless. If a
  send fails and the athlete's state changes again before the retry, the retry sends
  the digest built from the newer diff — so the intermediate change is folded in, not
  replayed separately. Making that fully at-least-once needs a per-user outbox.
- Ranking digests are tracked per gender (`notification_settings.last_ranking_weeks`,
  a `{"men": ..., "women": ...}` map), because the men's and women's lists publish on
  independent dates.
- Each poll run fetches each gender's ranking list and road-to system exactly once,
  then resolves every athlete from that in-memory index — the per-athlete work is one
  profile request, not a re-scan of the ranking.
- Users are capped at 50 favorites (`favorites_limit` trigger in `0005_hardening.sql`),
  since every favorite adds work to every run.
- Qualification tracks the Road to Birmingham 2026 (European Championships) qualifying
  system; it fires when an athlete enters or drops out of the quota. If the road-to
  endpoint is unavailable on a run, qualification is skipped for that run (results and
  ranking still send).
