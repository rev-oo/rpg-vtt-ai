import { useState, type ReactElement } from 'react';
import { NavLink, Outlet, redirect, useNavigate } from 'react-router';

import { Button } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { t } from '../i18n/index.js';
import { userRedirect } from '../shell/access.js';
import { loadInstanceInfo } from '../shell/instance.js';
import { clearSession, loadSession } from '../shell/session.js';
import { useSession } from '../shell/use-session.js';

import type { Route } from './+types/app-layout';

/** Signed-in area: everyone else goes to setup or login first. */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<Response | { siteName: string }> {
  const [session, instance] = await Promise.all([loadSession(), loadInstanceInfo()]);
  const to = userRedirect(session, new URL(request.url));
  return to ? redirect(to) : { siteName: instance.siteName };
}

// Re-check access on every navigation (e.g. after the forced password change).
export function shouldRevalidate(): boolean {
  return true;
}

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  isActive
    ? 'rounded-lg bg-info-soft px-2 py-1 text-fg no-underline'
    : 'rounded-lg px-2 py-1 text-muted no-underline hover:text-fg';

export default function AppLayout({ loaderData }: Route.ComponentProps): ReactElement {
  const { user } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await api.logout();
    } finally {
      // Sign out locally even if the session was already gone on the server.
      clearSession();
      await navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:gap-4 sm:px-6">
        <span className="text-xl font-bold">{loaderData.siteName}</span>
        <nav className="flex gap-1" aria-label={t('nav.main')}>
          <NavLink to="/" end className={navLinkClass}>
            {t('nav.tables')}
          </NavLink>
          <NavLink to="/account" className={navLinkClass}>
            {t('nav.account')}
          </NavLink>
          {user?.isAdmin && (
            <NavLink to="/admin/plugins" className={navLinkClass}>
              {t('nav.plugins')}
            </NavLink>
          )}
          {user?.isAdmin && (
            <NavLink to="/admin/settings" className={navLinkClass}>
              {t('nav.instance')}
            </NavLink>
          )}
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
