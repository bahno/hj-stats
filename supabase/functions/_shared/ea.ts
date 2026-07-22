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

/** Outbound calls to EA get a hard timeout: a hung response would otherwise
 *  block the poller until the platform kills the whole run. */
const FETCH_TIMEOUT_MS = 10_000;

const realDeps: FetchDeps = {
  async fetchJson(url: string) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'hj-stats-notify-poll/1.0 (+https://github.com/bahno/hj-stats)' },
    });
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

/**
 * An athlete's current-season results from `worldAthletics.getAthleteProfile`.
 *
 * The payload puts them at `results.categories[]`, grouped by discipline, each
 * holding that discipline's results for the profile's default (latest) year —
 * which is exactly the season we want. `results.years` lists the other years
 * available, but nothing here needs them.
 *
 * This previously read `resultsByYear.resultsByEvent`, a shape the endpoint has
 * never returned (verified 2026-07-22, with and without a resultsByYear input).
 * It therefore returned [] for every athlete: season best always rendered as
 * "—", and diffResults never saw a new result, so the daily results digest
 * could not fire at all.
 */
export function parseResults(profile: unknown): ResultItem[] {
  const p = profile as {
    results?: {
      categories?: Array<{ discipline?: string; results?: Array<Record<string, unknown>> }>;
    };
  };
  const categories = p?.results?.categories;
  if (!Array.isArray(categories)) return [];
  const out: ResultItem[] = [];
  for (const c of categories) {
    // Profiles carry other disciplines too (relays, sprints) — mirror the
    // frontend's High Jump filter so a relay leg can't become a season best.
    if (c?.discipline !== 'High Jump') continue;
    for (const r of c.results ?? []) {
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
  results: ResultItem[] | null,
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

/** A gender's whole ranking list, indexed by athlete slug. The EA API has no
 *  search procedure, so resolving a slug means scanning the list — fetch and
 *  index it *once per gender* rather than once per athlete. */
export interface RankingIndex {
  rankDate: string;
  bySlug: Map<string, { row: RankingRowLite; waId: number | null }>;
}

/** Fetch and index every page of a gender's high-jump ranking (one call site
 *  per poller run, per gender). */
export async function fetchRankingIndex(
  gender: Gender,
  deps: FetchDeps = realDeps,
): Promise<RankingIndex> {
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

  const bySlug = new Map<string, { row: RankingRowLite; waId: number | null }>();
  for (const r of all) {
    const slug = String(r.athleteUrlSlug ?? '');
    if (!slug) continue;
    bySlug.set(slug, {
      waId: Number(slug.match(/-(\d+)$/)?.[1] ?? '') || null,
      row: {
        europeanPlace: Number(r.place) || null,
        worldPlace: Number(r.worldPlace) || null,
        rankingScore: Number(r.rankingScore) || null,
        calculationId: Number(r.id) || null,
      },
    });
  }
  return { rankDate, bySlug };
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

/**
 * Assemble one athlete's current state from the pre-fetched per-gender ranking
 * index (see `fetchRankingIndex`) plus their profile results. Returns null when
 * the athlete has no row in the ranking at all.
 */
export async function fetchAthleteState(
  slug: string,
  index: RankingIndex,
  roadTo: RoadToLite | null = null,
  deps: FetchDeps = realDeps,
): Promise<RankingState | null> {
  const found = index.bySlug.get(slug);
  if (!found) return null;

  // null (not []) when the profile fetch fails: an empty list would be written
  // to the snapshot as "this athlete has no results", and every past result
  // would then re-surface as new on the next successful run. The caller must
  // treat null as "unknown — leave the stored results alone".
  let results: ResultItem[] | null = null;
  if (found.waId != null) {
    try {
      const profile = unwrap(
        await deps.fetchJson(trpcUrl('worldAthletics.getAthleteProfile', { id: found.waId })),
      );
      results = parseResults(profile);
    } catch {
      results = null; // graceful degradation — this run just can't see results
    }
  }

  // Qualification comes from the per-gender road-to system the poller pre-fetched.
  // qualificationFor returns null when roadTo is null (fetch failed) or the athlete
  // isn't in the system — diffQualification then stays quiet. Graceful degradation.
  const qualification = qualificationFor(roadTo, slug);

  return buildRankingState(found.row, index.rankDate, results, qualification);
}
