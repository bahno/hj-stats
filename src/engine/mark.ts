/**
 * Marks across Track & Field are not one kind of number. A high jump is metres where
 * bigger is better; an 800m is a duration written "1:42.29" where smaller is better; a
 * marathon is "2:04:03"; a decathlon is a whole-number points total. Every comparison,
 * sort and format in the engine has to know which it is holding, so all four live behind
 * one MarkSpec-driven interface.
 *
 * Times are carried internally as seconds. That keeps comparison a plain numeric
 * operation and confines the colon-separated formatting to this module.
 */
import type { MarkSpec } from '../data/events';

/** Anything that is not a performance: did not finish, no mark, disqualified. */
const NON_PERFORMANCE = /^(dnf|dns|dq|nm|ng|nh|dnq|—|-)?$/i;

/**
 * A mark string to a number, or null when it carries no performance.
 *
 * Handles the three shapes the feeds emit — "SS.ss", "M:SS.ss" and "H:MM:SS(.ss)" —
 * and tolerates the trailing letters World Athletics appends to annotate a mark
 * (for example an "h" for a hand-timed or hand-measured performance).
 */
export function parseMark(raw: string, spec: MarkSpec): number | null {
  const trimmed = String(raw ?? '').trim();
  if (NON_PERFORMANCE.test(trimmed)) return null;

  // Drop annotation letters, keeping digits, separators and a leading sign.
  const cleaned = trimmed.replace(/[^\d.:]/g, '');
  if (!cleaned) return null;

  const parts = cleaned.split(':');
  if (parts.length > 3) return null;

  if (spec.kind !== 'time' && parts.length === 1) {
    const value = Number(parts[0]);
    return Number.isFinite(value) ? value : null;
  }

  // Seconds last, then minutes, then hours.
  let seconds = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    seconds = seconds * 60 + value;
  }
  return seconds;
}

/** The inverse of parseMark: a number back to the string form the feeds use. */
export function formatMark(value: number, spec: MarkSpec): string {
  if (spec.kind !== 'time') return value.toFixed(spec.decimals);

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value - hours * 3600 - minutes * 60;
  const secondsText = seconds
    .toFixed(spec.decimals)
    .padStart(spec.decimals > 0 ? spec.decimals + 3 : 2, '0');

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`;
  if (minutes > 0) return `${minutes}:${secondsText}`;
  return seconds.toFixed(spec.decimals);
}

/** Whether `candidate` is a better performance than `incumbent`. Equal is not better. */
export function isBetterMark(candidate: number, incumbent: number, spec: MarkSpec): boolean {
  return spec.betterIsHigher ? candidate > incumbent : candidate < incumbent;
}

/** Comparator sorting marks best-first, for use with Array.prototype.sort. */
export function compareMarks(a: number, b: number, spec: MarkSpec): number {
  return spec.betterIsHigher ? b - a : a - b;
}
