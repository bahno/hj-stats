import { useCallback, useEffect, useState } from 'react';
import type { Gender } from '../data/types';
import { useAuth } from '../auth/AuthContext';
import { getProfile, updateProfile } from '../data/userData';

export function usePreferences() {
  const { user } = useAuth();
  const [defaultGender, setGender] = useState<Gender | null>(null);
  const [defaultEvent, setEvent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setGender(null);
      setEvent(null);
      return;
    }
    let active = true;
    setLoading(true);
    getProfile(user.id)
      .then((p) => {
        if (!active) return;
        setGender(p?.default_gender ?? null);
        setEvent(p?.default_event ?? null);
      })
      .catch(() => {
        if (!active) return;
        setGender(null);
        setEvent(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Keyed on the id, not the user object: an identity-only change to the auth
    // value must not re-trigger a fetch that clobbers an optimistic update.
  }, [user?.id]);

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

  const setDefaultEvent = useCallback(
    async (slug: string) => {
      if (!user) return;
      const prev = defaultEvent;
      setEvent(slug); // optimistic
      try {
        await updateProfile(user.id, { default_event: slug });
      } catch (e) {
        setEvent(prev); // rollback
        throw e;
      }
    },
    [user, defaultEvent],
  );

  return { defaultGender, setDefaultGender, defaultEvent, setDefaultEvent, loading };
}
