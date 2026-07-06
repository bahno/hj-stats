import { expect, test } from 'vitest';
import { availableMarks } from './marks';
import type { ScoringTable } from '../data/types';

const table: ScoringTable = {
  event: 'high_jump', unit: 'm', source: 'fixture',
  points_by_mark: { men: { '2.00': 859, '2.30': 1244 }, women: {} },
};

test('availableMarks returns numeric heights sorted high to low', () => {
  expect(availableMarks(table, 'men')).toEqual([2.3, 2.0]);
});
