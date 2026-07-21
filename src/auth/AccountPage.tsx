import { useState } from 'react';
import type { Gender } from '../data/types';
import { useAuth } from './AuthContext';
import { usePreferences } from '../hooks/usePreferences';
import { GenderToggle } from '../components/inputs/GenderToggle';
import { NotificationSettings } from '../components/NotificationSettings';
import { supabase } from '../lib/supabase';

export function AccountPage() {
  const { user, signOut } = useAuth();
  const { defaultGender, setDefaultGender } = usePreferences();
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');

  if (!user) return <section className="card account">Please sign in.</section>;

  async function saveDefaultGender(g: Gender) {
    setMessage('');
    try {
      await setDefaultGender(g);
      setMessage('Default gender saved.');
    } catch {
      setMessage('Could not save default gender.');
    }
  }

  async function changePassword() {
    setMessage('');
    if (newPassword.length < 6) {
      setMessage('Password must be at least 6 characters.');
      return;
    }
    const { error } = await supabase!.auth.updateUser({ password: newPassword });
    setMessage(error ? error.message : 'Password updated.');
    if (!error) setNewPassword('');
  }

  async function deleteAccount() {
    if (!window.confirm('Permanently delete your account and saved data?')) return;
    const { error } = await supabase!.functions.invoke('delete-account');
    if (error) {
      setMessage(error.message);
      return;
    }
    await signOut();
  }

  return (
    <section className="card account">
      <h2 className="auth-title">Account</h2>
      <div className="account-email muted">{user.email}</div>

      <GenderToggle
        label="Default gender"
        value={defaultGender ?? 'men'}
        onChange={saveDefaultGender}
      />

      <label className="field">
        <span>New password</span>
        <div className="field-row">
          <input
            className="text-input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button className="btn-inline" type="button" onClick={changePassword}>
            Update
          </button>
        </div>
      </label>

      {message && <p className="lookup-msg">{message}</p>}

      <NotificationSettings />

      <div className="account-actions">
        <button type="button" className="btn-inline" onClick={() => signOut()}>
          Sign out
        </button>
        <button type="button" className="btn-inline danger" onClick={deleteAccount}>
          Delete account
        </button>
      </div>
    </section>
  );
}
