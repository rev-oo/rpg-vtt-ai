import type { PublicUser, Session } from '@vtt/shared/api';

import { ApiError, setCsrfToken } from '../api/client.js';
import { api } from '../api/endpoints.js';

export interface SessionState {
  /** True until the first user exists (FR-AUTH-01). */
  needsSetup: boolean;
  user: PublicUser | null;
}

let cached: Promise<SessionState> | null = null;

/**
 * The current session, fetched once and shared by every route loader. Loaders run in
 * parallel, so they share this promise instead of each other's data.
 */
export function loadSession(): Promise<SessionState> {
  cached ??= fetchSession().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** Forgets the cached session; the next loader run fetches it again. */
export function invalidateSession(): void {
  cached = null;
}

/** After login or setup: the response already carries the session. */
export function storeSession(session: Session): void {
  setCsrfToken(session.csrfToken);
  cached = Promise.resolve({ needsSetup: false, user: session.user });
}

/** After a profile or password change that keeps the same session. */
export function storeUser(user: PublicUser): void {
  cached = Promise.resolve({ needsSetup: false, user });
}

/** After logout. */
export function clearSession(): void {
  setCsrfToken(null);
  cached = Promise.resolve({ needsSetup: false, user: null });
}

async function fetchSession(): Promise<SessionState> {
  if (await api.setupStatus()) {
    setCsrfToken(null);
    return { needsSetup: true, user: null };
  }
  try {
    const session = await api.me();
    setCsrfToken(session.csrfToken);
    return { needsSetup: false, user: session.user };
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
    setCsrfToken(null);
    return { needsSetup: false, user: null };
  }
}
