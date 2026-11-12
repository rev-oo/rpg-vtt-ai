import { useId, useState, type ReactElement } from 'react';

import { canSendChat, isGmLike } from '@vtt/shared';
import { updateActorBody, type ActorView, type TableView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { RenameForm } from '../../forms/RenameForm.js';
import { t } from '../../i18n/index.js';
import { useSystem } from '../../plugin-host/system-context.js';
import { EntityImage } from '../assets/EntityImage.js';
import { useTableData } from '../table/table-data.js';

import { LiveEntitySheet } from './LiveEntitySheet.js';
import { SheetHistory } from './SheetHistory.js';
import { useRecipeRoll } from './use-recipe-roll.js';

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
  const { roll, status, failure } = useRecipeRoll(table.id);
  const mayRoll = actor.access === 'owner' && canSendChat(table.role);
  const editable = actor.access === 'owner' && table.archivedAt === null;
  const [renaming, setRenaming] = useState(false);
  const [renameFailure, setRenameFailure] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <RenameForm
            name={actor.name}
            label={t('entities.name')}
            schema={updateActorBody.shape.name.unwrap()}
            onCancel={() => {
              setRenaming(false);
            }}
            onSave={async (name) => {
              setRenameFailure(null);
              try {
                // The table's data reloads on the change, and the panel's title with it.
                await api.updateActor(actor.id, { name });
                setRenaming(false);
              } catch (caught) {
                setRenameFailure(errorMessage(caught));
              }
            }}
          />
        ) : (
          <h2 id={titleId} className="flex-1 text-xl font-semibold">
            {actor.name}
          </h2>
        )}
        {!renaming && editable && (
          <Button
            onClick={() => {
              setRenaming(true);
            }}
          >
            {t('entities.rename')}
          </Button>
        )}
        {host.status === 'ready' && actor.access === 'owner' && <SheetHistory actorId={actor.id} />}
      </div>
      {renameFailure && <Alert tone="error">{renameFailure}</Alert>}
      <EntityImage
        name={actor.name}
        imageUrl={actor.imageUrl}
        editable={editable}
        onChange={(imageUrl) => api.updateActor(actor.id, { imageUrl })}
      />
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
            onRoll={
              mayRoll
                ? (name, args, item, options) => {
                    roll(actor.id, name, args, item?.id, options);
                  }
                : undefined
            }
          />
        </>
      )}
    </section>
  );
}
