import type { Gender, ScoringTable } from '../data/types';
import type { EventGroup } from '../data/events';

/**
 * Whether the loaded scoring table can turn a mark into performance points for this
 * event group. It covers high jump only today — pipeline/parse_scoring.py extracts
 * that one column — so anything that simulates a mark has to ask first rather than
 * silently scoring a 100m off the high jump table. The table names its event with an
 * underscore ("high_jump") where the ranking API uses a hyphen.
 */
export function hasScoringTable(table: ScoringTable, group: EventGroup): boolean {
  return table.event.replace(/_/g, '-') === group.slug;
}

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
