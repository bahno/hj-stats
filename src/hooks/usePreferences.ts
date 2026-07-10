import { useCallback, useEffect, useState } from 'react';
import type { Gender } from '../data/types';
import { useAuth } from '../auth/AuthContext';
import { getProfile, updateProfile } from '../data/userData';

export function usePreferences() {
  const { user } = useAuth();
  const [defaultGender, setGender] = useState<Gender | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setGender(null);
      return;
    }
    let active = true;
    setLoading(true);
    getProfile(user.id)
      .then((p) => {
        if (active) setGender(p?.default_gender ?? null);
      })
      .catch(() => {
        if (active) setGender(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const setDefaultGender = useCallback(
    async (g: Gender) => {
      if (!user) return;
      const prev = defaultGender;
      setGender(g); // optimistic
      try {
        await updateProfile(user.id, { default_gender: g });
      } catch (e) {
        setGender(prev); // rollback
        throw e;
      }
    },
    [user, defaultGender],
  );

  return { defaultGender, setDefaultGender, loading };
}
