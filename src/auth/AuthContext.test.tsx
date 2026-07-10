import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';

const { holder } = vi.hoisted(() => ({ holder: { current: null as any } }));
vi.mock('../lib/supabase', () => ({
  get supabase() {
    return holder.current;
  },
}));

import { AuthProvider, useAuth } from './AuthContext';

function Probe() {
  const { loading, user } = useAuth();
  return <div>{loading ? 'loading' : `user:${user?.email ?? 'none'}`}</div>;
}

beforeEach(() => {
  holder.current = null;
});

test('reports no user in auth-disabled mode (null client)', async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByText('user:none')).toBeInTheDocument());
});

test('seeds the user from an existing session', async () => {
  holder.current = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { email: 'a@b.com' } } },
        error: null,
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  };
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByText('user:a@b.com')).toBeInTheDocument());
});
