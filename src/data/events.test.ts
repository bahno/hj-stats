import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVENT_SLUG,
  EVENT_GROUPS,
  counterpartGroup,
  eventGroupsFor,
  findEventGroup,
} from './events';

describe('event registry', () => {
  it('holds 18 groups per gender', () => {
    expect(EVENT_GROUPS).toHaveLength(36);
    expect(eventGroupsFor('men')).toHaveLength(18);
    expect(eventGroupsFor('women')).toHaveLength(18);
  });

  it('finds a group by slug and gender', () => {
    const hj = findEventGroup('high-jump', 'women');
    expect(hj?.label).toBe("Women's High Jump");
    expect(hj?.disciplines).toContain('High Jump');
  });

  it('averages five results for every track and field group', () => {
    expect(EVENT_GROUPS.every((g) => g.countingResults === 5)).toBe(true);
  });

  it('gives the 10,000m group an 18-month window and everything else 12', () => {
    expect(findEventGroup('10000m', 'men')?.windowMonths).toBe(18);
    expect(findEventGroup('high-jump', 'men')?.windowMonths).toBe(12);
    expect(findEventGroup('1500m', 'men')?.windowMonths).toBe(12);
  });

  it('marks vertical jumps as higher-is-better and track events as lower-is-better', () => {
    expect(findEventGroup('high-jump', 'men')?.mark).toMatchObject({
      kind: 'height',
      betterIsHigher: true,
      decimals: 2,
    });
    expect(findEventGroup('shot-put', 'men')?.mark).toMatchObject({
      kind: 'distance',
      betterIsHigher: true,
    });
    expect(findEventGroup('800m', 'men')?.mark).toMatchObject({
      kind: 'time',
      betterIsHigher: false,
    });
  });

  it('defaults to high jump, so the current app behaviour is unchanged', () => {
    expect(findEventGroup(DEFAULT_EVENT_SLUG, 'men')).toBeDefined();
  });

  it('carries a selected group across a gender switch', () => {
    const menHJ = findEventGroup('high-jump', 'men')!;
    expect(counterpartGroup(menHJ, 'women').label).toBe("Women's High Jump");
    expect(counterpartGroup(menHJ, 'men')).toBe(menHJ);
  });

  it('maps the hurdles to their counterpart, whose slug differs by gender', () => {
    const men110 = findEventGroup('110mh', 'men')!;
    const women100 = findEventGroup('100mh', 'women')!;
    expect(counterpartGroup(men110, 'women')).toBe(women100);
    expect(counterpartGroup(women100, 'men')).toBe(men110);
  });

  it('has a counterpart for every group, in both directions', () => {
    for (const group of EVENT_GROUPS) {
      const other = group.gender === 'men' ? 'women' : 'men';
      const counterpart = counterpartGroup(group, other);
      expect(counterpart.gender).toBe(other);
      expect(counterpartGroup(counterpart, group.gender)).toBe(group);
    }
  });

  it('never has a group without disciplines to match results against', () => {
    for (const group of EVENT_GROUPS) {
      expect(group.disciplines.length).toBeGreaterThan(0);
    }
  });
});
