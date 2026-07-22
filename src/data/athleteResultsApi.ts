/**
 * Client for WorldAthletics' public GraphQL API — the athlete-profile "results by year"
 * feed that backs worldathletics.org's own profile pages. Unlike the European Athletics
 * tRPC gateway (rankingApi.ts), this returns an athlete's *full* result list, not just the
 * 5 that currently count toward the ranking — which is what lets us reconstruct the pool and
 * find the "next best" result behind the counting set (see engine/counting.ts).
 *
 * The endpoint + api-key are the public ones the WA site ships in its own client bundle;
 * CORS is open to any origin (verified 2026-07-14). Schema/host/key can change without
 * notice — callers must handle failure gracefully.
 */
import { HttpError, withRetry } from './retry';

const WA_GRAPHQL = 'https://graphql-prod-4877.edge.aws.worldathletics.org/graphql';
const WA_API_KEY = 'da2-tzmostylynabpfkrgbmmml4toq';

const RESULTS_BY_YEAR_QUERY = `query GetSingleCompetitorResultsDate($id: Int, $resultsByYear: Int, $resultsByYearOrderBy: String) {
  getSingleCompetitorResultsDate(id: $id, resultsByYear: $resultsByYear, resultsByYearOrderBy: $resultsByYearOrderBy) {
    activeYears
    resultsByDate {
      date
      competition
      competitionId
      discipline
      category
      race
      place
      mark
      notLegal
      resultScore
    }
  }
}`;

/** One result row from an athlete's profile results feed. */
export interface AthleteResult {
  date: string; // "16 SEP 2025"
  competition: string;
  competitionId: string;
  discipline: string; // "High Jump" (indoor and outdoor alike)
  category: string; // OW/DF/GW/GL/A-F
  race: string; // "F" for finals; "Q1"/"Q2" qualification rounds
  place: string; // "1.", "4.", ...
  mark: string;
  notLegal: boolean;
  resultScore: number; // mark/performance-only points
}

interface ResultsByDateResponse {
  getSingleCompetitorResultsDate: {
    activeYears: string[];
    resultsByDate: AthleteResult[];
  } | null;
}

/**
 * The WorldAthletics numeric athlete id, taken from the trailing digits of a ranking
 * `athleteUrlSlug` (e.g. "ukraine/oleh-doroshchuk-14803002" -> 14803002). `null` when the
 * slug has no trailing id (nothing we can query).
 */
export function athleteIdFromSlug(urlSlug: string): number | null {
  const m = urlSlug.match(/-(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Without a cap, a hung response leaves the result table spinning forever. */
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchResultsForYear(athleteId: number, year: number): Promise<AthleteResult[]> {
  try {
    return await withRetry(async () => {
      const res = await fetch(WA_GRAPHQL, {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'content-type': 'application/json', 'x-api-key': WA_API_KEY },
        body: JSON.stringify({
          operationName: 'GetSingleCompetitorResultsDate',
          query: RESULTS_BY_YEAR_QUERY,
          variables: { id: athleteId, resultsByYear: year, resultsByYearOrderBy: 'date' },
        }),
      });
      if (!res.ok) {
        throw new HttpError(res.status, `getSingleCompetitorResultsDate: HTTP ${res.status}`);
      }
      const body = await res.json();
      // GraphQL answered with an error — the server is up, so don't retry.
      if (body?.errors?.length) {
        throw new HttpError(400, body.errors[0]?.message ?? 'results query error');
      }
      const data = (body.data as ResultsByDateResponse | undefined)?.getSingleCompetitorResultsDate;
      return data?.resultsByDate ?? [];
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new Error("getSingleCompetitorResultsDate: the results service didn't respond in time");
    }
    throw e;
  }
}

/**
 * An athlete's High Jump results across the given calendar years, merged. Only High Jump
 * rows are kept (an athlete's profile can carry other disciplines); everything else —
 * finals filtering, windowing, scoring — is left to engine/counting.ts. Years are fetched
 * in parallel; one year's failure fails the whole call, so callers should catch and degrade.
 */
export async function fetchAthleteHighJumpResults(
  athleteId: number,
  years: number[],
): Promise<AthleteResult[]> {
  const perYear = await Promise.all(years.map((y) => fetchResultsForYear(athleteId, y)));
  return perYear.flat().filter((r) => r.discipline === 'High Jump');
}
