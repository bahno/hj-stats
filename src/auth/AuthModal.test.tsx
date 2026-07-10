import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ signIn: mocks.signIn, signUp: mocks.signUp }),
}));

import { AuthModal } from './AuthModal';

beforeEach(() => {
  mocks.signIn.mockReset().mockResolvedValue({ error: null });
  mocks.signUp.mockReset().mockResolvedValue({ error: null, needsConfirmation: true });
});

test('submits sign-in with entered credentials', async () => {
  const onClose = vi.fn();
  render(<AuthModal onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith('a@b.com', 'secret1'));
});

test('shows confirmation notice after sign-up', async () => {
  render(<AuthModal onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
  await waitFor(() =>
    expect(screen.getByText(/check your email/i)).toBeInTheDocument(),
  );
});
