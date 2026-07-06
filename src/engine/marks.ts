import type { Gender, ScoringTable } from '../data/types';

export function availableMarks(table: ScoringTable, gender: Gender): number[] {
  return Object.keys(table.points_by_mark[gender])
    .map(Number)
    .sort((a, b) => b - a);
}
