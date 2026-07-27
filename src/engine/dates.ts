const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Parse a WorldAthletics/EA date to epoch ms (UTC). Handles the results feed's
 * "16 SEP 2025" format and, defensively, an ISO "2025-09-16" (the ranking endpoints'
 * rankDate format isn't guaranteed to match). NaN if unparseable.
 */
export function parseWaDate(s: string): number {
  const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 3) return NaN;
  const [d, mon, y] = parts;
  const month = MONTHS[mon.toUpperCase()];
  if (month === undefined) return NaN;
  const day = Number(d);
  const year = Number(y);
  if (!Number.isFinite(day) || !Number.isFinite(year)) return NaN;
  return Date.UTC(year, month, day);
}

/** The same instant one calendar year earlier — the start of a rolling 12-month window. */
export function oneYearEarlier(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate());
}
