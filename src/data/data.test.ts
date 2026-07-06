import { expect, test } from 'vitest';
import { categories, placingPoints } from '../engine/data';
import { CATEGORY_CODES } from './types';

test('categories cover every code in order', () => {
  expect(categories.map((c) => c.code)).toEqual([...CATEGORY_CODES]);
});

test('placing data has an entry per category', () => {
  for (const code of CATEGORY_CODES) {
    expect(placingPoints.final[code]).toBeDefined();
  }
});
