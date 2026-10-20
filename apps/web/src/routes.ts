import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  route('setup', 'routes/setup.tsx'),
  route('login', 'routes/login.tsx'),
  layout('routes/app-layout.tsx', [
    index('routes/tables.tsx'),
    route('tables/:tableId', 'routes/table.tsx', [
      index('routes/table-actors.tsx'),
      route('items', 'routes/table-items.tsx'),
    ]),
    route('account', 'routes/account.tsx'),
  ]),
  route('*', 'routes/catch-all.tsx'),
] satisfies RouteConfig;
