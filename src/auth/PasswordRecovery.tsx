import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

/**
 * Shown when the user arrives from a password-reset email. Supabase has already
 * signed them in with a recovery session by this point, so all that is left is
 * to set the new password — but the normal app UI must not appear until they
 * have, or they would be left signed in with the password they forgot.
 */
export function PasswordRecovery() {
  const { endRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Choose a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase!.auth.updateUser({ password });
      if (error) setError(error.message);
      else endRecovery();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account">
      <form className="fields" onSubmit={submit}>
        <h2 className="auth-title">Choose a new password</h2>
        <label className="field">
          <span>New password</span>
          <input
            className="text-input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="lookup-msg">{error}</p>}
        <button className="lookup-btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </section>
  );
}
