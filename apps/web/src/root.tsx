import './styles.css';
import './forms/zod-messages.js';

import type { ReactElement, ReactNode } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRevalidator } from 'react-router';

import { Alert, Button } from '@vtt/ui';

import { t } from './i18n/index.js';
import { invalidateSession, loadSession, type SessionState } from './shell/session.js';

export function Layout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{t('app.name')}</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Resolves the session for every route; child loaders share the same cached request. */
export async function clientLoader(): Promise<SessionState> {
  return loadSession();
}

// The session lives in a client-side cache, so re-reading it on every navigation is free and
// keeps the header in sync after login, logout or a profile change.
export function shouldRevalidate(): boolean {
  return true;
}

export default function App(): ReactElement {
  return <Outlet />;
}

const centered = 'grid min-h-screen place-items-center content-center gap-4 p-4';

export function HydrateFallback(): ReactElement {
  return (
    <main className={`${centered} text-muted`} aria-busy="true">
      {t('app.loading')}
    </main>
  );
}

/** Shown when the server cannot be reached or a loader fails unexpectedly. */
export function ErrorBoundary(): ReactElement {
  const revalidator = useRevalidator();
  return (
    <main className={centered}>
      <Alert tone="error">{t('app.error')}</Alert>
      <Button
        onClick={() => {
          invalidateSession();
          void revalidator.revalidate();
        }}
      >
        {t('app.retry')}
      </Button>
    </main>
  );
}
