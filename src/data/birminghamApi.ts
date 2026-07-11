/**
 * Client for the "Road to Birmingham" qualification tracker — the 2026 European
 * Athletics Championships (Birmingham, 10-16 Aug 2026) — served by the same
 * undocumented, no-auth EA tRPC gateway used by rankingApi.ts. Verified 2026-07-11.
 */
import { trpc, type Gender } from './rankingApi';
import type { CountryScore } from './types';

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
  return data.qualifications
    .filter(
      (q) =>
        q.competitor.urlSlug !== excludeUrlSlug &&
        (q.qualificationTypeId === 'q4' || q.qualificationTypeId === 'n4') &&
        q.qualificationDetails.score != null,
    )
    .map((q) => ({ score: q.qualificationDetails.score as number, country: q.competitor.country }));
}
