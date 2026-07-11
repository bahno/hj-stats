/**
 * Client for the "Road to Birmingham" qualification tracker — the 2026 European
 * Athletics Championships (Birmingham, 10-16 Aug 2026) — served by the same
 * undocumented, no-auth EA tRPC gateway used by rankingApi.ts. Verified 2026-07-11.
 */
import { trpc, type Gender } from './rankingApi';
import type { CountryScore } from './types';
import { MAX_PER_COUNTRY } from '../engine/simulate';

const BIRMINGHAM_COMPETITION_ID = 7192415;

const HIGH_JUMP_EVENT_ID: Record<Gender, number> = {
  men: 10229615,
  women: 10229526,
};

export interface QualificationEntry {
  qualifiedBy: string; // e.g. "Qualified by Entry Standard", "In World Rankings quota"
  qualificationTypeId: string; // "q1" | "q4" | "q7" | "n4" | ...
  qualified: boolean;
  qualificationPosition: number | null; // set only when qualified
  countryPosition: number | null;
  competitor: {
    athleteId: number;
    name: string;
    country: string;
    urlSlug: string; // same format as RankingRow.athleteUrlSlug
  };
  withdrawn: boolean;
  rejected: boolean;
  qualificationDetails: {
    label?: string; // e.g. "Defending European Champion"
    result?: string; // entry-standard qualifiers
    venue?: string;
    date?: string;
    place?: number; // world-rankings qualifiers
    score?: number;
    /** The WorldAthletics rankingCalculationId behind `score` — world-rankings qualifiers only. */
    calculationId?: number;
  };
}

export interface RoadToBirmingham {
  entryNumber: number; // total qualifying spots
  entryStandard: string; // e.g. "2.27"
  rankDate: string;
  /** Of entryNumber, how many spots are filled by the world-rankings pool (q4/n4) rather
   *  than entry standard/other fixed routes — the size of the pool that ranking movement
   *  actually competes over. */
  numberOfCompetitorsFilledUpByWorldRankings: number;
  /** The fixed qualifying window this ranking pool's results are drawn from — narrower
   *  than (and can disagree with) the athlete's live rolling World/European ranking
   *  window, which is why the two can count different competitions. */
  firstRankingDay: string;
  lastRankingDay: string;
  qualifications: QualificationEntry[];
}

interface QualifyingSystemResponse {
  entryNumber: number;
  entryStandard: string;
  rankDate: string;
  numberOfCompetitorsFilledUpByWorldRankings: number;
  firstRankingDay: string;
  lastRankingDay: string;
  qualifications: QualificationEntry[];
}

/** Fetch the Road to Birmingham High Jump qualification tracker for a gender. */
export async function fetchRoadToBirmingham(gender: Gender): Promise<RoadToBirmingham> {
  const data = await trpc<QualifyingSystemResponse>('worldAthletics.getCompetitionQualifyingSystem', {
    competitionId: BIRMINGHAM_COMPETITION_ID,
    eventId: HIGH_JUMP_EVENT_ID[gender],
  });
  return {
    entryNumber: data.entryNumber,
    entryStandard: data.entryStandard,
    rankDate: data.rankDate,
    numberOfCompetitorsFilledUpByWorldRankings: data.numberOfCompetitorsFilledUpByWorldRankings,
    firstRankingDay: data.firstRankingDay,
    lastRankingDay: data.lastRankingDay,
    qualifications: data.qualifications,
  };
}

/** Find an athlete's qualification entry by their ranking urlSlug (exact match). */
export function findQualification(
  data: RoadToBirmingham,
  athleteUrlSlug: string,
): QualificationEntry | undefined {
  return data.qualifications.find((q) => q.competitor.urlSlug === athleteUrlSlug);
}

/** The world-rankings-pool entries (`q4`/`n4` with a numeric score), in the API's own
 *  best-to-worst order. */
function poolEntries(data: RoadToBirmingham): QualificationEntry[] {
  return data.qualifications.filter(
    (q) => (q.qualificationTypeId === 'q4' || q.qualificationTypeId === 'n4') && q.qualificationDetails.score != null,
  );
}

/**
 * Scores + countries of the other athletes in the world-rankings pool (qualificationTypeId
 * q4/n4, i.e. those with a numeric score) — the peer set ranking movement actually competes
 * against. Excludes the given athlete and anyone without a numeric score. Countries are
 * needed to apply the pool's max-3-per-country cap (see engine/simulate.ts).
 */
export function worldRankingPoolPeers(
  data: RoadToBirmingham,
  excludeUrlSlug: string,
): CountryScore[] {
  return poolEntries(data)
    .filter((q) => q.competitor.urlSlug !== excludeUrlSlug)
    .map((q) => ({ score: q.qualificationDetails.score as number, country: q.competitor.country }));
}

/**
 * Per-country count of qualifiers already locked in through a fixed route (entry
 * standard, etc.) — every `qualificationTypeId` other than the ranking pool itself
 * (`q4`/`n4`) and the defending-champion exemption (`q7`). These already consume a
 * country's share of the 3-per-country cap before the ranking pool is even considered:
 * verified live against both the 2026 men's (76 pool entries) and women's (68 pool
 * entries) Birmingham High Jump qualifying systems — seeding the pool-quota walk with
 * these counts reproduces every one of the API's own `qualified`/`qualificationPosition`
 * values exactly. Without this, a country with existing entry-standard qualifiers looks
 * like it has more room in the pool than it actually does.
 */
export function countryPreOccupancy(data: RoadToBirmingham): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const q of data.qualifications) {
    if (q.qualificationTypeId === 'q4' || q.qualificationTypeId === 'n4' || q.qualificationTypeId === 'q7') {
      continue;
    }
    counts[q.competitor.country] = (counts[q.competitor.country] ?? 0) + 1;
  }
  return counts;
}

/**
 * An athlete's position in the country-quota-capped qualifying order, computed from
 * their ACTUAL recorded score.
 *
 * Unlike the simulator (`engine/simulate.ts`'s `qualifyingPosition`, used for a
 * *hypothetical* new result), this walks the pool in the API's own returned order rather
 * than re-sorting by score. The API already returns the pool sorted best-to-worst with
 * ties between real athletes resolved somehow (verified live: two Birmingham men's HJ
 * candidates tied at the same score, e.g. score 1078, appear in a fixed, non-alphabetical
 * order) — re-sorting ourselves would have to guess that tiebreak, and guessing wrong
 * shifts a real athlete's position by one. Trusting the given order sidesteps the guess
 * entirely; the per-country cap (seeded from `countryPreOccupancy`) is still applied on
 * top of it. Returns `null` if the athlete isn't in the pool, or is blocked by the quota.
 */
export function qualifyingPoolPosition(data: RoadToBirmingham, urlSlug: string): number | null {
  const pool = poolEntries(data);
  const targetIndex = pool.findIndex((q) => q.competitor.urlSlug === urlSlug);
  if (targetIndex === -1) return null;

  const nonRankingSlots = data.entryNumber - data.numberOfCompetitorsFilledUpByWorldRankings;
  const counts = new Map<string, number>(Object.entries(countryPreOccupancy(data)));
  let rank = 0;
  for (let i = 0; i < pool.length; i++) {
    const country = pool[i].competitor.country;
    const used = counts.get(country) ?? 0;
    if (used >= MAX_PER_COUNTRY) {
      if (i === targetIndex) return null;
      continue;
    }
    counts.set(country, used + 1);
    rank++;
    if (i === targetIndex) return nonRankingSlots + rank;
  }
  return null;
}

/**
 * An athlete's pool rank ignoring the per-country cap entirely — their plain position in
 * the pool's own best-to-worst order, offset by the fixed non-ranking slots. Used to still
 * show a rank for an athlete who's blocked by the country quota (`qualifyingPoolPosition`
 * returns `null` for them): a real, if not officially qualifying, position is more useful
 * than a blank dash. Returns `null` only if the athlete isn't in the pool at all.
 */
export function qualifyingPoolPositionIgnoringQuota(data: RoadToBirmingham, urlSlug: string): number | null {
  const pool = poolEntries(data);
  const targetIndex = pool.findIndex((q) => q.competitor.urlSlug === urlSlug);
  if (targetIndex === -1) return null;
  const nonRankingSlots = data.entryNumber - data.numberOfCompetitorsFilledUpByWorldRankings;
  return nonRankingSlots + targetIndex + 1;
}
