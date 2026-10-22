import type { ReactElement } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useRevalidator,
  type ShouldRevalidateFunctionArgs,
} from 'react-router';

import type { TableTypes } from '@vtt/shared/api';
import { Alert } from '@vtt/ui';

import { ApiError } from '../api/client.js';
import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { ChatPanel } from '../features/chat/ChatPanel.js';
import type { TableData, TableLoaderData } from '../features/table/table-data.js';
import { t } from '../i18n/index.js';
import { TableSystemContext, useTableSystem } from '../plugin-host/system-context.js';
import { useTableEvents } from '../realtime/use-table-events.js';
import { useSession } from '../shell/use-session.js';

import type { Route } from './+types/table';

/** A table whose system plugin is gone still opens; nothing new can be created. */
const NO_TYPES: TableTypes = { actorTypes: [], itemTypes: [] };

/** A missing table or membership shows inline, like the tables list. */
export async function clientLoader({ params }: Route.ClientLoaderArgs): Promise<TableLoaderData> {
  const id = params.tableId;
  try {
    const [table, members, actors, types, chat] = await Promise.all([
      api.getTable(id),
      api.listMembers(id),
      api.listActors(id),
      api.listTypes(id).catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'system_unavailable') return NO_TYPES;
        throw error;
      }),
      api.chatHistory(id),
    ]);
    return { data: { table, members, actors, types, chat }, error: null };
  } catch (error) {
    const message =
      error instanceof ApiError && (error.status === 404 || error.status === 400)
        ? t('table.notFound')
        : errorMessage(error);
    return { data: null, error: message };
  }
}

/**
 * Switching tabs or filters keeps the table, members and chat; a revalidation (after an
 * entity changed) reloads them, so speakers and copy targets stay current.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  currentParams,
  nextParams,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (currentParams.tableId !== nextParams.tableId) return true;
  if (currentUrl.href !== nextUrl.href) return false;
  return defaultShouldRevalidate;
}

/** One table: its actors and items (child routes) and the chat. */
export default function TableRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const { user } = useSession();
  const { data, error } = loaderData;

  if (!data || !user) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Alert tone="error">{error ?? t('app.error')}</Alert>
        <Link to="/">{t('table.back')}</Link>
      </div>
    );
  }
  return <TablePage data={data} userId={user.id} />;
}

const tabClass = ({ isActive }: { isActive: boolean }): string =>
  isActive
    ? 'rounded-lg bg-info-soft px-3 py-1 text-fg no-underline'
    : 'rounded-lg px-3 py-1 text-muted no-underline hover:text-fg';

function TablePage({ data, userId }: { data: TableData; userId: string }): ReactElement {
  const { table, members, actors, chat } = data;
  const revalidator = useRevalidator();
  const system = useTableSystem(table);
  // Other members' changes refresh the lists (FR-ENT-07); so does a reconnection, which may
  // have missed some.
  useTableEvents(table.id, {
    onEvent: (event) => {
      if (event.type === 'entity.changed') void revalidator.revalidate();
    },
    onResync: () => void revalidator.revalidate(),
  });

  return (
    <TableSystemContext value={system}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:h-[calc(100vh-7rem)] lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3 lg:overflow-y-auto">
          <div>
            <h1 className="text-2xl font-bold">{table.name}</h1>
            <p className="text-sm text-muted">
              {t(`tables.role.${table.role}`)} ·{' '}
              {t('tables.system', { name: table.systemName, version: table.systemVersion })}
            </p>
            {table.description && <p>{table.description}</p>}
          </div>
          {system.status === 'unavailable' && (
            <Alert tone="info">{t('table.readOnly', { name: table.systemName })}</Alert>
          )}
          <nav className="flex gap-1" aria-label={t('table.sections')}>
            <NavLink to={`/tables/${table.id}`} end className={tabClass}>
              {t('actors.title')}
            </NavLink>
            <NavLink to={`/tables/${table.id}/items`} className={tabClass}>
              {t('items.title')}
            </NavLink>
          </nav>
          <Outlet />
        </div>
        <div className="h-[70vh] shrink-0 lg:h-full lg:w-96">
          <ChatPanel
            table={table}
            members={members}
            userId={userId}
            speakers={actors.filter((actor) => actor.access === 'owner')}
            initialPage={chat}
          />
        </div>
      </div>
    </TableSystemContext>
  );
}
