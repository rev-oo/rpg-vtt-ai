import { useRouteLoaderData } from 'react-router';

import type { clientLoader } from '../root.js';

import type { SessionState } from './session.js';

/** The session resolved by the root route's loader. */
export function useSession(): SessionState {
  return useRouteLoaderData<typeof clientLoader>('root') ?? { needsSetup: false, user: null };
}
