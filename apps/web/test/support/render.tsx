import { render, type RenderResult } from '@testing-library/react';
import { createRoutesStub, type LoaderFunctionArgs } from 'react-router';

import * as root from '../../src/root.js';
import * as account from '../../src/routes/account.js';
import * as appLayout from '../../src/routes/app-layout.js';
import * as catchAll from '../../src/routes/catch-all.js';
import * as login from '../../src/routes/login.js';
import * as setup from '../../src/routes/setup.js';
import * as tables from '../../src/routes/tables.js';
import { invalidateSession } from '../../src/shell/session.js';

import { RootWithProbe } from './RootWithProbe.js';

/** Framework-mode `clientLoader`s also receive `serverLoader`; SPA mode has none. */
function asLoader<T>(
  clientLoader: (args: LoaderFunctionArgs & { serverLoader: () => Promise<undefined> }) => T,
): (args: LoaderFunctionArgs) => T {
  return (args) => clientLoader({ ...args, serverLoader: () => Promise.resolve(undefined) });
}

// Mirrors src/routes.ts with the real route modules; `Layout` (the <html> shell) is skipped.
const Stub = createRoutesStub([
  {
    id: 'root',
    path: '/',
    Component: RootWithProbe,
    HydrateFallback: root.HydrateFallback,
    ErrorBoundary: root.ErrorBoundary,
    loader: root.clientLoader,
    shouldRevalidate: root.shouldRevalidate,
    children: [
      { path: 'setup', Component: setup.default, loader: setup.clientLoader },
      { path: 'login', Component: login.default, loader: asLoader(login.clientLoader) },
      {
        Component: appLayout.default,
        loader: asLoader(appLayout.clientLoader),
        shouldRevalidate: appLayout.shouldRevalidate,
        children: [
          { index: true, Component: tables.default, loader: tables.clientLoader },
          { path: 'account', Component: account.default },
        ],
      },
      { path: '*', Component: catchAll.default, loader: catchAll.clientLoader },
    ],
  },
]);

export function renderApp(path = '/'): RenderResult {
  invalidateSession();
  return render(<Stub initialEntries={[path]} />);
}
