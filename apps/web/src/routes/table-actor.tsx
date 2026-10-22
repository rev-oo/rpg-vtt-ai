import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';

import type { Value } from '@vtt/formula';
import { canSendChat, isGmLike } from '@vtt/shared';
import type { ActorView, RollRequestInput, TableView } from '@vtt/shared/api';
import { Alert } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { useTableData } from '../features/table/table-data.js';
import { t } from '../i18n/index.js';
import { PluginSheet } from '../plugin-host/PluginSheet.js';
import { useSystem } from '../plugin-host/system-context.js';

type RecipeArgs = NonNullable<RollRequestInput['recipe']>['args'];

/** Roll arguments as the request takes them; lists cannot be sent. */
function recipeArgs(args: Readonly<Record<string, Value>>): RecipeArgs | null {
  const sent: RecipeArgs = {};
  for (const [name, value] of Object.entries(args)) {
    if (typeof value === 'object') return null;
    sent[name] = value;
  }
  return sent;
}

/** An actor's sheet (T-0409). It shows the stored data; editing arrives with M5. */
export default function TableActorRoute(): ReactElement {
  const { actorId } = useParams();
  const { table, actors } = useTableData();
  const actor = actors.find((a) => a.id === actorId);
  return (
    <div className="flex flex-col gap-3">
      <Link to={`/tables/${table.id}`}>{t('sheet.back')}</Link>
      {actor ? (
        <ActorSheet key={actor.id} table={table} actor={actor} />
      ) : (
        <Alert tone="error">{t('sheet.notFound')}</Alert>
      )}
    </div>
  );
}

function ActorSheet({ table, actor }: { table: TableView; actor: ActorView }): ReactElement {
  const host = useSystem();
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const roll = (name: string, args: Readonly<Record<string, Value>>) => {
    setStatus(null);
    setFailure(null);
    const sent = recipeArgs(args);
    if (!sent) {
      setFailure(t('sheet.badArgs'));
      return;
    }
    api.roll(table.id, { recipe: { name, args: sent }, actorId: actor.id }).then(
      () => {
        setStatus(t('sheet.rolled'));
      },
      (error: unknown) => {
        setFailure(errorMessage(error));
      },
    );
  };
  const mayRoll = actor.access === 'owner' && canSendChat(table.role);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="sheet-title">
      <h2 id="sheet-title" className="text-xl font-semibold">
        {actor.name}
      </h2>
      {host.status === 'loading' && <p className="text-muted">{t('sheet.loading')}</p>}
      {host.status === 'unavailable' && <Alert tone="info">{t('sheet.unavailable')}</Alert>}
      {host.status === 'error' && (
        <Alert tone="error">{t('table.systemFailed', { detail: host.error })}</Alert>
      )}
      {host.status === 'ready' && (
        <>
          <p className="text-sm text-muted">{t('sheet.readOnlyUntilLive')}</p>
          {failure && <Alert tone="error">{failure}</Alert>}
          {status && (
            <p role="status" className="text-sm text-muted">
              {status}
            </p>
          )}
          <PluginSheet
            host={host}
            actor={actor}
            kind="actor"
            readOnly
            secret={isGmLike(table.role)}
            onRoll={mayRoll ? roll : undefined}
          />
        </>
      )}
    </section>
  );
}
