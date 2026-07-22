/**
 * Client for the (undocumented, no-auth) European Athletics tRPC gateway, which
 * re-serves World Athletics ranking data with CORS open to any origin. Verified
 * 2026-07-07. Schemas/host can change without notice — callers should handle
 * failure gracefully.
 */
const EA_TRPC = 'https://api.european-athletics.com/trpc';

/** Without a cap, a hung response leaves the UI on "Searching…" indefinitely. */
const REQUEST_TIMEOUT_MS = 15_000;

export async function trpc<T>(proc: string, input: unknown): Promise<T> {
  const query = encodeURIComponent(JSON.stringify({ json: input }));
  let res: Response;
  try {
    res = await fetch(`${EA_TRPC}/${proc}?input=${query}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // A bare "signal is aborted without reason" tells the user nothing.
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new Error(`${proc}: the ranking service didn't respond in time`);
    }
    throw e;
  }
  if (!res.ok) throw new Error(`${proc}: HTTP ${res.status}`);
  const body = await res.json();
  if (body?.error) throw new Error(body.error?.json?.message ?? `${proc} error`);
  return body.result.data.json as T;
}

export type Gender = 'men' | 'women';
export type RankingType = 'world' | 'european' | 'road';

export interface RankingRow {
  /** Also the WorldAthletics rankingCalculationId — pass to fetchRankingCalculation. */
  id: number;
  place: number; // European ranking place
  worldPlace: number;
  athlete: string;
  athleteUrlSlug: string;
  nationality: string;
  rankingScore: number;
  previousPlace: number | null;
  previousRankingScore: number | null;
}

interface RankingResponse {
  page: number;
  pages: number;
  rankDate: string;
  eventGroup: string;
  rankings: RankingRow[];
}

/** Fetch the full High Jump ranking for a gender (all pages). */
export async function fetchHighJumpRanking(
  gender: Gender,
): Promise<{ rankDate: string; rows: RankingRow[] }> {
  const first = await trpc<RankingResponse>('worldAthletics.getRanking', {
    eventGroup: 'high-jump',
    gender,
  });
  const rows = [...first.rankings];
  for (let page = 2; page <= first.pages; page++) {
    const next = await trpc<RankingResponse>('worldAthletics.getRanking', {
      eventGroup: 'high-jump',
      gender,
      page,
    });
    rows.push(...next.rankings);
  }
  return { rankDate: first.rankDate, rows };
}

/**
 * One of the competitions that actually count toward the ranking.
 *
 * The API field names are misleading — verified against the data:
 *   performanceScore = the COMBINED counting score (this is what's averaged)
 *   resultScore      = the mark/performance-only points
 *   placingScore     = the placing points
 * i.e. performanceScore === resultScore + placingScore.
 */
export interface CountingResult {
  date: string;
  competition: string;
  discipline: string;
  category: string; // OW, DF, GW, GL, A-F
  race: string;
  place: string; // "1.", "4.", ...
  mark: string;
  performanceScore: number; // combined counting score (mark points + placing)
  resultScore: number; // mark/performance-only points
  placingScore: number; // placing points
}

export interface RankingCalculation {
  /** Average of the counting results' combined scores — equals the ranking score. */
  averagePerformanceScore: number;
  disciplineList: string[];
  results: CountingResult[];
}

/**
 * The official WorldAthletics breakdown: the exact competitions averaged into
 * the ranking score. `calculationId` is the `id` from a RankingRow.
 */
export async function fetchRankingCalculation(calculationId: number): Promise<RankingCalculation> {
  return trpc<RankingCalculation>('worldAthletics.getRankingScoreCalculation', { calculationId });
}
