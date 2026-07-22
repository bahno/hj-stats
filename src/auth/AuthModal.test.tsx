import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  resetPassword: vi.fn(),
}));
vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    signIn: mocks.signIn,
    signUp: mocks.signUp,
    resetPassword: mocks.resetPassword,
  }),
}));

import { AuthModal } from './AuthModal';

beforeEach(() => {
  mocks.signIn.mockReset().mockResolvedValue({ error: null });
  mocks.signUp.mockReset().mockResolvedValue({ error: null, needsConfirmation: true });
  mocks.resetPassword.mockReset().mockResolvedValue({ error: null });
});

test('submits sign-in with entered credentials', async () => {
  const onClose = vi.fn();
  render(<AuthModal onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith('a@b.com', 'secret1'));
});

test('sends a reset link and does not ask for a password', async () => {
  render(<AuthModal onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /forgot your password/i }));
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledWith('a@b.com'));
  expect(await screen.findByText(/password reset link is on its way/i)).toBeInTheDocument();
});

test('reset confirmation does not reveal whether the account exists', async () => {
  render(<AuthModal onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /forgot your password/i }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nobody@b.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  // Same wording regardless of whether an account was found.
  expect(await screen.findByText(/if that address has an account/i)).toBeInTheDocument();
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
