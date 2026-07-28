import { useState } from 'react';
import { Calculator } from './components/Calculator';
import { AthleteLookup } from './components/AthleteLookup';
import { Nav, type View } from './components/Nav';
import { Logo } from './components/Logo';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthModal } from './auth/AuthModal';
import { AccountPage } from './auth/AccountPage';
import { PasswordRecovery } from './auth/PasswordRecovery';
import { isAuthEnabled } from './lib/supabase';
import { FavoritesProvider } from './hooks/FavoritesContext';
import { readParams, writeParams } from './urlState';

function UserIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function AccountSlot({
  active,
  onOpenAccount,
  onSignIn,
}: {
  active: boolean;
  onOpenAccount: () => void;
  onSignIn: () => void;
}) {
  const { user } = useAuth();
  if (!isAuthEnabled) return null;
  const signedIn = Boolean(user);
  return (
    <button
      type="button"
      className={`account-icon-btn${signedIn ? ' on' : ''}${active ? ' active' : ''}`}
      onClick={signedIn ? onOpenAccount : onSignIn}
      aria-label={signedIn ? 'Account' : 'Sign in'}
      title={signedIn ? (user!.email ?? 'Account') : 'Sign in'}
    >
      <UserIcon />
    </button>
  );
}

function Shell() {
  // Rankings, not the calculator: the calculator is high-jump-only until the
  // scoring tables land, and it should not be the first thing the app shows.
  // Only the calculator needs naming in a link — rankings is the default, and
  // the account page is nobody's to share.
  const [view, setView] = useState<View>(() =>
    readParams().get('view') === 'calculator' ? 'calculator' : 'rankings',
  );

  function changeView(v: View) {
    setView(v);
    writeParams({ view: v === 'calculator' ? 'calculator' : null });
  }
  const [showAuth, setShowAuth] = useState(false);
  const { recovering } = useAuth();

  const body = recovering ? (
    <PasswordRecovery />
  ) : view === 'calculator' ? (
    <Calculator />
  ) : view === 'rankings' ? (
    <AthleteLookup />
  ) : (
    <AccountPage />
  );

  return (
    <main className="app">
      <div className="brand-corner">
        <Logo />
      </div>
      {/* During password recovery the only thing on offer is setting the new
          password — navigating away would strand the user in a session whose
          password they don't know. */}
      {!recovering && (
        <>
          <div className="account-corner">
            <AccountSlot
              active={view === 'account'}
              onOpenAccount={() => changeView('account')}
              onSignIn={() => setShowAuth(true)}
            />
          </div>
          <Nav value={view} onChange={changeView} />
        </>
      )}
      {body}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FavoritesProvider>
        <Shell />
      </FavoritesProvider>
    </AuthProvider>
  );
}
