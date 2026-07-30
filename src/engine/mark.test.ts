import { describe, expect, it } from 'vitest';
import type { MarkSpec } from '../data/events';
import { compareMarks, formatMark, isBetterMark, parseMark } from './mark';

const HEIGHT: MarkSpec = { kind: 'height', betterIsHigher: true, decimals: 2, unit: 'm' };
const TIME: MarkSpec = { kind: 'time', betterIsHigher: false, decimals: 2, unit: 's' };
const POINTS: MarkSpec = { kind: 'points', betterIsHigher: true, decimals: 0, unit: 'pts' };

describe('parseMark', () => {
  it('parses a height in metres', () => {
    expect(parseMark('2.30', HEIGHT)).toBe(2.3);
  });

  it('parses a plain seconds time', () => {
    expect(parseMark('9.67', TIME)).toBe(9.67);
  });

  it('parses minutes and seconds', () => {
    expect(parseMark('1:42.29', TIME)).toBeCloseTo(102.29, 5);
    expect(parseMark('3:34.10', TIME)).toBeCloseTo(214.1, 5);
  });

  it('parses hours, minutes and seconds', () => {
    expect(parseMark('2:04:03', TIME)).toBe(7443);
  });

  it('parses combined-event points', () => {
    expect(parseMark('8804', POINTS)).toBe(8804);
  });

  it('ignores trailing annotations the feed adds', () => {
    expect(parseMark('9.67 ', TIME)).toBe(9.67);
    expect(parseMark('2.30h', HEIGHT)).toBe(2.3);
  });

  it('returns null for a non-performance', () => {
    for (const raw of ['DNF', 'DNS', 'NM', 'DQ', '', '—']) {
      expect(parseMark(raw, TIME)).toBeNull();
    }
  });
});

describe('formatMark', () => {
  it('round-trips a height', () => {
    expect(formatMark(2.3, HEIGHT)).toBe('2.30');
  });

  it('formats seconds under a minute without a colon', () => {
    expect(formatMark(9.67, TIME)).toBe('9.67');
  });

  it('formats minutes and seconds with a zero-padded seconds field', () => {
    expect(formatMark(102.29, TIME)).toBe('1:42.29');
    expect(formatMark(214.1, TIME)).toBe('3:34.10');
  });

  it('formats past an hour', () => {
    expect(formatMark(7443, TIME)).toBe('2:04:03.00');
  });

  it('formats points as a whole number', () => {
    expect(formatMark(8804, POINTS)).toBe('8804');
  });
});

describe('isBetterMark', () => {
  it('treats a bigger height as better', () => {
    expect(isBetterMark(2.31, 2.3, HEIGHT)).toBe(true);
    expect(isBetterMark(2.29, 2.3, HEIGHT)).toBe(false);
  });

  it('treats a smaller time as better', () => {
    expect(isBetterMark(9.58, 9.67, TIME)).toBe(true);
    expect(isBetterMark(9.99, 9.67, TIME)).toBe(false);
  });

  it('does not count an equal mark as better', () => {
    expect(isBetterMark(2.3, 2.3, HEIGHT)).toBe(false);
    expect(isBetterMark(9.67, 9.67, TIME)).toBe(false);
  });
});

describe('compareMarks', () => {
  it('sorts heights best-first', () => {
    expect([2.2, 2.35, 2.3].sort((a, b) => compareMarks(a, b, HEIGHT))).toEqual([2.35, 2.3, 2.2]);
  });

  it('sorts times best-first', () => {
    expect([9.99, 9.58, 9.7].sort((a, b) => compareMarks(a, b, TIME))).toEqual([9.58, 9.7, 9.99]);
  });
});
