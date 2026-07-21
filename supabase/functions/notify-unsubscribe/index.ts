// One-click unsubscribe. The token is the capability — no auth required.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function page(msg: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center"><h1>HJ Stats</h1><p>${msg}</p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return page('Missing unsubscribe token.', 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await admin
    .from('notification_settings')
    .update({ email_enabled: false, updated_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .select('user_id');

  if (error) return page('Something went wrong. Please try again later.', 500);
  if (!data || data.length === 0) return page('This unsubscribe link is no longer valid.', 404);
  return page('You have been unsubscribed from athlete notifications.');
});
