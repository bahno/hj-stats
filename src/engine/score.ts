import type { CategoryCode, Gender, PlacingPoints, ScoringTable } from '../data/types';

/** Normalizes a height in metres to the table key format, e.g. 2.3 -> "2.30". */
export function markKey(heightMeters: number): string {
  return heightMeters.toFixed(2);
}

export function performanceScore(
  table: ScoringTable,
  gender: Gender,
  heightMeters: number,
): number {
  const key = markKey(heightMeters);
  const points = table.points_by_mark[gender][key];
  if (points === undefined) {
    throw new Error(`No scoring-table entry for ${gender} high jump at ${key} m`);
  }
  return points;
}

export function placingScore(
  placing: PlacingPoints,
  category: CategoryCode,
  position: number,
): number {
  return placing.final[category][String(position)] ?? 0;
}
