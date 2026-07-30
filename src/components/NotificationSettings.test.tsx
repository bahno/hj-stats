import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getNotificationSettings = vi.fn();
const updateNotificationSettings = vi.fn();
const updatePrefs = vi.fn();
const updateEventGroups = vi.fn();
const favorites = {
  current: [] as Array<Record<string, unknown>>,
};

vi.mock('../data/userData', () => ({
  getNotificationSettings: (...a: unknown[]) => getNotificationSettings(...a),
  updateNotificationSettings: (...a: unknown[]) => updateNotificationSettings(...a),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.com' } }) }));
vi.mock('../hooks/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: favorites.current,
    updatePrefs: (...a: unknown[]) => updatePrefs(...a),
    updateEventGroups: (...a: unknown[]) => updateEventGroups(...a),
  }),
}));

import { NotificationSettings } from './NotificationSettings';

beforeEach(() => {
  favorites.current = [
    {
      id: 'f1',
      athlete_slug: 's',
      athlete_name: 'Ada Jumper',
      gender: 'men',
      event_groups: ['high-jump'],
      notify_prefs: { place: true, score: true, result: true, qualification: true },
    },
  ];
  getNotificationSettings.mockResolvedValue({ email_enabled: false, unsubscribe_token: 't' });
  updateNotificationSettings.mockResolvedValue(undefined);
  updatePrefs.mockResolvedValue(undefined);
  updateEventGroups.mockReset().mockResolvedValue(undefined);
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

  it('lists the disciplines a favorite is followed in', async () => {
    render(<NotificationSettings />);
    expect(await screen.findByText('High Jump')).toBeInTheDocument();
  });

  it('adding a discipline saves the whole set', async () => {
    render(<NotificationSettings />);
    const add = await screen.findByLabelText('Add an event for Ada Jumper');
    await userEvent.selectOptions(add, 'pole-vault');
    await waitFor(() =>
      expect(updateEventGroups).toHaveBeenCalledWith('s', 'men', ['high-jump', 'pole-vault']),
    );
  });

  it('removing a discipline saves what is left', async () => {
    favorites.current[0].event_groups = ['high-jump', 'pole-vault'];
    render(<NotificationSettings />);

    await userEvent.click(
      await screen.findByLabelText('Stop following Ada Jumper in High Jump'),
    );
    await waitFor(() =>
      expect(updateEventGroups).toHaveBeenLastCalledWith('s', 'men', ['pole-vault']),
    );
  });

  it('will not remove the last discipline, which would silence the favorite', async () => {
    render(<NotificationSettings />);
    await screen.findByText('High Jump');
    expect(screen.queryByLabelText('Stop following Ada Jumper in High Jump')).toBeNull();
  });
});
