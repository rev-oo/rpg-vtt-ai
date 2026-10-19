import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';

import { safeNext } from './next.js';
import { useSession } from './session-store.js';

/** Routes for signed-in users. Sends everyone else to setup or login. */
export function RequireUser(): ReactElement {
  const { needsSetup, user } = useSession();
  const location = useLocation();

  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  // Admin-created accounts start with a one-time password (FR-AUTH-02).
  if (user.mustChangePassword && location.pathname !== '/account') {
    return <Navigate to="/account" replace />;
  }
  return <Outlet />;
}

/** Routes for signed-out visitors (login). Once signed in, continue to `?next=`. */
export function RequireGuest(): ReactElement {
  const { needsSetup, user } = useSession();
  const [params] = useSearchParams();
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={safeNext(params.get('next'))} replace />;
  return <Outlet />;
}

/** The setup screen only exists until the first user is created (FR-AUTH-01). */
export function RequireSetup(): ReactElement {
  const needsSetup = useSession((s) => s.needsSetup);
  return needsSetup ? <Outlet /> : <Navigate to="/" replace />;
}
