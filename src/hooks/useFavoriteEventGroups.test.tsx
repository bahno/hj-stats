import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listFavorites = vi.fn();
const updateFavoriteEventGroups = vi.fn();
vi.mock('../data/userData', () => ({
  listFavorites: (...a: unknown[]) => listFavorites(...a),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  updateFavoriteNotifyPrefs: vi.fn(),
  updateFavoriteEventGroups: (...a: unknown[]) => updateFavoriteEventGroups(...a),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import { FavoritesProvider, useFavorites } from './FavoritesContext';

function Probe() {
  const { favorites, updateEventGroups } = useFavorites();
  const f = favorites[0];
  return (
    <div>
      <span data-testid="groups">{f ? f.event_groups.join(',') : 'none'}</span>
      {f && (
        <button
          onClick={() =>
            void updateEventGroups(f.athlete_slug, f.gender, ['pole-vault', '100m']).catch(
              () => {},
            )
          }
        >
          set
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
      event_groups: ['pole-vault'],
      notify_prefs: { place: true, score: true, result: true, qualification: true },
    },
  ]);
  updateFavoriteEventGroups.mockReset().mockResolvedValue(undefined);
});

describe('FavoritesContext.updateEventGroups', () => {
  it('optimistically updates the favorite and persists', async () => {
    render(
      <FavoritesProvider>
        <Probe />
      </FavoritesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('groups').textContent).toBe('pole-vault'));
    await userEvent.click(screen.getByText('set'));
    expect(screen.getByTestId('groups').textContent).toBe('pole-vault,100m');
    expect(updateFavoriteEventGroups).toHaveBeenCalledWith('u1', 's', 'men', [
      'pole-vault',
      '100m',
    ]);
  });

  it('rolls back when the write fails', async () => {
    updateFavoriteEventGroups.mockRejectedValue(new Error('nope'));
    render(
      <FavoritesProvider>
        <Probe />
      </FavoritesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('groups').textContent).toBe('pole-vault'));
    await userEvent.click(screen.getByText('set'));
    await waitFor(() => expect(screen.getByTestId('groups').textContent).toBe('pole-vault'));
  });
});
