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
  const byGender = table.points_by_mark[gender];
  if (byGender === undefined) {
    throw new Error(`No ${table.event} scoring-table entries for ${gender}`);
  }
  const points = byGender[key];
  if (points === undefined) {
    throw new Error(`No ${table.event} scoring-table entry for ${gender} at ${key} m`);
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

export interface ScoreBreakdown {
  performance: number;
  placing: number;
  total: number;
}

export function resultScore(
  table: ScoringTable,
  placing: PlacingPoints,
  gender: Gender,
  heightMeters: number,
  position: number,
  category: CategoryCode,
): ScoreBreakdown {
  const performance = performanceScore(table, gender, heightMeters);
  const placingPts = placingScore(placing, category, position);
  return { performance, placing: placingPts, total: performance + placingPts };
}

export interface CategoryScore extends ScoreBreakdown {
  category: CategoryCode;
}

export function compareCategories(
  table: ScoringTable,
  placing: PlacingPoints,
  gender: Gender,
  heightMeters: number,
  position: number,
  categories: CategoryCode[],
): CategoryScore[] {
  return categories.map((category) => ({
    category,
    ...resultScore(table, placing, gender, heightMeters, position, category),
  }));
}
