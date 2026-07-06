import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Calculator } from './Calculator';

test('shows a ranking score and breakdown on first render', () => {
  render(<Calculator />);
  // default selection produces a numeric total in the score display
  expect(screen.getByTestId('ranking-score').textContent).toMatch(/\d/);
  expect(screen.getByTestId('breakdown').textContent).toMatch(/Performance/);
});
