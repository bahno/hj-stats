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
  results: ResultItem[];
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

export interface AthleteEvents {
  slug: string;
  name: string;
  gender: Gender;
  results: ResultItem[];
  place: PlaceChange[];
  score: ScoreChange | null;
  qualification: QualChange | null;
}

export interface EmailPayload {
  subject: string;
  html: string;
  text: string;
}

export function resultKey(r: ResultItem): string {
  return `${r.date}|${r.competition}|${r.mark}`;
}

export function diffResults(prev: ResultItem[], curr: ResultItem[]): ResultItem[] {
  const seen = new Set(prev.map(resultKey));
  return curr.filter((r) => !seen.has(resultKey(r)));
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

export function filterByPrefs(ev: AthleteEvents, prefs: NotifyPrefs): AthleteEvents {
  return {
    ...ev,
    results: prefs.result ? ev.results : [],
    place: prefs.place ? ev.place : [],
    score: prefs.score ? ev.score : null,
    qualification: prefs.qualification ? ev.qualification : null,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

const CAP: Record<'world' | 'european', string> = { world: 'World', european: 'European' };

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
  return { subject: `Ranking update: ${lines.length} of your athletes moved`, html, text };
}
