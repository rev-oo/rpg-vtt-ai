import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { canCreateActor, canSetOwnership } from '@vtt/shared';
import type { ActorView, ItemView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api, type ListPage } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import type { TableData } from '../table/table-data.js';
import { OpenButton } from '../workspace/OpenButton.js';
import { sheetPanelId } from '../workspace/panel-ids.js';

import { CreateEntityDialog } from './CreateEntityDialog.js';
import { EntityRow } from './EntityRow.js';
import type { EntityFilters } from './filters.js';
import { GroupedList } from './GroupedList.js';
import { groupItems, useItemTypes } from './item-groups.js';
import { ListFilters } from './ListFilters.js';
import { LoadMore } from './LoadMore.js';
import { OwnershipDialog } from './OwnershipDialog.js';
import { usePagedList } from './paging.js';

export interface ActorListProps {
  data: TableData;
  /** The filtered list from the route loader. */
  actors: readonly ActorView[];
  /** The page after the loader's, if any (ADR-057). */
  nextCursor: string | null;
  fetchPage: (cursor: string) => Promise<ListPage<ActorView>>;
  filters: EntityFilters;
  onFilters: (filters: EntityFilters) => void;
  error: string | null;
}

/** The table's actors (FR-ENT-01..04): search, filters, trash and the actions on each. */
export function ActorList({
  data,
  actors: firstPage,
  nextCursor,
  fetchPage,
  filters,
  onFilters,
  error,
}: ActorListProps): ReactElement {
  const { trash } = filters;
  const paged = usePagedList(firstPage, nextCursor, fetchPage);
  const actors = paged.rows;
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
          <ListFilters
            searchLabel={t('actors.search')}
            types={types.actorTypes.map((a) => a.type)}
            value={filters}
            onChange={onFilters}
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
                  <OpenButton
                    target={{ kind: 'sheet', id: sheetPanelId(actor.id), actorId: actor.id }}
                    className="self-center"
                    label={`${t('sheet.open')}: ${actor.name}`}
                  >
                    {t('sheet.open')}
                  </OpenButton>
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
      {paged.error && <Alert tone="error">{paged.error}</Alert>}
      {paged.more && <LoadMore loading={paged.loading} onLoad={paged.loadMore} />}

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
  const { itemTypes, translate } = useItemTypes();
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
        <GroupedList
          label={t('actors.itemsOf', { name: actor.name })}
          groups={groupItems(items, (item) => item.type, itemTypes, translate)}
          rowKey={(item) => item.id}
          listClassName="list-disc pl-6"
          headingClassName="mt-1 text-xs font-semibold text-muted uppercase"
          headingLevel={4}
          renderRow={(item) => (
            <li key={item.id}>
              {item.name} <span className="text-muted">({item.type})</span>
            </li>
          )}
        />
      )}
    </details>
  );
}
