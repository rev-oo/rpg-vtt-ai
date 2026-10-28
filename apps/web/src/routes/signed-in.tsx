import type { ReactElement } from 'react';
import { Outlet, redirect } from 'react-router';

import { userRedirect } from '../shell/access.js';
import { loadInstanceInfo } from '../shell/instance.js';
import { loadSession } from '../shell/session.js';
import type { SignedInData } from '../shell/use-site-name.js';

import type { Route } from './+types/signed-in';

/** Signed-in area: everyone else goes to setup or login first. */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<Response | SignedInData> {
  const [session, instance] = await Promise.all([loadSession(), loadInstanceInfo()]);
  const to = userRedirect(session, new URL(request.url));
  return to ? redirect(to) : { siteName: instance.siteName };
}

// Re-check access on every navigation (e.g. after the forced password change).
export function shouldRevalidate(): boolean {
  return true;
}

export default function SignedIn(): ReactElement {
  return <Outlet />;
}
