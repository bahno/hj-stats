import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

// Auth-disabled mode: null client → no account UI, public app still renders.
vi.mock('./lib/supabase', () => ({ supabase: null, isAuthEnabled: false }));

import App from './App';

test('renders the calculator and hides account UI when auth is disabled', () => {
  render(<App />);
  expect(screen.getByText('Calculator')).toBeInTheDocument();
  expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
});

test('lands on the rankings view, which covers every event group', () => {
  render(<App />);
  expect(screen.getByRole('tab', { name: 'Rankings' })).toHaveAttribute('aria-selected', 'true');
  // The event picker belongs to the lookup, so its presence proves which view is up.
  expect(screen.getByLabelText('Event')).toBeInTheDocument();
});

test('?view=calculator opens the calculator instead', () => {
  window.history.replaceState(null, '', '?view=calculator');
  render(<App />);
  expect(screen.getByRole('tab', { name: 'Calculator' })).toHaveAttribute('aria-selected', 'true');
});
