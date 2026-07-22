// One-click unsubscribe. The token is the capability — no auth required.
//
// GET renders a confirmation button; only POST actually unsubscribes. Mail
// gateways and link-prefetchers routinely follow every URL in an email, so a
// GET that mutated state would silently unsubscribe people who never clicked.
// The POST form doubles as the RFC 8058 List-Unsubscribe-Post target.

// Pinned exactly: an unpinned @2 lets a dependency change ship to production
// without any commit here. Bump deliberately, alongside the npm dependency.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.8';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(msg: string, status = 200, form = ''): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>HJ Stats</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center"><h1>HJ Stats</h1><p>${msg}</p>${form}</body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/** The token is a UUID, so it needs no escaping — but assert that before it
 *  reaches the markup, and before Postgres rejects a bad cast with a 500. */
function tokenFrom(url: URL): string | null {
  const token = url.searchParams.get('token');
  return token && UUID.test(token) ? token : null;
}

Deno.serve(async (req) => {
  const token = tokenFrom(new URL(req.url));

  if (req.method === 'GET') {
    if (!token) return page('Missing or malformed unsubscribe token.', 400);
    return page(
      'Unsubscribe from athlete notifications?',
      200,
      '<form method="post"><button type="submit" style="font:inherit;padding:.6rem 1.2rem;cursor:pointer">Unsubscribe</button></form>',
    );
  }

  if (req.method !== 'POST') return page('Method not allowed.', 405);
  if (!token) return page('Missing or malformed unsubscribe token.', 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await admin
    .from('notification_settings')
    .update({ email_enabled: false, updated_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .select('user_id');

  if (error) {
    console.error('unsubscribe failed:', error);
    return page('Something went wrong. Please try again later.', 500);
  }
  if (!data || data.length === 0) return page('This unsubscribe link is no longer valid.', 404);
  return page('You have been unsubscribed from athlete notifications.');
});
