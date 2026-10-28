import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  route('setup', 'routes/setup.tsx'),
  route('login', 'routes/login.tsx'),
  route('invite/:token', 'routes/invite.tsx'),
  layout('routes/app-layout.tsx', [
    index('routes/tables.tsx'),
    route('tables/:tableId', 'routes/table.tsx', [
      index('routes/table-actors.tsx'),
      route('items', 'routes/table-items.tsx'),
      route('actors/:actorId', 'routes/table-actor.tsx'),
      route('journal', 'routes/table-journal.tsx'),
      route('journal/:entryId', 'routes/table-journal-entry.tsx'),
      route('members', 'routes/table-members.tsx'),
      route('settings', 'routes/table-settings.tsx'),
    ]),
    route('account', 'routes/account.tsx'),
    route('admin/plugins', 'routes/admin-plugins.tsx'),
    route('admin/settings', 'routes/admin-settings.tsx'),
  ]),
  route('*', 'routes/catch-all.tsx'),
] satisfies RouteConfig;
