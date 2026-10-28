import type { ReactElement } from 'react';
import { Link, useRevalidator, type ShouldRevalidateFunctionArgs } from 'react-router';

import { canUpgradeTableSystem } from '@vtt/shared';
import type { TableTypes } from '@vtt/shared/api';
import { Alert } from '@vtt/ui';

import { ApiError } from '../api/client.js';
import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { upgradeAvailable } from '../features/settings/system-version.js';
import type { TableData, TableLoaderData } from '../features/table/table-data.js';
import { useStageLink } from '../features/workspace/stage-link.js';
import { Workspace } from '../features/workspace/Workspace.js';
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
 * Opening pages or changing filters keeps the table, members and chat; a revalidation (after an
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

/** One table, as a full-page workspace (FR-TABLE-08, ADR-059). */
export default function TableRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const { user } = useSession();
  const { data, error } = loaderData;

  if (!data || !user) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <Alert tone="error">{error ?? t('app.error')}</Alert>
        <Link to="/">{t('table.back')}</Link>
      </div>
    );
  }
  return <TablePage data={data} userId={user.id} />;
}

function TablePage({ data, userId }: { data: TableData; userId: string }): ReactElement {
  const { table } = data;
  const revalidator = useRevalidator();
  const system = useTableSystem(table);
  const stageLink = useStageLink();
  // Other members' changes refresh the lists (FR-ENT-07); so does a reconnection, which may
  // have missed some.
  useTableEvents(table.id, {
    onEvent: (event) => {
      // Changed house rules recompute open sheets' derived values (ADR-039).
      if (event.type === 'entity.changed' || event.type === 'table.updated') {
        void revalidator.revalidate();
      }
    },
    onResync: () => void revalidator.revalidate(),
  });

  const upgrade =
    table.archivedAt === null && canUpgradeTableSystem(table.role) && upgradeAvailable(table);
  const notices = (table.archivedAt !== null || upgrade || system.status === 'unavailable') && (
    <div className="flex flex-col gap-2 px-3 pt-2">
      {table.archivedAt !== null && <Alert tone="info">{t('table.archived')}</Alert>}
      {upgrade && (
        <Alert tone="info">
          {t('table.upgradeAvailable', {
            name: table.systemName,
            version: table.installedVersion ?? '',
            current: table.systemVersion,
          })}{' '}
          <Link to={stageLink(`/tables/${table.id}/settings`)}>{t('table.upgradeLink')}</Link>
        </Alert>
      )}
      {system.status === 'unavailable' && (
        <Alert tone="info">{t('table.readOnly', { name: table.systemName })}</Alert>
      )}
    </div>
  );

  return (
    <TableSystemContext value={system}>
      <Workspace data={data} userId={userId} notices={notices} />
    </TableSystemContext>
  );
}
