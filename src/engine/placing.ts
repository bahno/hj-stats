/**
 * Placing points, across the full 2026 Track & Field table set.
 *
 * Track & Field is not one placing table. Three different *final* tables apply
 * depending on the event group — 2.2 generally, 2.5 for the 5000m and 3000mSC groups,
 * 2.9 for the 10,000m group (and 2.10 for the 10km road races that count inside it) —
 * each with its own round-before-final companions. All of them, plus the group-to-table
 * mapping, come from pipeline/scrape_rules.py.
 */
import placingTablesJson from '../data/placing_tables.json';
import type { EventGroup } from '../data/events';
import type { CategoryCode } from '../data/types';
import type { RoundKind } from './rounds';

interface PlacingTablesFile {
  tables: Record<string, { title: string; scores: Record<string, Record<string, number>> }>;
  eventGroupTables: Record<string, {
    final: string;
    beforeFinal?: Record<string, string>;
    byDiscipline?: Record<string, { final?: string }>;
  }>;
}

const FILE = placingTablesJson as unknown as PlacingTablesFile;

/** The key the "Q or q to Final" row is stored under. */
const ADVANCED_KEY = 'Q';

export type FinalFieldSize = 'max9' | 'min10';

/**
 * Which round-before-final table applies, which the rules make conditional on whether the
 * final has at most 9 athletes (Table 2.3) or 10 or more (Table 2.4).
 *
 * Neither result feed reports the finalist count, so this is a per-family assumption:
 * championship field-event finals take 12, championship track finals take 8. The high
 * jump half is confirmed — Table 2.4's values reproduce World Athletics' live counting
 * sets exactly. The track half is the assumption the oracle test in Task 9 exists to
 * check; if it disproves it, correct it here rather than at the call sites.
 */
export function finalFieldSizeFor(group: EventGroup): FinalFieldSize {
  return group.mark.kind === 'height' || group.mark.kind === 'distance' ? 'min10' : 'max9';
}

function groupTables(group: EventGroup) {
  return FILE.eventGroupTables[group.slug] ?? FILE.eventGroupTables.default;
}

/** The table number that applies, or null when the round scores nothing. */
export function placingTableFor(
  group: EventGroup,
  discipline: string,
  round: RoundKind,
  category: CategoryCode,
): string | null {
  if (round === 'other') return null;
  const tables = groupTables(group);

  if (round === 'final') {
    return tables.byDiscipline?.[discipline]?.final ?? tables.final;
  }

  const beforeFinal = tables.beforeFinal;
  if (!beforeFinal) return null;
  // A category-specific round table wins over the field-size ones — the 5000m and
  // 3000mSC groups have a dedicated OW table (2.6) that is not split by field size.
  return beforeFinal[category] ?? beforeFinal[finalFieldSizeFor(group)] ?? null;
}

/**
 * Placing points for one result. Returns 0 whenever the tables award nothing: a round
 * that is not the final or the one before it, a category with no column in the relevant
 * table (rounds before the final only score in OW, DF, GW and GL), or a place beyond the
 * table's range.
 */
export function placingPointsFor(args: {
  group: EventGroup;
  discipline: string;
  category: CategoryCode;
  round: RoundKind;
  place: number;
  /** Whether the athlete advanced to the final — the tables' "Q or q to Final" row. */
  advanced: boolean;
}): number {
  const { group, discipline, category, round, place, advanced } = args;
  const tableNumber = placingTableFor(group, discipline, round, category);
  if (!tableNumber) return 0;

  const byCategory = FILE.tables[tableNumber]?.scores?.[category];
  if (!byCategory) return 0;

  const key = round === 'beforeFinal' && advanced ? ADVANCED_KEY : String(place);
  return byCategory[key] ?? 0;
}
