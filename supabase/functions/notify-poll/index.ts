// Daily Supabase-Cron poller. For every favorited athlete of an opted-in user,
// fetch current EA state, diff against the stored snapshot, and email per-user
// digests: new results daily; ranking changes only when a new rankDate appears.
//
// Not a public endpoint: the caller must present CRON_SECRET. Deploy with
// --no-verify-jwt so that secret is the only gate (the project's anon key is
// public, so JWT verification alone would let any visitor trigger a run).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  fetchAthleteState,
  fetchRankingIndex,
  fetchRoadTo,
  type RankingIndex,
  type RoadToLite,
} from '../_shared/ea.ts';
import {
  diffResults,
  diffPlace,
  diffScore,
  diffQualification,
  filterByPrefs,
  buildResultsDigest,
  buildRankingDigest,
  seasonBest,
  type AthleteEvents,
  type EmailPayload,
  type Snapshot,
  type NotifyPrefs,
  type Gender,
  type Standing,
} from '../_shared/detectors.ts';
import { EmailChannel, appendUnsubscribe } from '../_shared/dispatch.ts';

/** Constant-time-ish compare, so the secret check leaks nothing via timing. */
function secretMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  // No CORS headers at all: nothing in a browser has any business calling this.
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) {
    console.error('CRON_SECRET is not set — refusing to run');
    return json({ ok: false, error: 'not configured' }, 503);
  }
  if (!secretMatches(req.headers.get('x-cron-secret') ?? '', cronSecret)) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

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
  const { data: settings, error: settingsError } = await admin
    .from('notification_settings')
    .select('user_id, unsubscribe_token, last_results_date, last_ranking_weeks')
    .eq('email_enabled', true);
  if (settingsError) {
    console.error('notification_settings query failed:', settingsError);
    return json({ ok: false, error: 'notification_settings query failed' }, 500);
  }
  const optedIn = settings ?? [];
  if (optedIn.length === 0) return json({ ok: true, users: 0 });

  const userIds = optedIn.map((s) => s.user_id);
  const { data: favRows, error: favoritesError } = await admin
    .from('favorites')
    .select('user_id, athlete_slug, athlete_name, gender, notify_prefs, intro_sent')
    .in('user_id', userIds);
  if (favoritesError) {
    console.error('favorites query failed:', favoritesError);
    return json({ ok: false, error: 'favorites query failed' }, 500);
  }
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

  // Per-gender prefetch: one ranking list and one road-to qualifying system
  // cover every athlete of that gender. Resolving a slug means scanning the
  // ranking, so doing this per athlete would re-page the whole list N times.
  const genders = [...new Set([...distinct.values()].map((a) => a.gender))];
  const rankingByGender = new Map<Gender, RankingIndex>();
  const roadToByGender = new Map<Gender, RoadToLite | null>();
  for (const g of genders) {
    try {
      rankingByGender.set(g, await fetchRankingIndex(g));
    } catch (e) {
      // Without the ranking list, nothing about this gender's athletes is knowable.
      console.error(`ranking fetch failed for ${g}:`, e);
    }
    try {
      roadToByGender.set(g, await fetchRoadTo(g));
    } catch (e) {
      console.error(`road-to fetch failed for ${g}:`, e);
      roadToByGender.set(g, null);
    }
  }

  const athleteEvents = new Map<Key, AthleteEvents>();
  const standingByKey = new Map<Key, Standing>();
  const rankAdvancedByKey = new Map<Key, boolean>();
  // The men's and women's lists publish independently, so each gender carries
  // its own rankDate and its own weekly-digest idempotency key.
  const rankDateByGender = new Map<Gender, string>();
  for (const [g, index] of rankingByGender) {
    if (index.rankDate) rankDateByGender.set(g, index.rankDate);
  }

  for (const [k, a] of distinct) {
    const index = rankingByGender.get(a.gender);
    if (!index) continue; // this gender's ranking fetch failed — retry next run
    try {
      const state = await fetchAthleteState(a.slug, index, roadToByGender.get(a.gender) ?? null);
      if (!state) continue;

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

      rankAdvancedByKey.set(k, rankAdvanced);
      standingByKey.set(k, {
        europeanPlace: state.europeanPlace,
        worldPlace: state.worldPlace,
        score: state.rankingScore,
        qualified: state.qualification?.qualified ?? null,
        qualPlace: state.qualification?.place ?? null,
        qualTarget: state.qualification?.target ?? null,
        // Fall back to the stored results when this run couldn't fetch them.
        seasonBest: seasonBest(state.results ?? snap.results ?? []),
      });

      athleteEvents.set(k, {
        slug: a.slug,
        name: a.name,
        gender: a.gender,
        // Daily: new results — skipped on the first run (nothing to compare)
        // and when this run couldn't read the profile at all.
        results:
          firstRun || state.results == null ? [] : diffResults(snap.results ?? [], state.results),
        // Weekly: only when a new rankDate appears (and not first run).
        place: !firstRun && rankAdvanced ? diffPlace(snap, state) : [],
        score: !firstRun && rankAdvanced ? diffScore(snap, state) : null,
        qualification: !firstRun && rankAdvanced ? diffQualification(snap, state) : null,
      });

      // Upsert the new snapshot. `results` is omitted when this run couldn't
      // fetch them, so the stored history survives a transient profile failure
      // instead of being cleared (which would replay every result as "new").
      if (!dry) {
        const row: Record<string, unknown> = {
          athlete_slug: a.slug,
          gender: a.gender,
          rank_date: state.rankDate,
          world_place: state.worldPlace,
          european_place: state.europeanPlace,
          ranking_score: state.rankingScore,
          qualification: state.qualification,
          captured_at: new Date().toISOString(),
        };
        if (state.results != null) row.results = state.results;
        await admin.from('ranking_snapshots').upsert(row);
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
    // Favorites owed a one-time résumé, grouped by gender: the résumé rides
    // along with that gender's ranking digest, so it is only marked sent when
    // that specific digest delivers.
    const introFavs = new Map<Gender, typeof myFavs>();
    for (const f of myFavs) {
      const k2 = key(f.athlete_slug, f.gender);
      const ev = athleteEvents.get(k2);
      if (!ev) continue;
      const ue = filterByPrefs(ev, f.notify_prefs as NotifyPrefs);
      // One-time résumé on the first ranking update after this favorite was starred.
      if (!f.intro_sent && rankAdvancedByKey.get(k2)) {
        const standing = standingByKey.get(k2);
        if (standing) {
          ue.intro = standing;
          const g = f.gender as Gender;
          introFavs.set(g, [...(introFavs.get(g) ?? []), f]);
        }
      }
      events.push(ue);
    }

    // Daily results digest — idempotent per (user, 'results', today).
    if (s.last_results_date !== today) {
      const digest = buildResultsDigest(name, events);
      if (digest) {
        const result = await deliver(admin, channel, email, appendUnsubscribe(digest, unsubUrl), {
          user_id: s.user_id,
          kind: 'results',
          period: today,
        }, dry);
        // Advance the guard only on a real delivery, so a failed send retries.
        if (!dry && (result === 'sent' || result === 'skipped')) {
          await admin.from('notification_settings').update({ last_results_date: today }).eq('user_id', s.user_id);
        }
        if (result === 'sent' || result === 'dry') sent++;
      }
    }

    // Weekly ranking digest — one per gender, idempotent per
    // (user, 'ranking', '<gender>:<rankDate>').
    const weeks: Record<string, string> = {
      ...((s.last_ranking_weeks as Record<string, string> | null) ?? {}),
    };
    for (const g of genders) {
      const rankDate = rankDateByGender.get(g);
      if (!rankDate || weeks[g] === rankDate) continue;
      const digest = buildRankingDigest(name, events.filter((e) => e.gender === g));
      if (!digest) continue;
      const result = await deliver(admin, channel, email, appendUnsubscribe(digest, unsubUrl), {
        user_id: s.user_id,
        kind: 'ranking',
        period: `${g}:${rankDate}`,
      }, dry);
      if (!dry && (result === 'sent' || result === 'skipped')) {
        weeks[g] = rankDate;
        await admin
          .from('notification_settings')
          .update({ last_ranking_weeks: weeks })
          .eq('user_id', s.user_id);
      }
      // Mark the résumé sent only when the digest actually delivered, so a
      // skipped/failed send retries the résumé on the next cycle.
      if (result === 'sent') {
        for (const f of introFavs.get(g) ?? []) {
          await admin
            .from('favorites')
            .update({ intro_sent: true })
            .eq('user_id', f.user_id)
            .eq('athlete_slug', f.athlete_slug)
            .eq('gender', f.gender);
        }
      }
      if (result === 'sent' || result === 'dry') sent++;
    }
  }

  return json({ ok: true, users: optedIn.length, athletes: distinct.size, sent, dry });
});

async function deliver(
  admin: ReturnType<typeof createClient>,
  channel: EmailChannel,
  email: string,
  payload: EmailPayload,
  meta: { user_id: string; kind: string; period: string },
  dry: boolean,
): Promise<'sent' | 'skipped' | 'error' | 'dry'> {
  if (dry) {
    // Fully side-effect-free: no read or write of notification_deliveries.
    console.log(`[dry] ${meta.kind} -> ${email} (period=${meta.period}): ${payload.subject}`);
    return 'dry';
  }

  // Idempotency: skip only if this (user, kind, period) actually *delivered*.
  // Matching any row would let a logged failure masquerade as a delivery and
  // permanently suppress the retry.
  const { data: existing } = await admin
    .from('notification_deliveries')
    .select('id')
    .eq('user_id', meta.user_id)
    .eq('kind', meta.kind)
    .eq('period', meta.period)
    .eq('status', 'sent')
    .maybeSingle();
  if (existing) return 'skipped';

  try {
    await channel.send(email, payload);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await admin.from('notification_deliveries').insert({
      user_id: meta.user_id,
      kind: meta.kind,
      period: meta.period,
      status: 'error',
      error,
      summary: { subject: payload.subject },
    });
    return 'error';
  }

  await admin.from('notification_deliveries').insert({
    user_id: meta.user_id,
    kind: meta.kind,
    period: meta.period,
    status: 'sent',
    error: null,
    summary: { subject: payload.subject },
  });
  return 'sent';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
