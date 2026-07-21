import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getNotificationSettings = vi.fn();
const updateNotificationSettings = vi.fn();
const updatePrefs = vi.fn();

vi.mock('../data/userData', () => ({
  getNotificationSettings: (...a: unknown[]) => getNotificationSettings(...a),
  updateNotificationSettings: (...a: unknown[]) => updateNotificationSettings(...a),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.com' } }) }));
vi.mock('../hooks/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [
      {
        id: 'f1',
        athlete_slug: 's',
        athlete_name: 'Ada Jumper',
        gender: 'men',
        notify_prefs: { place: true, score: true, result: true, qualification: true },
      },
    ],
    updatePrefs: (...a: unknown[]) => updatePrefs(...a),
  }),
}));

import { NotificationSettings } from './NotificationSettings';

beforeEach(() => {
  getNotificationSettings.mockResolvedValue({ email_enabled: false, unsubscribe_token: 't' });
  updateNotificationSettings.mockResolvedValue(undefined);
  updatePrefs.mockResolvedValue(undefined);
});

describe('NotificationSettings', () => {
  it('enables email via the master toggle', async () => {
    render(<NotificationSettings />);
    const master = await screen.findByLabelText(/email me about my favorites/i);
    expect((master as HTMLInputElement).checked).toBe(false);
    await userEvent.click(master);
    await waitFor(() =>
      expect(updateNotificationSettings).toHaveBeenCalledWith('u1', { email_enabled: true }),
    );
  });

  it('toggling a trigger calls updatePrefs when email is enabled', async () => {
    getNotificationSettings.mockResolvedValue({ email_enabled: true, unsubscribe_token: 't' });
    render(<NotificationSettings />);
    const resultBox = await screen.findByLabelText(/Ada Jumper.*result/i);
    await userEvent.click(resultBox);
    expect(updatePrefs).toHaveBeenCalledWith('s', 'men', {
      place: true,
      score: true,
      result: false,
      qualification: true,
    });
  });
});
