import type { Gender, ScoringTable } from '../data/types';

export function availableMarks(table: ScoringTable, gender: Gender): number[] {
  return Object.keys(table.points_by_mark[gender])
    .map(Number)
    .sort((a, b) => b - a);
}

/** Default height (metres) shown when a gender is selected. */
export const DEFAULT_HEIGHT: Record<Gender, number> = {
  men: 2.1,
  women: 1.8,
};

/** The gender's default height if present in the table, otherwise the closest available mark. */
export function defaultHeightFor(table: ScoringTable, gender: Gender): number {
  const marks = availableMarks(table, gender);
  const target = DEFAULT_HEIGHT[gender];
  if (marks.includes(target)) return target;
  return marks.reduce(
    (best, m) => (Math.abs(m - target) < Math.abs(best - target) ? m : best),
    marks[0],
  );
}
