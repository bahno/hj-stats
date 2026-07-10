import { useState } from 'react';
import { Calculator } from './components/Calculator';
import { AthleteLookup } from './components/AthleteLookup';
import { Nav, type View } from './components/Nav';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthModal } from './auth/AuthModal';
import { AccountPage } from './auth/AccountPage';
import { isAuthEnabled } from './lib/supabase';

function AccountSlot({
  onOpenAccount,
  onSignIn,
}: {
  onOpenAccount: () => void;
  onSignIn: () => void;
}) {
  const { user } = useAuth();
  if (!isAuthEnabled) return null;
  if (user) {
    return (
      <button type="button" className="nav-account-btn" onClick={onOpenAccount}>
        {user.email}
      </button>
    );
  }
  return (
    <button type="button" className="nav-account-btn" onClick={onSignIn}>
      Sign in
    </button>
  );
}

function Shell() {
  const [view, setView] = useState<View>('calculator');
  const [showAuth, setShowAuth] = useState(false);

  const body =
    view === 'calculator' ? (
      <Calculator />
    ) : view === 'rankings' ? (
      <AthleteLookup />
    ) : (
      <AccountPage />
    );

  return (
    <main className="app">
      <Nav
        value={view}
        onChange={setView}
        account={
          <AccountSlot
            onOpenAccount={() => setView('account')}
            onSignIn={() => setShowAuth(true)}
          />
        }
      />
      {body}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
