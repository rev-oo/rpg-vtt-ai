import { safeNext } from './next.js';
import type { SessionState } from './session.js';

// Route access rules, applied by each route's clientLoader before it renders.

/** The setup screen only exists until the first user is created (FR-AUTH-01). */
export function setupRedirect(session: SessionState): string | null {
  return session.needsSetup ? null : '/';
}

/** Login is for signed-out visitors; once signed in, continue to `?next=`. */
export function guestRedirect(session: SessionState, url: URL): string | null {
  if (session.needsSetup) return '/setup';
  if (session.user) return safeNext(url.searchParams.get('next'));
  return null;
}

/** Everything else needs a user, who must first replace a one-time password (FR-AUTH-02). */
export function userRedirect(session: SessionState, url: URL): string | null {
  if (session.needsSetup) return '/setup';
  if (!session.user) {
    return `/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`;
  }
  if (session.user.mustChangePassword && url.pathname !== '/account') return '/account';
  return null;
}

/** Admin pages: anyone else goes to their tables (FR-ADMIN-02). */
export function adminRedirect(session: SessionState, url: URL): string | null {
  return userRedirect(session, url) ?? (session.user?.isAdmin ? null : '/');
}
