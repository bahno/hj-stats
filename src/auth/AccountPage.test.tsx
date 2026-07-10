import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.com' }, signOut: mocks.signOut }),
}));
vi.mock('../data/userData', () => ({
  getProfile: mocks.getProfile,
  updateProfile: mocks.updateProfile,
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth: {}, functions: {} } }));

import { AccountPage } from './AccountPage';

beforeEach(() => {
  mocks.signOut.mockReset();
  mocks.getProfile
    .mockReset()
    .mockResolvedValue({ id: 'u1', display_name: 'Gia', default_gender: 'men' });
  mocks.updateProfile.mockReset().mockResolvedValue(undefined);
});

test('shows the account email', async () => {
  render(<AccountPage />);
  await waitFor(() => expect(screen.getByText('a@b.com')).toBeInTheDocument());
});

test('saves an edited display name', async () => {
  render(<AccountPage />);
  await waitFor(() => expect(screen.getByDisplayValue('Gia')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Gianmarco' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() =>
    expect(mocks.updateProfile).toHaveBeenCalledWith('u1', { display_name: 'Gianmarco' }),
  );
});

test('saves the default gender when toggled', async () => {
  render(<AccountPage />);
  const toggle = await screen.findByRole('switch', { name: 'Default gender' });
  fireEvent.click(toggle); // men -> women
  await waitFor(() =>
    expect(mocks.updateProfile).toHaveBeenCalledWith('u1', { default_gender: 'women' }),
  );
});
