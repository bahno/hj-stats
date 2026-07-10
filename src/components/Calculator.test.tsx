import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

// Calculator now reads usePreferences (-> useAuth); render as a signed-out user
// so it behaves the same as before this hook existed.
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

import { Calculator } from './Calculator';

test('shows a ranking score and breakdown on first render', () => {
  render(<Calculator />);
  // default selection produces a numeric total in the score display
  expect(screen.getByTestId('ranking-score').textContent).toMatch(/\d/);
  expect(screen.getByTestId('breakdown').textContent).toMatch(/Performance/);
});
