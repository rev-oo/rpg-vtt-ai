import { useState, type ReactElement } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { Button } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { t } from '../i18n/index.js';

import { useSession } from './session-store.js';

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  isActive
    ? 'rounded-lg bg-info-soft px-2 py-1 text-fg no-underline'
    : 'rounded-lg px-2 py-1 text-muted no-underline hover:text-fg';

export function AppLayout(): ReactElement {
  const user = useSession((s) => s.user);
  const signedOut = useSession((s) => s.signedOut);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await api.logout();
    } finally {
      // Sign out locally even if the session was already gone on the server.
      signedOut();
      void navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:gap-4 sm:px-6">
        <span className="text-xl font-bold">{t('app.name')}</span>
        <nav className="flex gap-1" aria-label={t('app.name')}>
          <NavLink to="/" end className={navLinkClass}>
            {t('nav.tables')}
          </NavLink>
          <NavLink to="/account" className={navLinkClass}>
            {t('nav.account')}
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">
            {user && t('nav.signedInAs', { name: user.displayName })}
          </span>
          <Button variant="ghost" onClick={() => void logout()} disabled={busy}>
            {t('nav.logout')}
          </Button>
        </div>
      </header>
      <main className="p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
