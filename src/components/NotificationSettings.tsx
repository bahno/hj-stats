import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useFavorites } from '../hooks/FavoritesContext';
import { getNotificationSettings, updateNotificationSettings } from '../data/userData';
import { eventGroupsFor, findEventGroup } from '../data/events';
import type { Gender, NotifyPrefs } from '../data/types';

// `label` is the full accessible name (used for each checkbox's aria-label);
// `header` is the short visible column heading so all four columns stay equal.
const TRIGGERS: Array<{ key: keyof NotifyPrefs; label: string; header?: string }> = [
  { key: 'place', label: 'Place' },
  { key: 'score', label: 'Score' },
  { key: 'result', label: 'Result' },
  { key: 'qualification', label: 'Qualification', header: 'Quali' },
];

/** A slug that no longer names a group still has to be shown, or removing it
 *  would mean deleting something the user can't see. */
function eventLabel(slug: string, gender: Gender): string {
  return findEventGroup(slug, gender)?.mainEvent ?? slug;
}

export function NotificationSettings() {
  const { user } = useAuth();
  const { favorites, updatePrefs, updateEventGroups } = useFavorites();
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;
    getNotificationSettings(user.id)
      .then((s) => {
        if (active) setEmailEnabled(Boolean(s?.email_enabled));
      })
      .catch(() => {
        // Leave the toggle off but say why, rather than showing a confident
        // "off" that is really "we don't know" (and an unhandled rejection).
        if (active) setMessage('Could not load your notification setting.');
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

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

  function saveEvents(slug: string, gender: Gender, groups: string[]) {
    void updateEventGroups(slug, gender, groups).catch(() =>
      setMessage('Could not save athlete events.'),
    );
  }

  return (
    <section className="notif-settings">
      <h3>Email notifications</h3>
      <label className="notif-master">
        <input
          className="notif-check"
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
        <div className="notif-grid">
          <div className="notif-ghead">
            <span className="notif-corner" aria-hidden="true" />
            {TRIGGERS.map((t) => (
              <span key={t.key} className="notif-col">
                {t.header ?? t.label}
              </span>
            ))}
            <span className="notif-rule" aria-hidden="true" />
          </div>
          {favorites.map((f) => (
            <div key={f.id} className={`notif-grow ${f.gender}`}>
              <span className="notif-name">{f.athlete_name}</span>
              {TRIGGERS.map((t) => (
                <span key={t.key} className="notif-cell">
                  <input
                    className="notif-check"
                    type="checkbox"
                    aria-label={`${f.athlete_name} — ${t.label}`}
                    checked={f.notify_prefs[t.key]}
                    disabled={!emailEnabled}
                    onChange={() => toggleTrigger(f.athlete_slug, f.gender, f.notify_prefs, t.key)}
                  />
                </span>
              ))}
              {/* Which of the athlete's disciplines this favorite covers. One
                  person is one favorite, so the set lives here rather than
                  costing a second star (and a second slot against the cap). */}
              <div className="notif-events">
                {f.event_groups.map((slug) => (
                  <span key={slug} className="notif-event">
                    {eventLabel(slug, f.gender)}
                    {f.event_groups.length > 1 && (
                      <button
                        type="button"
                        className="notif-event-x"
                        aria-label={`Stop following ${f.athlete_name} in ${eventLabel(slug, f.gender)}`}
                        onClick={() =>
                          saveEvents(
                            f.athlete_slug,
                            f.gender,
                            f.event_groups.filter((s) => s !== slug),
                          )
                        }
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                <select
                  className="notif-event-add"
                  aria-label={`Add an event for ${f.athlete_name}`}
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    saveEvents(f.athlete_slug, f.gender, [...f.event_groups, e.target.value]);
                  }}
                >
                  <option value="">+ Event</option>
                  {eventGroupsFor(f.gender)
                    .filter((g) => !f.event_groups.includes(g.slug))
                    .map((g) => (
                      <option key={g.slug} value={g.slug}>
                        {g.mainEvent}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
      {message && <p className="lookup-msg">{message}</p>}
    </section>
  );
}
