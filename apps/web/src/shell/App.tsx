import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { Alert, Button } from '@vtt/ui';

import { AccountPage } from '../features/account/AccountPage.js';
import { LoginPage } from '../features/auth/LoginPage.js';
import { SetupPage } from '../features/auth/SetupPage.js';
import { TablesPage } from '../features/tables/TablesPage.js';
import { t } from '../i18n/index.js';

import { AppLayout } from './AppLayout.js';
import { RequireGuest, RequireSetup, RequireUser } from './guards.js';
import { useSession } from './session-store.js';

/** Resolves the session once, then renders the routes. Wrap in a router. */
export function App(): ReactElement {
  const phase = useSession((s) => s.phase);
  const bootstrap = useSession((s) => s.bootstrap);
  const [failed, setFailed] = useState(false);

  const start = useCallback(() => {
    bootstrap().catch(() => {
      setFailed(true);
    });
  }, [bootstrap]);

  useEffect(start, [start]);

  const retry = () => {
    setFailed(false);
    start();
  };

  if (failed) {
    return (
      <main className="min-h-screen grid place-items-center content-center gap-4 p-4">
        <Alert tone="error">{t('app.error')}</Alert>
        <Button onClick={retry}>{t('app.retry')}</Button>
      </main>
    );
  }
  if (phase === 'loading') {
    return (
      <main
        className="min-h-screen grid place-items-center content-center gap-4 p-4 text-muted"
        aria-busy="true"
      >
        {t('app.loading')}
      </main>
    );
  }

  return (
    <Routes>
      <Route element={<RequireSetup />}>
        <Route path="/setup" element={<SetupPage />} />
      </Route>
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route element={<RequireUser />}>
        <Route element={<AppLayout />}>
          <Route index element={<TablesPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
