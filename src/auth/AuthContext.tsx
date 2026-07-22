import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ error: Error | null; needsConfirmation: boolean }>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /** True while Supabase is handling a password-recovery link, so the UI can
   *  show the "set a new password" form instead of the normal account view. */
  recovering: boolean;
  endRecovery: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Clicking a reset link signs the user in with a recovery session; the
      // app must send them straight to "choose a new password".
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      async signIn(email, password) {
        if (!supabase) return { error: new Error('Sign-in is unavailable') };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error };
      },
      async signUp(email, password) {
        if (!supabase)
          return { error: new Error('Sign-up is unavailable'), needsConfirmation: false };
        const { data, error } = await supabase.auth.signUp({ email, password });
        // When email confirmation is on, Supabase returns a user with no session.
        return { error, needsConfirmation: !error && !data.session };
      },
      async resetPassword(email) {
        if (!supabase) return { error: new Error('Password reset is unavailable') };
        // Land back on the app itself; Supabase appends the recovery tokens,
        // which the client picks up as a PASSWORD_RECOVERY event.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname,
        });
        return { error };
      },
      async signOut() {
        if (supabase) await supabase.auth.signOut();
      },
      recovering,
      endRecovery: () => setRecovering(false),
    }),
    [session, loading, recovering],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
