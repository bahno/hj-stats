/**
 * The event registry: the single place that knows anything discipline-specific.
 *
 * Everything downstream — window bounds, discipline matching, placing tables, mark
 * formatting — takes an EventGroup rather than reaching for a constant. Adding an
 * event group should mean adding data here, never editing the engine.
 *
 * Group membership, main/similar events and the ranking API slug come from World
 * Athletics rules Table 2.12 via pipeline/scrape_rules.py; the long discipline names
 * come from pipeline/harvest_disciplines.py. The per-group properties below are the
 * ones the rules state in prose rather than in a table.
 */
import groupsJson from './event_groups.json';
import type { Gender } from './types';

export type MarkKind = 'height' | 'distance' | 'time' | 'points';

export interface MarkSpec {
  kind: MarkKind;
  /** False for timed events, where a smaller number is a better performance. */
  betterIsHigher: boolean;
  decimals: number;
  unit: string;
}

export interface EventGroup {
  /** European Athletics ranking API `eventGroup` value, e.g. "high-jump". */
  slug: string;
  /** Table 2.12's own label, e.g. "Women's High Jump". */
  label: string;
  gender: Gender;
  mainEvent: string;
  /** Short names, as Table 2.12 writes them. Display only — never match on these. */
  similarEvents: string[];
  /** Long names, as the result feeds write them. Match results on these. */
  disciplines: string[];
  countingResults: number;
  windowMonths: number;
  mark: MarkSpec;
}

interface RawGroup {
  label: string;
  gender: string;
  mainEvent: string;
  similarEvents: string[];
  disciplines?: string[];
  slug: string | null;
}

const HEIGHT: MarkSpec = { kind: 'height', betterIsHigher: true, decimals: 2, unit: 'm' };
const DISTANCE: MarkSpec = { kind: 'distance', betterIsHigher: true, decimals: 2, unit: 'm' };
const TIME: MarkSpec = { kind: 'time', betterIsHigher: false, decimals: 2, unit: 's' };

const MARK_BY_MAIN_EVENT: Record<string, MarkSpec> = {
  'High Jump': HEIGHT,
  'Pole Vault': HEIGHT,
  'Long Jump': DISTANCE,
  'Triple Jump': DISTANCE,
  'Shot Put': DISTANCE,
  'Discus Throw': DISTANCE,
  'Hammer Throw': DISTANCE,
  'Javelin Throw': DISTANCE,
};

/**
 * World Athletics ranking rules, Track & Field: the ranking period is 12 months,
 * except the 10,000m event group, which is 18. Stated in prose on the rules page,
 * not in any table, so it is transcribed here.
 */
const WINDOW_MONTHS_BY_SLUG: Record<string, number> = { '10000m': 18 };
const DEFAULT_WINDOW_MONTHS = 12;

/** Every Track & Field event group averages the best 5 results. Road running and
 *  combined events use 2, which is why this is per-group rather than a constant —
 *  those families are out of scope here but will reuse this field. */
const COUNTING_RESULTS = 5;

export const DEFAULT_EVENT_SLUG = 'high-jump';

function toEventGroup(raw: RawGroup): EventGroup {
  if (!raw.slug) {
    throw new Error(`Event group "${raw.label}" has no ranking API slug`);
  }
  const disciplines = raw.disciplines ?? [];
  if (disciplines.length === 0) {
    throw new Error(
      `Event group "${raw.label}" has no discipline names — run pipeline/harvest_disciplines.py`,
    );
  }
  return {
    slug: raw.slug,
    label: raw.label,
    gender: raw.gender === 'men' ? 'men' : 'women',
    mainEvent: raw.mainEvent,
    similarEvents: raw.similarEvents,
    disciplines,
    countingResults: COUNTING_RESULTS,
    windowMonths: WINDOW_MONTHS_BY_SLUG[raw.slug] ?? DEFAULT_WINDOW_MONTHS,
    mark: MARK_BY_MAIN_EVENT[raw.mainEvent] ?? TIME,
  };
}

export const EVENT_GROUPS: EventGroup[] = (groupsJson.groups as RawGroup[]).map(toEventGroup);

export function findEventGroup(slug: string, gender: Gender): EventGroup | undefined {
  return EVENT_GROUPS.find((g) => g.slug === slug && g.gender === gender);
}

export function eventGroupsFor(gender: Gender): EventGroup[] {
  return EVENT_GROUPS.filter((g) => g.gender === gender);
}

/**
 * The same event group in the other gender, for keeping a selection alive across a
 * gender switch. Slugs match for all but the hurdles — men contest 110mH, women 100mH —
 * so fall back to the same position in the other gender's list, which Table 2.12 orders
 * identically for both.
 */
export function counterpartGroup(group: EventGroup, gender: Gender): EventGroup {
  const direct = findEventGroup(group.slug, gender);
  if (direct) return direct;
  const from = eventGroupsFor(group.gender);
  const to = eventGroupsFor(gender);
  return to[from.indexOf(group)] ?? to[0];
}
