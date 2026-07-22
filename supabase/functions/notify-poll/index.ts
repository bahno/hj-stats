// Daily Supabase-Cron poller. For every favorited athlete of an opted-in user,
// fetch current EA state, diff against the stored snapshot, and email per-user
// digests: new results daily; ranking changes only when a new rankDate appears.
//
// Not a public endpoint: the caller must present CRON_SECRET. Deploy with
// --no-verify-jwt so that secret is the only gate (the project's anon key is
// public, so JWT verification alone would let any visitor trigger a run).

// Pinned exactly: an unpinned @2 lets a dependency change ship to production
// without any commit here. Bump deliberately, alongside the npm dependency.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.8';
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
  mergeEvents,
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

/** How long an undelivered digest stays worth retrying before it's dropped. */
const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build the service-role client. Helpers take `Admin` rather than
 * `ReturnType<typeof createClient>`: the latter instantiates createClient's
 * *default* type parameters, which resolve the schema to `never` and make every
 * `.from(...).insert({...})` a type error.
 */
function createAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}
type Admin = ReturnType<typeof createAdmin>;

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
  const admin = createAdmin();
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

  // Digests owed from earlier runs that never reached their recipient. Merged
  // into this run's events below, so a failed send is genuinely retried rather
  // than lost when the global snapshot moves on without it.
  const { data: outboxRows, error: outboxError } = await admin
    .from('notification_outbox')
    .select('user_id, kind, period, events, updated_at')
    .in('user_id', userIds);
  if (outboxError) console.error('notification_outbox query failed:', outboxError);
  const pending = new Map<string, { period: string; events: AthleteEvents[] }>();
  const staleBefore = Date.now() - OUTBOX_TTL_MS;
  const stale: Array<{ user_id: string; kind: string }> = [];
  for (const r of outboxRows ?? []) {
    // Age out anything that has been failing (or was orphaned by an
    // unsubscribe) for long enough that sending it would just be confusing.
    if (new Date(r.updated_at).getTime() < staleBefore) {
      stale.push({ user_id: r.user_id, kind: r.kind });
      continue;
    }
    pending.set(`${r.user_id}|${r.kind}`, {
      period: r.period,
      events: (r.events ?? []) as AthleteEvents[],
    });
  }
  if (!dry) {
    for (const s of stale) {
      console.warn(`dropping stale outbox entry: ${s.user_id} ${s.kind}`);
      await admin
        .from('notification_outbox')
        .delete()
        .eq('user_id', s.user_id)
        .eq('kind', s.kind);
    }
  }

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
    for (const f of myFavs) {
      const k2 = key(f.athlete_slug, f.gender);
      const ev = athleteEvents.get(k2);
      if (!ev) continue;
      const ue = filterByPrefs(ev, f.notify_prefs as NotifyPrefs);
      // One-time résumé on the first ranking update after this favorite was
      // starred. It rides along with that gender's ranking digest and is only
      // marked sent once that digest reaches the user.
      if (!f.intro_sent && rankAdvancedByKey.get(k2)) {
        const standing = standingByKey.get(k2);
        if (standing) ue.intro = standing;
      }
      events.push(ue);
    }

    // Daily results digest — idempotent per (user, 'results', today).
    const pendingResults = pending.get(`${s.user_id}|results`);
    if (s.last_results_date !== today || pendingResults) {
      const merged = mergeEvents(pendingResults?.events ?? [], events);
      const digest = buildResultsDigest(name, merged);
      if (digest) {
        const result = await deliver(admin, channel, email, appendUnsubscribe(digest, unsubUrl), {
          user_id: s.user_id,
          kind: 'results',
          period: today,
        }, dry);
        if (!dry) {
          if (result === 'error') {
            // Park it: the snapshot has already moved on, so without this the
            // next run would have nothing left to diff and would send nothing.
            await saveOutbox(admin, s.user_id, 'results', today, merged);
          } else {
            await clearOutbox(admin, s.user_id, 'results');
            await admin.from('notification_settings').update({ last_results_date: today }).eq('user_id', s.user_id);
          }
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
      const outboxKind = `ranking:${g}`;
      const pendingRanking = pending.get(`${s.user_id}|${outboxKind}`);
      const isNewWeek = Boolean(rankDate) && weeks[g] !== rankDate;
      if (!isNewWeek && !pendingRanking) continue;

      const merged = mergeEvents(
        pendingRanking?.events ?? [],
        events.filter((e) => e.gender === g),
      );
      const digest = buildRankingDigest(name, merged);
      if (!digest) continue;
      // A run that couldn't reach the ranking API still knows which period a
      // parked digest belongs to.
      const period = rankDate ?? pendingRanking?.period;
      if (!period) continue;

      const result = await deliver(admin, channel, email, appendUnsubscribe(digest, unsubUrl), {
        user_id: s.user_id,
        kind: 'ranking',
        period: `${g}:${period}`,
      }, dry);

      if (!dry) {
        if (result === 'error') {
          await saveOutbox(admin, s.user_id, outboxKind, period, merged);
        } else {
          await clearOutbox(admin, s.user_id, outboxKind);
          if (rankDate) {
            weeks[g] = rankDate;
            await admin
              .from('notification_settings')
              .update({ last_ranking_weeks: weeks })
              .eq('user_id', s.user_id);
          }
        }
      }

      // Mark the résumé sent only once it has actually reached the user. Read
      // it off the merged events, not this run's: a résumé carried over from a
      // failed run is still owed even though nothing recomputed it today.
      if (result === 'sent') {
        const owed = new Set(merged.filter((e) => e.intro).map((e) => e.slug));
        for (const f of myFavs) {
          if (f.gender !== g || f.intro_sent || !owed.has(f.athlete_slug)) continue;
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

  // Report what was actually reachable, not just what was attempted. Without
  // rankDates/skipped, a run where every EA fetch failed is indistinguishable
  // from a healthy quiet day: both report sent: 0.
  return json({
    ok: true,
    users: optedIn.length,
    athletes: distinct.size,
    resolved: athleteEvents.size,
    skipped: distinct.size - athleteEvents.size,
    rankDates: Object.fromEntries(rankDateByGender),
    sent,
    dry,
  });
});

/** Park an undelivered digest for the next run to merge into and retry. */
async function saveOutbox(
  admin: Admin,
  userId: string,
  kind: string,
  period: string,
  events: AthleteEvents[],
): Promise<void> {
  const { error } = await admin.from('notification_outbox').upsert(
    { user_id: userId, kind, period, events, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,kind' },
  );
  // Worth shouting about: losing this row is what silently drops a digest.
  if (error) console.error(`outbox save failed for ${userId} ${kind}:`, error);
}

async function clearOutbox(
  admin: Admin,
  userId: string,
  kind: string,
): Promise<void> {
  const { error } = await admin
    .from('notification_outbox')
    .delete()
    .eq('user_id', userId)
    .eq('kind', kind);
  if (error) console.error(`outbox clear failed for ${userId} ${kind}:`, error);
}

async function deliver(
  admin: Admin,
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
