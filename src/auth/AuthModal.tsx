import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext';

type Mode = 'signin' | 'signup' | 'reset';

export function AuthModal({ onClose }: { onClose: () => void }) {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    if (mode !== 'reset' && password.length < 6) {
      setError('Enter a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email.trim(), password);
        if (error) setError(error.message);
        else onClose();
      } else if (mode === 'signup') {
        const { error, needsConfirmation } = await signUp(email.trim(), password);
        if (error) setError(error.message);
        else if (needsConfirmation)
          setNotice('Almost there — check your email to confirm your account, then sign in.');
        else onClose();
      } else {
        const { error } = await resetPassword(email.trim());
        // Deliberately the same message either way: whether an address has an
        // account is not something an unauthenticated form should reveal.
        if (error) setError(error.message);
        else
          setNotice(
            'If that address has an account, a password reset link is on its way. Open it to choose a new password.',
          );
      }
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {notice ? (
          <p className="auth-notice">{notice}</p>
        ) : (
          <form className="fields" onSubmit={submit}>
            <h2 className="auth-title">{title}</h2>
            <label className="field">
              <span>Email</span>
              <input
                className="text-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {mode !== 'reset' && (
              <label className="field">
                <span>Password</span>
                <input
                  className="text-input"
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {error && <p className="lookup-msg">{error}</p>}
            <button className="lookup-btn" type="submit" disabled={busy}>
              {busy
                ? 'Please wait…'
                : mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Sign up'
                    : 'Send reset link'}
            </button>
            {mode === 'signin' && (
              <button type="button" className="auth-switch" onClick={() => switchMode('reset')}>
                Forgot your password?
              </button>
            )}
            <button
              type="button"
              className="auth-switch"
              onClick={() => switchMode(mode === 'signup' ? 'signin' : mode === 'reset' ? 'signin' : 'signup')}
            >
              {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
