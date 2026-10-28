import { render, type RenderResult } from '@testing-library/react';
import { createRoutesStub, type LoaderFunctionArgs } from 'react-router';

import { TABLE_ROUTE_ID } from '../../src/features/table/table-data.js';
import * as root from '../../src/root.js';
import * as account from '../../src/routes/account.js';
import * as adminPlugins from '../../src/routes/admin-plugins.js';
import * as appLayout from '../../src/routes/app-layout.js';
import * as catchAll from '../../src/routes/catch-all.js';
import * as login from '../../src/routes/login.js';
import * as setup from '../../src/routes/setup.js';
import * as signedIn from '../../src/routes/signed-in.js';
import * as table from '../../src/routes/table.js';
import * as tables from '../../src/routes/tables.js';
import { invalidateSession } from '../../src/shell/session.js';
import { SIGNED_IN_ROUTE_ID } from '../../src/shell/use-site-name.js';

import { RootWithProbe } from './RootWithProbe.js';

/** Framework-mode `clientLoader`s also receive `serverLoader`; SPA mode has none. */
function asLoader<T>(
  clientLoader: (args: LoaderFunctionArgs & { serverLoader: () => Promise<undefined> }) => T,
): (args: LoaderFunctionArgs) => T {
  return (args) => clientLoader({ ...args, serverLoader: () => Promise.resolve(undefined) });
}

const tableParams = (args: LoaderFunctionArgs) => ({
  tableId: args.params.tableId ?? '',
});

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
        id: SIGNED_IN_ROUTE_ID,
        Component: signedIn.default,
        loader: asLoader(signedIn.clientLoader),
        shouldRevalidate: signedIn.shouldRevalidate,
        children: [
          {
            Component: appLayout.default,
            children: [
              { index: true, Component: tables.default, loader: tables.clientLoader },
              { path: 'account', Component: account.default },
              {
                path: 'admin/plugins',
                Component: adminPlugins.default,
                loader: asLoader(adminPlugins.clientLoader),
              },
            ],
          },
          {
            id: TABLE_ROUTE_ID,
            path: 'tables/:tableId',
            Component: table.default,
            // Typegen types `params` from the route path, which the stub cannot know.
            loader: asLoader((args) => table.clientLoader({ ...args, params: tableParams(args) })),
            shouldRevalidate: table.shouldRevalidate,
          },
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
