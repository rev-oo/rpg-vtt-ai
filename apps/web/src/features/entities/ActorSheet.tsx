import { useId, useState, type ReactElement } from 'react';

import type { Value } from '@vtt/formula';
import { canSendChat, isGmLike } from '@vtt/shared';
import type { ActorView, RollRequestInput, TableView } from '@vtt/shared/api';
import { Alert } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { useSystem } from '../../plugin-host/system-context.js';
import { useTableData } from '../table/table-data.js';

import { LiveEntitySheet } from './LiveEntitySheet.js';
import { SheetHistory } from './SheetHistory.js';

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

/** An actor's live sheet (T-0409, T-0506): edited together over `/ws/collab`; a workspace panel. */
export function ActorSheetPanel({ actorId }: { actorId: string }): ReactElement {
  const { table, actors } = useTableData();
  const actor = actors.find((a) => a.id === actorId);
  return actor ? (
    <ActorSheet key={actor.id} table={table} actor={actor} />
  ) : (
    <Alert tone="error">{t('sheet.notFound')}</Alert>
  );
}

function ActorSheet({ table, actor }: { table: TableView; actor: ActorView }): ReactElement {
  const host = useSystem();
  // Several sheets may be open at once.
  const titleId = useId();
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
    <section className="flex flex-col gap-3" aria-labelledby={titleId}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-xl font-semibold">
          {actor.name}
        </h2>
        {host.status === 'ready' && actor.access === 'owner' && <SheetHistory actorId={actor.id} />}
      </div>
      {actor.dataVersion !== table.systemVersion && (
        // Plugin data migrations are LATER (§9.7, ADR-058): say so instead.
        <Alert tone="info">
          {t('sheet.dataVersion', {
            system: table.systemName,
            made: actor.dataVersion,
            current: table.systemVersion,
          })}
        </Alert>
      )}
      {host.status === 'loading' && <p className="text-muted">{t('sheet.loading')}</p>}
      {host.status === 'unavailable' && <Alert tone="info">{t('sheet.unavailable')}</Alert>}
      {host.status === 'error' && (
        <Alert tone="error">{t('table.systemFailed', { detail: host.error })}</Alert>
      )}
      {host.status === 'ready' && (
        <>
          {failure && <Alert tone="error">{failure}</Alert>}
          {status && (
            <p role="status" className="text-sm text-muted">
              {status}
            </p>
          )}
          <LiveEntitySheet
            host={host}
            kind="actor"
            entity={actor}
            secret={isGmLike(table.role)}
            onRoll={mayRoll ? roll : undefined}
          />
        </>
      )}
    </section>
  );
}
