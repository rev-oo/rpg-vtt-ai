import { lazy, Suspense, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';

import type { Value } from '@vtt/formula';
import { documentLayout } from '@vtt/plugin-engine';
import { canSendChat, isGmLike } from '@vtt/shared';
import type { ActorView, RollRequestInput, TableView } from '@vtt/shared/api';
import type { RichTextProps } from '@vtt/sheet-renderer';
import { Alert } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { useSheetPresence } from '../collab/presence.js';
import { useLiveSheet } from '../collab/use-live-sheet.js';
import { useTableData } from '../features/table/table-data.js';
import { t } from '../i18n/index.js';
import { entityType } from '../plugin-host/entity-type.js';
import { PluginSheet } from '../plugin-host/PluginSheet.js';
import { useSystem, type TableSystem } from '../plugin-host/system-context.js';
import { useSession } from '../shell/use-session.js';

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

/** An actor's live sheet (T-0409, T-0506): edited together over `/ws/collab`. */
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
          {failure && <Alert tone="error">{failure}</Alert>}
          {status && (
            <p role="status" className="text-sm text-muted">
              {status}
            </p>
          )}
          <LiveActorSheet
            host={host}
            actor={actor}
            secret={isGmLike(table.role)}
            onRoll={mayRoll ? roll : undefined}
          />
        </>
      )}
    </section>
  );
}

type ReadySystem = Extract<TableSystem, { status: 'ready' }>;

// The editor and ProseMirror load only for sheets with rich text (ADR-037).
const RichTextEditor = lazy(() =>
  import('../collab/RichTextEditor.js').then((module) => ({ default: module.RichTextEditor })),
);

const NO_FIELDS = { main: {}, secret: undefined };

function LiveActorSheet({
  host,
  actor,
  secret,
  onRoll,
}: {
  host: ReadySystem;
  actor: ActorView;
  secret: boolean;
  onRoll: ((name: string, args: Readonly<Record<string, Value>>) => void) | undefined;
}): ReactElement {
  const type = entityType(host.system.definition, 'actor', actor.type);
  const layout = useMemo(() => (type ? documentLayout(type.schema) : NO_FIELDS), [type]);
  const live = useLiveSheet(actor.id, layout, { secret });
  const { members } = useTableData();
  const userId = useSession().user?.id ?? '';
  const presence = useSheetPresence(live.status === 'ready' ? live.awareness : undefined, {
    userId,
    members,
  });
  const store = live.status === 'ready' ? live.store : undefined;
  const renderRichText = useCallback(
    ({ path, ...props }: RichTextProps) => {
      const fragment = store?.richText(path);
      return (
        fragment && (
          <Suspense fallback={<p className="text-muted">{t('sheet.loading')}</p>}>
            <RichTextEditor key={path.join('.')} fragment={fragment} {...props} />
          </Suspense>
        )
      );
    },
    [store],
  );

  if (live.status === 'denied') return <Alert tone="error">{t('sheet.notFound')}</Alert>;
  if (live.status === 'connecting') return <p className="text-muted">{t('sheet.connecting')}</p>;
  return (
    <>
      {live.issues.length > 0 && (
        <Alert tone="info">{t('sheet.repaired', { count: live.issues.length })}</Alert>
      )}
      <PluginSheet
        host={host}
        actor={actor}
        kind="actor"
        store={live.store}
        presence={presence}
        renderRichText={renderRichText}
        readOnly={live.readOnly || actor.access !== 'owner'}
        secret={secret}
        onRoll={onRoll}
      />
    </>
  );
}
