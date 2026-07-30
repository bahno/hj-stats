/**
 * A mark, split into the digit groups a picker can spin.
 *
 * One wheel per mark does not survive the jump from high jump's 163 listed marks to a
 * 10,000m's 1400. Splitting a mark into its natural digit groups turns one very deep wheel
 * into two or three shallow ones: metres and centimetres for a field event, minutes,
 * seconds and hundredths for a timed one.
 *
 * The wheels CASCADE: each one offers only the values that actually occur in the table
 * given the wheels above it. Every reachable combination is therefore a mark the book
 * really lists, so there is no invalid state and no dialling in a 2.99 m high jump.
 *
 * All arithmetic is on hundredths-scaled integers. `2.30 - 2` is 0.2999999999999998 in
 * floating point, which would decompose to 29 centimetres.
 */
import type { MarkSpec } from '../data/events';
import type { ParsedTable } from './scoring';

export interface Wheel {
  key: string;
  label: string;
  /** Digits to zero-pad the option label to. 0 means no padding. */
  pad: number;
  /** Ascending. Contains the current selection for this position once snapped. */
  options: number[];
  /** True when only one value is possible across the whole table, so it need not render. */
  hidden: boolean;
}

interface GroupSpec {
  key: string;
  label: string;
  pad: number;
  /** How many hundredths one unit of this group is worth. */
  scale: number;
  /** Modulus applied after dividing by scale, or null for the leading group. */
  modulus: number | null;
}

const FIELD_GROUPS: GroupSpec[] = [
  { key: 'metres', label: 'm', pad: 0, scale: 100, modulus: null },
  { key: 'centimetres', label: 'cm', pad: 2, scale: 1, modulus: 100 },
];

/**
 * The minutes group counts TOTAL minutes and has no hours companion. Only the women's
 * 10,000m runs past the hour (out to 1:13:43.57), and only at the slow end nobody
 * simulates; a fourth wheel for that one case would cost every other event a column.
 * MarkSelect prints the composed mark through formatMark underneath, which is where a
 * time over an hour reads correctly.
 */
const TIME_GROUPS: GroupSpec[] = [
  { key: 'minutes', label: 'min', pad: 0, scale: 6000, modulus: null },
  { key: 'seconds', label: 'sec', pad: 2, scale: 100, modulus: 60 },
  { key: 'hundredths', label: '.00', pad: 2, scale: 1, modulus: 100 },
];

function groupsFor(spec: MarkSpec): GroupSpec[] {
  return spec.kind === 'time' ? TIME_GROUPS : FIELD_GROUPS;
}

/** A mark value to its digit groups, most significant first. */
export function decompose(value: number, spec: MarkSpec): number[] {
  const hundredths = Math.round(value * 100);
  return groupsFor(spec).map((g) => {
    const raw = Math.floor(hundredths / g.scale);
    return g.modulus === null ? raw : raw % g.modulus;
  });
}

/** Digit groups back to a mark value. The inverse of decompose. */
export function compose(groups: number[], spec: MarkSpec): number {
  const specs = groupsFor(spec);
  let hundredths = 0;
  for (let i = 0; i < specs.length; i++) hundredths += (groups[i] ?? 0) * specs[i].scale;
  return hundredths / 100;
}

/** Every listed mark, decomposed once. */
function rowGroups(table: ParsedTable): number[][] {
  return table.rows.map((r) => decompose(r.value, table.spec));
}

/**
 * The wheels for the current selection. Wheel `i`'s options are the distinct values at
 * position `i` among the marks whose positions `0..i-1` match the selection.
 *
 * `hidden` is decided across the WHOLE table, not the filtered subset, so a wheel cannot
 * appear and disappear as the user spins the one above it.
 */
export function wheelsFor(table: ParsedTable, selection: number[]): Wheel[] {
  const specs = groupsFor(table.spec);
  const all = rowGroups(table);

  return specs.map((g, i) => {
    const matching = all.filter((groups) =>
      selection.slice(0, i).every((sel, j) => groups[j] === sel),
    );
    const options = [...new Set(matching.map((groups) => groups[i]))].sort((a, b) => a - b);
    const distinctOverall = new Set(all.map((groups) => groups[i])).size;
    return { key: g.key, label: g.label, pad: g.pad, options, hidden: distinctOverall <= 1 };
  });
}

function nearest(options: number[], want: number): number {
  return options.reduce(
    (best, o) => (Math.abs(o - want) < Math.abs(best - want) ? o : best),
    options[0],
  );
}

/**
 * Make a selection valid, left to right. Moving a higher wheel can strand the ones below
 * it — with metres at 2, a high jump has no centimetre above 54 — so each stranded value
 * snaps to the NEAREST still-valid one. Nearest rather than first, so a nudge keeps you at
 * a comparable mark instead of jumping to the extreme of the new range.
 */
export function snapSelection(table: ParsedTable, selection: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < groupsFor(table.spec).length; i++) {
    const { options } = wheelsFor(table, out)[i];
    out.push(options.includes(selection[i]) ? selection[i] : nearest(options, selection[i] ?? 0));
  }
  return out;
}
