import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Gender } from '../data/types';
import { useAuth } from '../auth/AuthContext';
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  updateFavoriteNotifyPrefs,
  type Favorite,
} from '../data/userData';
import type { NotifyPrefs } from '../data/types';

type NewFavorite = { athlete_slug: string; athlete_name: string; gender: Gender };

interface FavoritesValue {
  favorites: Favorite[];
  loading: boolean;
  isFavorite: (slug: string, gender: Gender) => boolean;
  toggle: (fav: NewFavorite) => Promise<void>;
  updatePrefs: (slug: string, gender: Gender, prefs: NotifyPrefs) => Promise<void>;
}

const FavoritesContext = createContext<FavoritesValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setFavorites([]);
      return;
    }
    let active = true;
    setLoading(true);
    listFavorites(user.id)
      .then((rows) => {
        if (active) setFavorites(rows);
      })
      .catch(() => {
        if (active) setFavorites([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Depend on user?.id rather than the user object itself: identity-only
    // changes to the auth value (e.g. a freshly-constructed object with the
    // same id) must not re-trigger a refetch that clobbers in-flight
    // optimistic updates.
  }, [user?.id]);

  const isFavorite = useCallback(
    (slug: string, gender: Gender) =>
      favorites.some((f) => f.athlete_slug === slug && f.gender === gender),
    [favorites],
  );

  const toggle = useCallback(
    async (fav: NewFavorite) => {
      if (!user) return;
      const exists = favorites.find(
        (f) => f.athlete_slug === fav.athlete_slug && f.gender === fav.gender,
      );
      const prev = favorites;
      if (exists) {
        setFavorites((cur) => cur.filter((f) => f.id !== exists.id)); // optimistic
        try {
          await removeFavorite(user.id, fav.athlete_slug, fav.gender);
        } catch (e) {
          setFavorites(prev);
          throw e;
        }
      } else {
        try {
          const created = await addFavorite(user.id, fav);
          setFavorites((cur) => [created, ...cur]);
        } catch (e) {
          setFavorites(prev);
          throw e;
        }
      }
    },
    [user, favorites],
  );

  const updatePrefs = useCallback(
    async (slug: string, gender: Gender, prefs: NotifyPrefs) => {
      if (!user) return;
      const prev = favorites;
      setFavorites((cur) =>
        cur.map((f) =>
          f.athlete_slug === slug && f.gender === gender ? { ...f, notify_prefs: prefs } : f,
        ),
      );
      try {
        await updateFavoriteNotifyPrefs(user.id, slug, gender, prefs);
      } catch (e) {
        setFavorites(prev);
        throw e;
      }
    },
    [user, favorites],
  );

  const value = useMemo<FavoritesValue>(
    () => ({ favorites, loading, isFavorite, toggle, updatePrefs }),
    [favorites, loading, isFavorite, toggle, updatePrefs],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used within a FavoritesProvider');
  return ctx;
}
