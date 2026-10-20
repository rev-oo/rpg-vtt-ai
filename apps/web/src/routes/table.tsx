import type { ReactElement } from 'react';
import { Link } from 'react-router';

import type { ActorView, MemberView, TableView } from '@vtt/shared/api';
import { Alert } from '@vtt/ui';

import { ApiError } from '../api/client.js';
import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { ChatPanel } from '../features/chat/ChatPanel.js';
import type { ChatPage } from '../features/chat/messages.js';
import { t } from '../i18n/index.js';
import { useSession } from '../shell/use-session.js';

import type { Route } from './+types/table';

type TableData =
  | { table: TableView; members: MemberView[]; actors: ActorView[]; chat: ChatPage; error: null }
  | { table: null; members: null; actors: null; chat: null; error: string };

/** A missing table or membership shows inline, like the tables list. */
export async function clientLoader({ params }: Route.ClientLoaderArgs): Promise<TableData> {
  try {
    const [table, members, actors, chat] = await Promise.all([
      api.getTable(params.tableId),
      api.listMembers(params.tableId),
      api.listActors(params.tableId),
      api.chatHistory(params.tableId),
    ]);
    return { table, members, actors, chat, error: null };
  } catch (error) {
    const message =
      error instanceof ApiError && (error.status === 404 || error.status === 400)
        ? t('table.notFound')
        : errorMessage(error);
    return { table: null, members: null, actors: null, chat: null, error: message };
  }
}

/** One table: its entities (T-0208) and the chat. */
export default function TableRoute({ loaderData }: Route.ComponentProps): ReactElement {
  const { user } = useSession();
  const { table, members, actors, chat, error } = loaderData;

  if (!table || !user) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Alert tone="error">{error ?? t('app.error')}</Alert>
        <Link to="/">{t('table.back')}</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:h-[calc(100vh-7rem)] lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1 className="text-2xl font-bold">{table.name}</h1>
        <p className="text-sm text-muted">
          {t(`tables.role.${table.role}`)} ·{' '}
          {t('tables.system', { name: table.systemName, version: table.systemVersion })}
        </p>
        {table.description && <p>{table.description}</p>}
        <p className="text-muted">{t('table.entitiesSoon')}</p>
      </div>
      <div className="h-[70vh] lg:h-full lg:w-96">
        <ChatPanel
          table={table}
          members={members}
          userId={user.id}
          speakers={actors.filter((actor) => actor.access === 'owner')}
          initialPage={chat}
        />
      </div>
    </div>
  );
}
