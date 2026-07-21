// European Athletics API client for the notify-poll edge function.
// Mirrors src/data/rankingApi.ts but runs under Deno and adds a per-athlete
// state assembler. Pure parsers are split out so they are unit-testable.
import type {
  Gender,
  RankingState,
  ResultItem,
  QualificationState,
} from './detectors.ts';

const EA_TRPC = 'https://api.european-athletics.com/trpc';

export type RankingRowLite = {
  europeanPlace: number | null;
  worldPlace: number | null;
  rankingScore: number | null;
  calculationId: number | null;
};

export type RoadToLite = {
  entryNumber: number | null;
  qualifications: Array<{ urlSlug: string; qualified: boolean; qualificationPosition: number | null }>;
};

// Road to Birmingham 2026 (2026 European Athletics Championships). Same IDs as
// src/data/birminghamApi.ts, verified 2026-07-11.
const BIRMINGHAM_COMPETITION_ID = 7192415;
const HIGH_JUMP_EVENT_ID: Record<Gender, number> = { men: 10229615, women: 10229526 };

export interface FetchDeps {
  fetchJson: (url: string) => Promise<unknown>;
}

const realDeps: FetchDeps = {
  async fetchJson(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};

function trpcUrl(proc: string, input: unknown): string {
  return `${EA_TRPC}/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
}

function unwrap(body: unknown): unknown {
  const b = body as { result?: { data?: { json?: unknown } }; error?: unknown };
  if (b?.error) throw new Error('EA tRPC error');
  return b?.result?.data?.json;
}

// --- pure parsers -----------------------------------------------------------

export function parseResults(profile: unknown): ResultItem[] {
  const p = profile as {
    resultsByYear?: { resultsByEvent?: Array<{ results?: Array<Record<string, unknown>> }> };
  };
  const events = p?.resultsByYear?.resultsByEvent;
  if (!Array.isArray(events)) return [];
  const out: ResultItem[] = [];
  for (const ev of events) {
    for (const r of ev.results ?? []) {
      const date = String(r.date ?? '');
      const competition = String(r.competition ?? '');
      const mark = String(r.mark ?? '');
      if (date && mark) out.push({ date, competition, mark });
    }
  }
  return out;
}

export function buildRankingState(
  row: RankingRowLite,
  rankDate: string,
  results: ResultItem[],
  qual: QualificationState | null,
): RankingState {
  return {
    rankDate,
    worldPlace: row.worldPlace,
    europeanPlace: row.europeanPlace,
    rankingScore: row.rankingScore,
    results,
    qualification: qual,
  };
}

export function parseRoadTo(raw: unknown): RoadToLite {
  const r = raw as {
    entryNumber?: number;
    qualifications?: Array<{
      qualified?: boolean;
      qualificationPosition?: number | null;
      competitor?: { urlSlug?: string };
    }>;
  };
  const list = Array.isArray(r?.qualifications) ? r.qualifications : [];
  return {
    entryNumber: typeof r?.entryNumber === 'number' ? r.entryNumber : null,
    qualifications: list
      .filter((q) => q?.competitor?.urlSlug)
      .map((q) => ({
        urlSlug: String(q.competitor!.urlSlug),
        qualified: Boolean(q.qualified),
        qualificationPosition: q.qualificationPosition ?? null,
      })),
  };
}

export function qualificationFor(road: RoadToLite | null, slug: string): QualificationState | null {
  if (!road) return null;
  const entry = road.qualifications.find((q) => q.urlSlug === slug);
  if (!entry) return null;
  return { qualified: entry.qualified, place: entry.qualificationPosition, target: road.entryNumber };
}

// --- IO ---------------------------------------------------------------------

/** Resolve a favorited athlete's slug to their current ranking row by scanning
 *  the ranking list (the EA API has no search procedure). */
async function findRow(
  slug: string,
  gender: Gender,
  deps: FetchDeps,
): Promise<{ row: RankingRowLite; rankDate: string; waId: number | null } | null> {
  const first = unwrap(await deps.fetchJson(trpcUrl('worldAthletics.getRanking', {
    eventGroup: 'high-jump',
    gender,
  }))) as { pages?: number; rankDate?: string; rankings?: Array<Record<string, unknown>> };
  const pages = first?.pages ?? 1;
  const rankDate = String(first?.rankDate ?? '');
  const all = [...(first?.rankings ?? [])];
  for (let page = 2; page <= pages; page++) {
    const next = unwrap(await deps.fetchJson(trpcUrl('worldAthletics.getRanking', {
      eventGroup: 'high-jump',
      gender,
      page,
    }))) as { rankings?: Array<Record<string, unknown>> };
    all.push(...(next?.rankings ?? []));
  }
  const match = all.find((r) => String(r.athleteUrlSlug ?? '') === slug);
  if (!match) return null;
  const waId = Number(String(match.athleteUrlSlug ?? '').match(/-(\d+)$/)?.[1] ?? '') || null;
  return {
    rankDate,
    waId,
    row: {
      europeanPlace: Number(match.place) || null,
      worldPlace: Number(match.worldPlace) || null,
      rankingScore: Number(match.rankingScore) || null,
      calculationId: Number(match.id) || null,
    },
  };
}

/** Fetch the Road to Birmingham qualifying system for a gender (one call covers
 *  every athlete of that gender — the poller fetches this once per gender). */
export async function fetchRoadTo(gender: Gender, deps: FetchDeps = realDeps): Promise<RoadToLite> {
  const raw = unwrap(
    await deps.fetchJson(
      trpcUrl('worldAthletics.getCompetitionQualifyingSystem', {
        competitionId: BIRMINGHAM_COMPETITION_ID,
        eventId: HIGH_JUMP_EVENT_ID[gender],
      }),
    ),
  );
  return parseRoadTo(raw);
}

export async function fetchAthleteState(
  slug: string,
  gender: Gender,
  deps: FetchDeps = realDeps,
  roadTo: RoadToLite | null = null,
): Promise<RankingState | null> {
  const found = await findRow(slug, gender, deps);
  if (!found) return null;

  let results: ResultItem[] = [];
  if (found.waId != null) {
    try {
      const profile = unwrap(
        await deps.fetchJson(trpcUrl('worldAthletics.getAthleteProfile', { id: found.waId })),
      );
      results = parseResults(profile);
    } catch {
      results = []; // graceful degradation — skip results for this athlete
    }
  }

  // Qualification comes from the per-gender road-to system the poller pre-fetched.
  // qualificationFor returns null when roadTo is null (fetch failed) or the athlete
  // isn't in the system — diffQualification then stays quiet. Graceful degradation.
  const qualification = qualificationFor(roadTo, slug);

  return buildRankingState(found.row, found.rankDate, results, qualification);
}
