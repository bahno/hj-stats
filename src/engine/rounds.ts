/**
 * Which round a result belongs to, in the sense the placing tables mean.
 *
 * World Athletics' `race` code says what kind of round it was, but the placing tables
 * ask a different question: was this "the round before the Final"? That depends on what
 * else ran at the same competition. Heats, semi-final, final -> the semi-final is the
 * round before the final and the heat scores nothing. Heats then final -> the heat is.
 *
 * So classification is a property of the whole result set, not of one row, and it is
 * scoped per competition AND per discipline: an athlete can contest a high jump
 * qualification and a sprint heat at the same meeting.
 */

export type RoundKind = 'final' | 'beforeFinal' | 'other';

export interface RoundedResult {
  competitionId?: string;
  discipline: string;
  race: string;
}

/** Seniority of a non-final round. Higher is closer to the final. */
const ROUND_SENIORITY: Array<{ prefix: string; rank: number }> = [
  { prefix: 'SF', rank: 3 }, // semi-final
  { prefix: 'Q', rank: 2 },  // field-event qualification
  { prefix: 'H', rank: 1 },  // heat
];

function isFinal(race: string): boolean {
  // "F", and flighted finals "F1"/"F2" — but not "FN" style codes we don't know.
  return /^F\d*$/i.test(race.trim());
}

function seniority(race: string): number {
  const code = race.trim().toUpperCase();
  for (const { prefix, rank } of ROUND_SENIORITY) {
    if (code.startsWith(prefix)) return rank;
  }
  return 0;
}

function bucketKey(result: RoundedResult): string {
  return `${result.competitionId ?? ''}|${result.discipline}`;
}

/**
 * Classify every result. Within each competition-and-discipline bucket, the non-final
 * round with the highest seniority is the round before the final; any less senior round
 * scores nothing.
 */
export function classifyRounds<T extends RoundedResult>(results: T[]): Map<T, RoundKind> {
  const topByBucket = new Map<string, number>();
  for (const result of results) {
    if (isFinal(result.race)) continue;
    const rank = seniority(result.race);
    if (rank === 0) continue;
    const key = bucketKey(result);
    topByBucket.set(key, Math.max(topByBucket.get(key) ?? 0, rank));
  }

  const kinds = new Map<T, RoundKind>();
  for (const result of results) {
    if (isFinal(result.race)) {
      kinds.set(result, 'final');
      continue;
    }
    const rank = seniority(result.race);
    const top = topByBucket.get(bucketKey(result)) ?? 0;
    kinds.set(result, rank > 0 && rank === top ? 'beforeFinal' : 'other');
  }
  return kinds;
}

/**
 * Whether the athlete went on to the final at the same competition and discipline —
 * which is what the placing tables' "Q or q to Final" row is asking.
 */
export function advancedToFinal(result: RoundedResult, results: RoundedResult[]): boolean {
  const key = bucketKey(result);
  return results.some((r) => r !== result && isFinal(r.race) && bucketKey(r) === key);
}
