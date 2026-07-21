import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useFavorites } from '../hooks/FavoritesContext';
import { getNotificationSettings, updateNotificationSettings } from '../data/userData';
import type { NotifyPrefs } from '../data/types';

const TRIGGERS: Array<{ key: keyof NotifyPrefs; label: string }> = [
  { key: 'place', label: 'Place' },
  { key: 'score', label: 'Score' },
  { key: 'result', label: 'Result' },
  { key: 'qualification', label: 'Qualification' },
];

export function NotificationSettings() {
  const { user } = useAuth();
  const { favorites, updatePrefs } = useFavorites();
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    getNotificationSettings(user.id)
      .then((s) => setEmailEnabled(Boolean(s?.email_enabled)))
      .finally(() => setLoaded(true));
  }, [user]);

  if (!user) return null;

  async function toggleEmail() {
    const next = !emailEnabled;
    setEmailEnabled(next); // optimistic
    setMessage('');
    try {
      await updateNotificationSettings(user!.id, { email_enabled: next });
    } catch {
      setEmailEnabled(!next);
      setMessage('Could not save notification setting.');
    }
  }

  function toggleTrigger(slug: string, gender: 'men' | 'women', prefs: NotifyPrefs, key: keyof NotifyPrefs) {
    void updatePrefs(slug, gender, { ...prefs, [key]: !prefs[key] }).catch(() =>
      setMessage('Could not save athlete preference.'),
    );
  }

  return (
    <section className="notif-settings">
      <h3>Email notifications</h3>
      <label className="notif-master">
        <input
          type="checkbox"
          checked={emailEnabled}
          onChange={toggleEmail}
          disabled={!loaded}
        />
        <span>Email me about my favorites</span>
      </label>
      <p className="muted">Sent to {user.email}. New results daily; ranking changes weekly.</p>

      {favorites.length === 0 ? (
        <p className="muted">Star an athlete to choose what you get notified about.</p>
      ) : (
        <ul className="notif-list">
          {favorites.map((f) => (
            <li key={f.id} className="notif-row">
              <span className="notif-name">{f.athlete_name}</span>
              <span className="notif-triggers">
                {TRIGGERS.map((t) => (
                  <label key={t.key} aria-label={`${f.athlete_name} ${t.label}`}>
                    <input
                      type="checkbox"
                      checked={f.notify_prefs[t.key]}
                      disabled={!emailEnabled}
                      onChange={() => toggleTrigger(f.athlete_slug, f.gender, f.notify_prefs, t.key)}
                    />
                    {t.label}
                  </label>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="lookup-msg">{message}</p>}
    </section>
  );
}
