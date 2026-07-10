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
