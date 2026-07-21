import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listFavorites = vi.fn();
const updateFavoriteNotifyPrefs = vi.fn();
vi.mock('../data/userData', () => ({
  listFavorites: (...a: unknown[]) => listFavorites(...a),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  updateFavoriteNotifyPrefs: (...a: unknown[]) => updateFavoriteNotifyPrefs(...a),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import { FavoritesProvider, useFavorites } from './FavoritesContext';

function Probe() {
  const { favorites, updatePrefs } = useFavorites();
  const f = favorites[0];
  return (
    <div>
      <span data-testid="result-pref">{f ? String(f.notify_prefs.result) : 'none'}</span>
      {f && (
        <button
          onClick={() =>
            updatePrefs(f.athlete_slug, f.gender, { ...f.notify_prefs, result: false })
          }
        >
          toggle
        </button>
      )}
    </div>
  );
}

beforeEach(() => {
  listFavorites.mockResolvedValue([
    {
      id: 'f1',
      athlete_slug: 's',
      athlete_name: 'A',
      gender: 'men',
      notify_prefs: { place: true, score: true, result: true, qualification: true },
    },
  ]);
  updateFavoriteNotifyPrefs.mockResolvedValue(undefined);
});

describe('FavoritesContext.updatePrefs', () => {
  it('optimistically updates the favorite and persists', async () => {
    render(
      <FavoritesProvider>
        <Probe />
      </FavoritesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('result-pref').textContent).toBe('true'));
    await userEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('result-pref').textContent).toBe('false');
    expect(updateFavoriteNotifyPrefs).toHaveBeenCalledWith('u1', 's', 'men', {
      place: true,
      score: true,
      result: false,
      qualification: true,
    });
  });
});
