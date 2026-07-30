/**
 * Turning a mark into performance points, for every event group.
 *
 * Lookup is NOT an exact match. The book lists 1400 scores per event, which for a long
 * event is far fewer rows than there are possible marks. Its rule — "should a performance
 * fall between two results on the tables the lower score shall be considered" — means a
 * mark earns the best score whose listed mark it actually reaches. score_for() in
 * pipeline/verify.py is the reference implementation, and both are checked against the
 * same World Athletics fixtures.
 *
 * The tables are 1.1 MB combined, so they ship as per-group chunks
 * (pipeline/split_scoring.py) loaded on demand. Nothing here is on the first-paint path.
 */
import type { Gender } from '../data/types';
import type { EventGroup, MarkSpec } from '../data/events';
import { parseMark } from './mark';

export interface ScoringRow {
  /** The listed mark, parsed: metres for a field event, seconds for a timed one. */
  value: number;
  points: number;
}

export interface ParsedTable {
  slug: string;
  gender: Gender;
  /** The header cell the marks were read from, kept so a mis-attributed column shows. */
  column: string;
  spec: MarkSpec;
  /** Best mark first. markWheels relies on this order. */
  rows: ScoringRow[];
}

export interface RawScoringChunk {
  slug: string;
  gender: string;
  column: string;
  marks: Record<string, number>;
}

/** Parse a chunk's mark strings once, so no string parsing happens on the render path. */
export function parseScoringTable(group: EventGroup, raw: RawScoringChunk): ParsedTable {
  const rows: ScoringRow[] = [];
  for (const [mark, points] of Object.entries(raw.marks)) {
    const value = parseMark(mark, group.mark);
    if (value === null) continue;
    rows.push({ value, points });
  }
  rows.sort((a, b) => (group.mark.betterIsHigher ? b.value - a.value : a.value - b.value));
  return { slug: group.slug, gender: group.gender, column: raw.column, spec: group.mark, rows };
}

/**
 * The points a mark earns: the highest score whose listed mark the performance reaches.
 * A mark better than every row saturates at the top score; one worse than every row is 0.
 */
export function markPoints(table: ParsedTable, value: number): number {
  let best = 0;
  for (const row of table.rows) {
    const reaches = table.spec.betterIsHigher ? value >= row.value : value <= row.value;
    if (reaches && row.points > best) best = row.points;
  }
  return best;
}

/**
 * The listed mark scoring closest to `score`. The simulator opens here, so its wheels
 * start at roughly the athlete's own level in any event rather than at a constant that
 * only ever made sense for the high jump.
 */
export function markNearestScore(table: ParsedTable, score: number): number {
  let best = table.rows[0];
  for (const row of table.rows) {
    if (Math.abs(row.points - score) < Math.abs(best.points - score)) best = row;
  }
  return best.value;
}

const chunks = import.meta.glob('../data/scoring/*.json');
const cache = new Map<string, Promise<ParsedTable>>();

/**
 * The group's table, fetched on demand and memoized per slug+gender so re-renders and
 * repeat lookups of the same group do not re-import.
 */
export function loadScoringTable(group: EventGroup): Promise<ParsedTable> {
  const key = `${group.slug}-${group.gender}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const load = chunks[`../data/scoring/${key}.json`];
  if (!load) return Promise.reject(new Error(`No scoring table for ${key}`));

  const pending = load()
    .then((mod) => parseScoringTable(group, (mod as { default: RawScoringChunk }).default))
    // Don't cache a rejection — a transient chunk fetch failure must stay retryable.
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, pending);
  return pending;
}
