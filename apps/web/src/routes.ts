import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  route('setup', 'routes/setup.tsx'),
  route('login', 'routes/login.tsx'),
  route('invite/:token', 'routes/invite.tsx'),
  layout('routes/signed-in.tsx', [
    layout('routes/app-layout.tsx', [
      index('routes/tables.tsx'),
      route('account', 'routes/account.tsx'),
      route('admin/plugins', 'routes/admin-plugins.tsx'),
      route('admin/settings', 'routes/admin-settings.tsx'),
    ]),
    // A table is a full-page workspace outside the app's header. It has one URL: its panels,
    // not child routes, show sheets, entries and pages (FR-TABLE-08, ADR-059).
    route('tables/:tableId', 'routes/table.tsx'),
  ]),
  route('*', 'routes/catch-all.tsx'),
] satisfies RouteConfig;
