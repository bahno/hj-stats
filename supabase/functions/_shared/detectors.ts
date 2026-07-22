// Pure diff + digest logic for athlete notifications. No IO, no Deno APIs —
// unit-tested with vitest and imported by the notify-poll edge function.

export type Gender = 'men' | 'women';

export interface ResultItem {
  date: string;
  competition: string;
  mark: string;
}

export interface QualificationState {
  qualified: boolean;
  place: number | null;
  target: number | null;
}

export interface RankingState {
  rankDate: string;
  worldPlace: number | null;
  europeanPlace: number | null;
  rankingScore: number | null;
  /** null when the profile fetch failed — "unknown", not "no results". Callers
   *  must leave the stored snapshot results untouched rather than write []. */
  results: ResultItem[] | null;
  qualification: QualificationState | null;
}

export interface Snapshot {
  rank_date: string | null;
  world_place: number | null;
  european_place: number | null;
  ranking_score: number | null;
  results: ResultItem[];
  qualification: QualificationState | null;
}

export interface NotifyPrefs {
  place: boolean;
  score: boolean;
  result: boolean;
  qualification: boolean;
}

export interface PlaceChange {
  scope: 'world' | 'european';
  from: number | null;
  to: number | null;
  direction: 'up' | 'down';
}

export interface ScoreChange {
  from: number | null;
  to: number | null;
  delta: number;
}

export interface QualChange {
  from: boolean;
  to: boolean;
  place: number | null;
  target: number | null;
}

/** A one-time "here's where they stand" snapshot, sent the first time a newly
 *  followed athlete's ranking updates (then future updates are change-only). */
export interface Standing {
  europeanPlace: number | null;
  worldPlace: number | null;
  score: number | null;
  qualified: boolean | null;
  qualPlace: number | null;
  qualTarget: number | null;
  seasonBest: string | null;
}

export interface AthleteEvents {
  slug: string;
  name: string;
  gender: Gender;
  results: ResultItem[];
  place: PlaceChange[];
  score: ScoreChange | null;
  qualification: QualChange | null;
  /** When set, the ranking digest renders this résumé for the athlete instead
   *  of their deltas (the one-time intro on first follow). */
  intro?: Standing | null;
}

export interface EmailPayload {
  subject: string;
  html: string;
  text: string;
  /** Set by `appendUnsubscribe`; becomes the RFC 8058 List-Unsubscribe header. */
  unsubscribeUrl?: string;
}

export function resultKey(r: ResultItem): string {
  return `${r.date}|${r.competition}|${r.mark}`;
}

export function diffResults(prev: ResultItem[], curr: ResultItem[]): ResultItem[] {
  const seen = new Set(prev.map(resultKey));
  return curr.filter((r) => !seen.has(resultKey(r)));
}

/** Highest jump among a result list (marks like "2.30"), as the original mark
 *  string. null when there are no numeric marks. */
export function seasonBest(results: ResultItem[]): string | null {
  let best = -Infinity;
  let bestMark: string | null = null;
  for (const r of results) {
    const n = parseFloat(r.mark);
    if (!Number.isNaN(n) && n > best) {
      best = n;
      bestMark = r.mark;
    }
  }
  return bestMark;
}

function placeChange(
  scope: 'world' | 'european',
  from: number | null,
  to: number | null,
): PlaceChange | null {
  if (to == null || from == null || from === to) return null;
  return { scope, from, to, direction: to < from ? 'up' : 'down' };
}

export function diffPlace(prev: Snapshot, curr: RankingState): PlaceChange[] {
  const out: PlaceChange[] = [];
  const eu = placeChange('european', prev.european_place, curr.europeanPlace);
  if (eu) out.push(eu);
  const w = placeChange('world', prev.world_place, curr.worldPlace);
  if (w) out.push(w);
  return out;
}

export function diffScore(prev: Snapshot, curr: RankingState): ScoreChange | null {
  const to = curr.rankingScore;
  const from = prev.ranking_score;
  if (to == null || from == null || from === to) return null;
  return { from, to, delta: Math.round((to - from) * 100) / 100 };
}

export function diffQualification(prev: Snapshot, curr: RankingState): QualChange | null {
  const now = curr.qualification;
  const was = prev.qualification;
  if (!now || !was) return null;
  if (now.qualified === was.qualified) return null;
  return { from: was.qualified, to: now.qualified, place: now.place, target: now.target };
}

// --- outbox merging ---------------------------------------------------------
// A digest that failed to send is parked in notification_outbox and merged with
// the next run's events. Merging composes the two into what a single digest
// would have said all along: A→B followed by B→C reads as A→C, and a change
// that reverted (A→B→A) drops out entirely rather than reporting a no-op.

function mergePlaces(a: PlaceChange[], b: PlaceChange[]): PlaceChange[] {
  const out: PlaceChange[] = [];
  // Iterate scopes in diffPlace's order so merged digests read identically.
  for (const scope of ['european', 'world'] as const) {
    const pa = a.find((p) => p.scope === scope);
    const pb = b.find((p) => p.scope === scope);
    if (!pa || !pb) {
      const only = pa ?? pb;
      if (only) out.push(only);
      continue;
    }
    const { from } = pa;
    const { to } = pb;
    if (from == null || to == null || from === to) continue; // moved and moved back
    out.push({ scope, from, to, direction: to < from ? 'up' : 'down' });
  }
  return out;
}

function mergeScores(a: ScoreChange | null, b: ScoreChange | null): ScoreChange | null {
  if (!a || !b) return a ?? b;
  const { from } = a;
  const { to } = b;
  if (from == null || to == null || from === to) return null;
  return { from, to, delta: Math.round((to - from) * 100) / 100 };
}

function mergeQuals(a: QualChange | null, b: QualChange | null): QualChange | null {
  if (!a || !b) return a ?? b;
  if (a.from === b.to) return null; // dropped out and came back (or vice versa)
  return { from: a.from, to: b.to, place: b.place, target: b.target };
}

function mergeAthlete(a: AthleteEvents, b: AthleteEvents): AthleteEvents {
  const results = [...a.results];
  const seen = new Set(a.results.map(resultKey));
  for (const r of b.results) {
    if (seen.has(resultKey(r))) continue;
    seen.add(resultKey(r));
    results.push(r);
  }
  return {
    slug: b.slug,
    name: b.name || a.name,
    gender: b.gender,
    results,
    place: mergePlaces(a.place, b.place),
    score: mergeScores(a.score, b.score),
    qualification: mergeQuals(a.qualification, b.qualification),
    // A résumé owed from an earlier run is still owed until it actually sends.
    intro: a.intro ?? b.intro ?? null,
  };
}

/**
 * Fold an undelivered event set (`prev`) together with this run's (`next`).
 * Athletes present in only one side pass through untouched.
 */
export function mergeEvents(prev: AthleteEvents[], next: AthleteEvents[]): AthleteEvents[] {
  const byKey = new Map<string, AthleteEvents>();
  for (const e of prev) byKey.set(`${e.gender}:${e.slug}`, e);
  for (const e of next) {
    const k = `${e.gender}:${e.slug}`;
    const existing = byKey.get(k);
    byKey.set(k, existing ? mergeAthlete(existing, e) : e);
  }
  return [...byKey.values()];
}

export function filterByPrefs(ev: AthleteEvents, prefs: NotifyPrefs): AthleteEvents {
  return {
    ...ev,
    results: prefs.result ? ev.results : [],
    place: prefs.place ? ev.place : [],
    score: prefs.score ? ev.score : null,
    qualification: prefs.qualification ? ev.qualification : null,
  };
}

/** HTML-escape for email bodies. Quotes are escaped too so interpolating into
 *  an attribute (not done today) can't break out of it later. */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const CAP: Record<'world' | 'european', string> = { world: 'World', european: 'European' };

function renderStanding(s: Standing): string {
  const eu = s.europeanPlace ?? '—';
  const w = s.worldPlace ?? '—';
  const score = s.score ?? '—';
  const qual =
    s.qualified === true
      ? `, inside the quota (${s.qualPlace ?? '—'} of ${s.qualTarget ?? '—'})`
      : s.qualified === false
        ? ', outside the quota'
        : '';
  return `now following — European #${eu}, World #${w}, score ${score}${qual}; season best ${s.seasonBest ?? '—'}`;
}

export function buildResultsDigest(userName: string, events: AthleteEvents[]): EmailPayload | null {
  const withResults = events.filter((e) => e.results.length > 0);
  if (withResults.length === 0) return null;

  const lines: string[] = [];
  const htmlItems: string[] = [];
  for (const e of withResults) {
    for (const r of e.results) {
      lines.push(`- ${e.name}: ${r.mark} at ${r.competition} (${r.date})`);
      htmlItems.push(
        `<li><strong>${esc(e.name)}</strong>: ${esc(r.mark)} at ${esc(r.competition)} <em>(${esc(r.date)})</em></li>`,
      );
    }
  }
  const text = `Hi ${userName},\n\nNew results from athletes you follow:\n\n${lines.join('\n')}`;
  const html = `<p>Hi ${esc(userName)},</p><p>New results from athletes you follow:</p><ul>${htmlItems.join('')}</ul>`;
  return { subject: `New results: ${withResults.length} of your athletes competed`, html, text };
}

export function buildRankingDigest(userName: string, events: AthleteEvents[]): EmailPayload | null {
  const lines: string[] = [];
  const htmlItems: string[] = [];

  for (const e of events) {
    // One-time résumé takes precedence over deltas for a newly followed athlete.
    if (e.intro) {
      const summary = renderStanding(e.intro);
      lines.push(`- ${e.name}: ${summary}`);
      htmlItems.push(`<li><strong>${esc(e.name)}</strong>: ${esc(summary)}</li>`);
      continue;
    }
    const parts: string[] = [];
    for (const p of e.place) {
      parts.push(`${CAP[p.scope]} rank ${p.from} → ${p.to} (${p.direction})`);
    }
    if (e.score) parts.push(`score ${e.score.from} → ${e.score.to} (${e.score.delta >= 0 ? '+' : ''}${e.score.delta})`);
    if (e.qualification) {
      parts.push(e.qualification.to ? 'now inside the qualification quota' : 'dropped out of the qualification quota');
    }
    if (parts.length === 0) continue;
    lines.push(`- ${e.name}: ${parts.join('; ')}`);
    htmlItems.push(`<li><strong>${esc(e.name)}</strong>: ${esc(parts.join('; '))}</li>`);
  }

  if (lines.length === 0) return null;
  const text = `Hi ${userName},\n\nRanking updates for athletes you follow:\n\n${lines.join('\n')}`;
  const html = `<p>Hi ${esc(userName)},</p><p>Ranking updates for athletes you follow:</p><ul>${htmlItems.join('')}</ul>`;
  const noun = lines.length === 1 ? 'athlete' : 'athletes';
  return { subject: `Ranking update: ${lines.length} ${noun}`, html, text };
}
