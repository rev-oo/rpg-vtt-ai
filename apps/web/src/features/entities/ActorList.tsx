import { useState, type ReactElement } from 'react';
import { Link, useRevalidator } from 'react-router';

import { canCreateActor, canSetOwnership } from '@vtt/shared';
import type { ActorView, ItemView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import type { TableData } from '../table/table-data.js';

import { CreateEntityDialog } from './CreateEntityDialog.js';
import { EntityFilters } from './EntityFilters.js';
import { EntityRow } from './EntityRow.js';
import { OwnershipDialog } from './OwnershipDialog.js';

export interface ActorListProps {
  data: TableData;
  /** The filtered list from the route loader. */
  actors: readonly ActorView[];
  trash: boolean;
  error: string | null;
}

/** The table's actors (FR-ENT-01..04): search, filters, trash and the actions on each. */
export function ActorList({ data, actors, trash, error }: ActorListProps): ReactElement {
  const { table, members, types } = data;
  const revalidator = useRevalidator();
  const [creating, setCreating] = useState(false);
  const [editingOwnership, setEditingOwnership] = useState<ActorView | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const allowAny = table.playersMayCreateAnyActorType;
  const controlOf = new Map(types.actorTypes.map((a) => [a.type, a.controlledBy]));
  const creatable = types.actorTypes
    .filter((a) => canCreateActor(table.role, a.controlledBy, allowAny))
    .map((a) => a.type);
  const canDuplicate = (actor: ActorView) => {
    const controlledBy = controlOf.get(actor.type);
    return controlledBy !== undefined && canCreateActor(table.role, controlledBy, allowAny);
  };

  /** Runs an action, reports it and reloads the list. */
  const run = async (action: () => Promise<string>) => {
    setFailure(null);
    try {
      setStatus(await action());
      await revalidator.revalidate();
    } catch (caught) {
      setStatus(null);
      setFailure(errorMessage(caught));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <EntityFilters
            searchLabel={t('actors.search')}
            types={types.actorTypes.map((a) => a.type)}
          />
        </div>
        {creatable.length > 0 && (
          <Button
            variant="primary"
            onClick={() => {
              setCreating(true);
            }}
          >
            {t('actors.new')}
          </Button>
        )}
      </div>

      {(error ?? failure) && <Alert tone="error">{error ?? failure}</Alert>}
      {status && (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      )}
      {actors.length === 0 && !error && (
        <p className="text-muted">{t(trash ? 'actors.trashEmpty' : 'actors.empty')}</p>
      )}

      <ul className="flex list-none flex-col gap-2 p-0" aria-label={t('actors.title')}>
        {actors.map((actor) => (
          <EntityRow
            key={actor.id}
            name={actor.name}
            type={actor.type}
            imageUrl={actor.imageUrl}
            details={<span>{t(`entities.access.${actor.access}`)}</span>}
            actions={
              trash ? (
                <Button
                  onClick={() =>
                    void run(async () => {
                      await api.restoreActor(actor.id);
                      return t('entities.restored', { name: actor.name });
                    })
                  }
                >
                  {t('entities.restore')}
                </Button>
              ) : (
                <>
                  <Link
                    to={`/tables/${table.id}/actors/${actor.id}`}
                    className="self-center"
                    aria-label={`${t('sheet.open')}: ${actor.name}`}
                  >
                    {t('sheet.open')}
                  </Link>
                  {canDuplicate(actor) && (
                    <Button
                      onClick={() =>
                        void run(async () => {
                          const copy = await api.duplicateActor(actor.id);
                          return t('actors.duplicated', { name: copy.name });
                        })
                      }
                    >
                      {t('actors.duplicate')}
                    </Button>
                  )}
                  {canSetOwnership(table.role) && (
                    <Button
                      onClick={() => {
                        setEditingOwnership(actor);
                      }}
                    >
                      {t('ownership.open')}
                    </Button>
                  )}
                  {actor.access === 'owner' && (
                    <Button
                      onClick={() =>
                        void run(async () => {
                          await api.deleteActor(actor.id);
                          return t('entities.deleted', { name: actor.name });
                        })
                      }
                    >
                      {t('entities.delete')}
                    </Button>
                  )}
                </>
              )
            }
          >
            {!trash && <ActorItems actor={actor} />}
          </EntityRow>
        ))}
      </ul>

      <CreateEntityDialog
        open={creating}
        title={t('actors.new')}
        submitLabel={t('actors.create')}
        types={creatable}
        onClose={() => {
          setCreating(false);
        }}
        onCreate={async (entity) => {
          const actor = await api.createActor(table.id, entity);
          setCreating(false);
          setStatus(t('entities.created', { name: actor.name }));
          await revalidator.revalidate();
        }}
      />
      <OwnershipDialog
        target={editingOwnership}
        members={members}
        onClose={() => {
          setEditingOwnership(null);
        }}
        onSave={async (ownership) => {
          if (!editingOwnership) return;
          const actor = await api.updateActor(editingOwnership.id, { ownership });
          setEditingOwnership(null);
          setStatus(t('ownership.saved', { name: actor.name }));
          void revalidator.revalidate();
        }}
      />
    </div>
  );
}

/** An actor's own items (FR-ENT-05), loaded when the user expands them. */
function ActorItems({ actor }: { actor: ActorView }): ReactElement {
  const [items, setItems] = useState<ItemView[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <details
      className="text-sm"
      onToggle={(e) => {
        if (!e.currentTarget.open) return;
        api.listActorItems(actor.id).then(setItems, (caught: unknown) => {
          setFailure(errorMessage(caught));
        });
      }}
    >
      <summary className="cursor-pointer text-muted">{t('actors.items')}</summary>
      {failure && <Alert tone="error">{failure}</Alert>}
      {items?.length === 0 && <p className="text-muted">{t('actors.noItems')}</p>}
      {items && items.length > 0 && (
        <ul className="list-disc pl-6">
          {items.map((item) => (
            <li key={item.id}>
              {item.name} <span className="text-muted">({item.type})</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
