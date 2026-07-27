import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { finalFieldSizeFor, placingPointsFor, placingTableFor } from './placing';

const hj = findEventGroup('high-jump', 'men')!;
const sprint = findEventGroup('100m', 'men')!;
const long = findEventGroup('5000m', 'men')!;
const tenK = findEventGroup('10000m', 'men')!;

describe('finalFieldSizeFor', () => {
  it('assumes field events run finals of 10 or more', () => {
    expect(finalFieldSizeFor(hj)).toBe('min10');
  });

  it('assumes track events run finals of at most 9', () => {
    expect(finalFieldSizeFor(sprint)).toBe('max9');
  });
});

describe('placingTableFor', () => {
  it('uses Table 2.2 for a general track and field final', () => {
    expect(placingTableFor(hj, 'High Jump', 'final', 'OW')).toBe('2.2');
  });

  it('uses Table 2.5 for a 5000m final', () => {
    expect(placingTableFor(long, '5000 Metres', 'final', 'OW')).toBe('2.5');
  });

  it('uses Table 2.9 for a 10,000m final but 2.10 for a 10km road race', () => {
    expect(placingTableFor(tenK, '10,000 Metres', 'final', 'OW')).toBe('2.9');
    // The feed's own name for the discipline, not Table 2.12's short label.
    expect(placingTableFor(tenK, '10 Kilometres Road', 'final', 'OW')).toBe('2.10');
  });

  it('picks the round-before-final table by field size', () => {
    expect(placingTableFor(hj, 'High Jump', 'beforeFinal', 'OW')).toBe('2.4');
    expect(placingTableFor(sprint, '100 Metres', 'beforeFinal', 'OW')).toBe('2.3');
  });

  it('gives 5000m a dedicated OW round table that ignores field size', () => {
    expect(placingTableFor(long, '5000 Metres', 'beforeFinal', 'OW')).toBe('2.6');
  });

  it('falls back to field size for 5000m categories with no dedicated table', () => {
    // 5000m is a track group, so finalFieldSizeFor gives 'max9' -> Table 2.7.
    expect(placingTableFor(long, '5000 Metres', 'beforeFinal', 'DF')).toBe('2.7');
    expect(placingTableFor(long, '5000 Metres', 'beforeFinal', 'GL')).toBe('2.7');
  });

  it('has no table for a round that scores nothing', () => {
    expect(placingTableFor(hj, 'High Jump', 'other', 'OW')).toBeNull();
  });
});

describe('placingPointsFor', () => {
  const score = (args: Partial<Parameters<typeof placingPointsFor>[0]>) =>
    placingPointsFor({
      group: hj, discipline: 'High Jump', category: 'OW',
      round: 'final', place: 1, advanced: false, ...args,
    });

  it('scores a general track and field final from Table 2.2', () => {
    expect(score({})).toBe(260);
    expect(score({ place: 6 })).toBe(160);
    expect(score({ category: 'F', place: 1 })).toBe(11);
  });

  it('reproduces the high jump qualification value verified against live data', () => {
    // Doroshchuk's and Hrubá's Tokyo qualification rounds both scored 70 placing
    // points on top of their mark score — Table 2.4's "Q or q to Final" row.
    expect(score({ round: 'beforeFinal', advanced: true })).toBe(70);
  });

  it('scores a track semi-final that advanced from Table 2.3', () => {
    // Burgin's Tokyo semi-final: 100 placing points.
    expect(
      placingPointsFor({
        group: findEventGroup('800m', 'men')!, discipline: '800 Metres', category: 'OW',
        round: 'beforeFinal', place: 3, advanced: true,
      }),
    ).toBe(100);
  });

  it('scores nothing for a round before the final in a category the tables omit', () => {
    // Jacobs' category B heat scored 0 placing points: Tables 2.3/2.4 only have
    // columns for OW, DF, GW and GL.
    expect(
      placingPointsFor({
        group: sprint, discipline: '100 Metres', category: 'B',
        round: 'beforeFinal', place: 1, advanced: true,
      }),
    ).toBe(0);
  });

  it('scores a non-advancing round by the athlete own place', () => {
    expect(score({ round: 'beforeFinal', advanced: false, place: 11 })).toBe(66);
  });

  it('scores nothing outside the table range', () => {
    expect(score({ place: 40 })).toBe(0);
    expect(score({ round: 'other' })).toBe(0);
  });
});
