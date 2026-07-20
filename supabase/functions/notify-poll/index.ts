// Daily Supabase-Cron poller. For every favorited athlete of an opted-in user,
// fetch current EA state, diff against the stored snapshot, and email per-user
// digests: new results daily; ranking changes only when a new rankDate appears.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchAthleteState, fetchRoadTo, type RoadToLite } from '../_shared/ea.ts';
import {
  diffResults,
  diffPlace,
  diffScore,
  diffQualification,
  filterByPrefs,
  buildResultsDigest,
  buildRankingDigest,
  type AthleteEvents,
  type Snapshot,
  type NotifyPrefs,
  type Gender,
} from '../_shared/detectors.ts';
import { EmailChannel, appendUnsubscribe } from '../_shared/dispatch.ts';

const cors = { 'Access-Control-Allow-Origin': '*' };

Deno.serve(async (req) => {
  const dry = new URL(req.url).searchParams.has('dry');
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const channel = new EmailChannel(
    Deno.env.get('RESEND_API_KEY') ?? '',
    Deno.env.get('NOTIFY_FROM_EMAIL') ?? 'HJ Stats <onboarding@resend.dev>',
  );
  const unsubBase = `${Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.functions.supabase.co')}/notify-unsubscribe`;
  const today = new Date().toISOString().slice(0, 10);

  // 1. Opted-in users + their favorites.
  const { data: settings } = await admin
    .from('notification_settings')
    .select('user_id, unsubscribe_token, last_results_date, last_ranking_week')
    .eq('email_enabled', true);
  const optedIn = settings ?? [];
  if (optedIn.length === 0) return json({ ok: true, users: 0 }, cors);

  const userIds = optedIn.map((s) => s.user_id);
  const { data: favRows } = await admin
    .from('favorites')
    .select('user_id, athlete_slug, athlete_name, gender, notify_prefs')
    .in('user_id', userIds);
  const favorites = favRows ?? [];

  // 2. Fetch each distinct athlete once; compute events vs snapshot.
  type Key = string;
  const key = (slug: string, g: string): Key => `${g}:${slug}`;
  const distinct = new Map<Key, { slug: string; gender: Gender; name: string }>();
  for (const f of favorites) {
    distinct.set(key(f.athlete_slug, f.gender), {
      slug: f.athlete_slug,
      gender: f.gender as Gender,
      name: f.athlete_name,
    });
  }

  // Pre-fetch the road-to qualifying system once per gender present among favorites
  // (one call covers all athletes of that gender). Best-effort: null on failure.
  const roadToByGender = new Map<Gender, RoadToLite | null>();
  for (const g of new Set([...distinct.values()].map((a) => a.gender))) {
    try {
      roadToByGender.set(g, await fetchRoadTo(g));
    } catch (e) {
      console.error(`road-to fetch failed for ${g}:`, e);
      roadToByGender.set(g, null);
    }
  }

  const athleteEvents = new Map<Key, AthleteEvents>();
  let rankingWeek: string | null = null;

  for (const [k, a] of distinct) {
    try {
      const state = await fetchAthleteState(a.slug, a.gender, undefined, roadToByGender.get(a.gender) ?? null);
      if (!state) continue;
      rankingWeek = rankingWeek ?? state.rankDate;

      const { data: snapRow } = await admin
        .from('ranking_snapshots')
        .select('*')
        .eq('athlete_slug', a.slug)
        .eq('gender', a.gender)
        .maybeSingle();
      const snap = (snapRow as Snapshot | null) ?? {
        rank_date: null,
        world_place: null,
        european_place: null,
        ranking_score: null,
        results: [],
        qualification: null,
      };
      const firstRun = snapRow == null;
      const rankAdvanced = snap.rank_date != null && state.rankDate !== snap.rank_date;

      athleteEvents.set(k, {
        slug: a.slug,
        name: a.name,
        gender: a.gender,
        // Daily: new results (skip on first run — nothing to compare).
        results: firstRun ? [] : diffResults(snap.results ?? [], state.results),
        // Weekly: only when a new rankDate appears (and not first run).
        place: !firstRun && rankAdvanced ? diffPlace(snap, state) : [],
        score: !firstRun && rankAdvanced ? diffScore(snap, state) : null,
        qualification: !firstRun && rankAdvanced ? diffQualification(snap, state) : null,
      });

      // Upsert the new snapshot.
      if (!dry) {
        await admin.from('ranking_snapshots').upsert({
          athlete_slug: a.slug,
          gender: a.gender,
          rank_date: state.rankDate,
          world_place: state.worldPlace,
          european_place: state.europeanPlace,
          ranking_score: state.rankingScore,
          results: state.results,
          qualification: state.qualification,
          captured_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error(`athlete ${k} failed:`, e); // graceful degradation
    }
  }

  // 3. Per user: assemble events filtered by prefs, send digests, log deliveries.
  let sent = 0;
  for (const s of optedIn) {
    const { data: userRes } = await admin.auth.admin.getUserById(s.user_id);
    const email = userRes?.user?.email;
    if (!email) continue;
    const name = email.split('@')[0];
    const unsubUrl = `${unsubBase}?token=${s.unsubscribe_token}`;

    const myFavs = favorites.filter((f) => f.user_id === s.user_id);
    const events: AthleteEvents[] = [];
    for (const f of myFavs) {
      const ev = athleteEvents.get(key(f.athlete_slug, f.gender));
      if (ev) events.push(filterByPrefs(ev, f.notify_prefs as NotifyPrefs));
    }

    // Daily results digest — idempotent per (user, 'results', today).
    if (s.last_results_date !== today) {
      const digest = buildResultsDigest(name, events);
      if (digest) {
        await deliver(admin, channel, email, appendUnsubscribe(digest, unsubUrl), {
          user_id: s.user_id,
          kind: 'results',
          period: today,
        }, dry);
        await admin.from('notification_settings').update({ last_results_date: today }).eq('user_id', s.user_id);
        sent++;
      }
    }

    // Weekly ranking digest — idempotent per (user, 'ranking', rankingWeek).
    if (rankingWeek && s.last_ranking_week !== rankingWeek) {
      const digest = buildRankingDigest(name, events);
      if (digest) {
        await deliver(admin, channel, email, appendUnsubscribe(digest, unsubUrl), {
          user_id: s.user_id,
          kind: 'ranking',
          period: rankingWeek,
        }, dry);
        await admin.from('notification_settings').update({ last_ranking_week: rankingWeek }).eq('user_id', s.user_id);
        sent++;
      }
    }
  }

  return json({ ok: true, users: optedIn.length, athletes: distinct.size, sent, dry }, cors);
});

async function deliver(
  admin: ReturnType<typeof createClient>,
  channel: EmailChannel,
  email: string,
  payload: { subject: string; html: string; text: string },
  meta: { user_id: string; kind: string; period: string },
  dry: boolean,
): Promise<void> {
  // Idempotency: skip if already delivered for this (user, kind, period).
  const { data: existing } = await admin
    .from('notification_deliveries')
    .select('id')
    .eq('user_id', meta.user_id)
    .eq('kind', meta.kind)
    .eq('period', meta.period)
    .maybeSingle();
  if (existing) return;

  let status = 'sent';
  let error: string | null = null;
  if (!dry) {
    try {
      await channel.send(email, payload);
    } catch (e) {
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
    }
  } else {
    status = 'dry';
  }
  await admin.from('notification_deliveries').insert({
    user_id: meta.user_id,
    kind: meta.kind,
    period: meta.period,
    status,
    error,
    summary: { subject: payload.subject },
  });
}

function json(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
