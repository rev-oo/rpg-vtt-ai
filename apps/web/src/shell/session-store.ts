import { create } from 'zustand';

import { ApiError, setCsrfToken } from '../api/client.js';
import { api } from '../api/endpoints.js';
import type { PublicUser, Session } from '../api/schemas.js';

export interface SessionState {
  /** `loading` until the first `/setup/status` and `/me` round trip finishes. */
  phase: 'loading' | 'ready';
  needsSetup: boolean;
  user: PublicUser | null;
  bootstrap: () => Promise<void>;
  signedIn: (session: Session) => void;
  signedOut: () => void;
  userUpdated: (user: PublicUser) => void;
}

export const useSession = create<SessionState>()((set) => ({
  phase: 'loading',
  needsSetup: false,
  user: null,

  bootstrap: async () => {
    if (await api.setupStatus()) {
      set({ phase: 'ready', needsSetup: true, user: null });
      return;
    }
    try {
      const session = await api.me();
      setCsrfToken(session.csrfToken);
      set({ phase: 'ready', needsSetup: false, user: session.user });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
      setCsrfToken(null);
      set({ phase: 'ready', needsSetup: false, user: null });
    }
  },

  signedIn: (session) => {
    setCsrfToken(session.csrfToken);
    set({ needsSetup: false, user: session.user });
  },

  signedOut: () => {
    setCsrfToken(null);
    set({ user: null });
  },

  userUpdated: (user) => {
    set({ user });
  },
}));
