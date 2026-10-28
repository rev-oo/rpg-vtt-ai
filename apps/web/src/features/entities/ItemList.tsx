import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { canManageItemLibrary } from '@vtt/shared';
import type { ItemView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api, type ListPage } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import type { TableData } from '../table/table-data.js';

import { CreateEntityDialog } from './CreateEntityDialog.js';
import { EntityFilters } from './EntityFilters.js';
import { EntityRow } from './EntityRow.js';
import { LoadMore } from './LoadMore.js';
import { usePagedList } from './paging.js';

export interface ItemListProps {
  data: TableData;
  /** The filtered library from the route loader. */
  items: readonly ItemView[];
  /** The page after the loader's, if any (ADR-057). */
  nextCursor: string | null;
  fetchPage: (cursor: string) => Promise<ListPage<ItemView>>;
  trash: boolean;
  error: string | null;
}

/**
 * The table's item library (FR-ENT-05, 06): GMs and assistants curate it, and anyone can
 * copy an item into an actor they own.
 */
export function ItemList({
  data,
  items: firstPage,
  nextCursor,
  fetchPage,
  trash,
  error,
}: ItemListProps): ReactElement {
  const paged = usePagedList(firstPage, nextCursor, fetchPage);
  const items = paged.rows;
  const { table, types, actors } = data;
  const revalidator = useRevalidator();
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const manage = canManageItemLibrary(table.role);
  const targets = actors.filter((actor) => actor.access === 'owner');

  const run = async (action: () => Promise<string>, reload = true) => {
    setFailure(null);
    try {
      setStatus(await action());
      if (reload) await revalidator.revalidate();
    } catch (caught) {
      setStatus(null);
      setFailure(errorMessage(caught));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <EntityFilters searchLabel={t('items.search')} types={types.itemTypes} />
        </div>
        {manage && types.itemTypes.length > 0 && (
          <Button
            variant="primary"
            onClick={() => {
              setCreating(true);
            }}
          >
            {t('items.new')}
          </Button>
        )}
      </div>

      {(error ?? failure) && <Alert tone="error">{error ?? failure}</Alert>}
      {status && (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      )}
      {items.length === 0 && !error && (
        <p className="text-muted">{t(trash ? 'items.trashEmpty' : 'items.empty')}</p>
      )}

      <ul className="flex list-none flex-col gap-2 p-0" aria-label={t('items.title')}>
        {items.map((item) => (
          <EntityRow
            key={item.id}
            name={item.name}
            type={item.type}
            imageUrl={item.imageUrl}
            actions={
              trash ? (
                <Button
                  onClick={() =>
                    void run(async () => {
                      await api.restoreItem(item.id);
                      return t('entities.restored', { name: item.name });
                    })
                  }
                >
                  {t('entities.restore')}
                </Button>
              ) : (
                <>
                  {targets.length > 0 && (
                    <GiveToActor
                      item={item}
                      targets={targets}
                      onGive={(actorId, actorName) =>
                        run(async () => {
                          await api.copyItemToActor(actorId, item.id);
                          return t('items.given', { item: item.name, actor: actorName });
                        }, false)
                      }
                    />
                  )}
                  {manage && (
                    <Button
                      onClick={() =>
                        void run(async () => {
                          await api.deleteItem(item.id);
                          return t('entities.deleted', { name: item.name });
                        })
                      }
                    >
                      {t('entities.delete')}
                    </Button>
                  )}
                </>
              )
            }
          />
        ))}
      </ul>
      {paged.error && <Alert tone="error">{paged.error}</Alert>}
      {paged.more && <LoadMore loading={paged.loading} onLoad={paged.loadMore} />}

      <CreateEntityDialog
        open={creating}
        title={t('items.new')}
        submitLabel={t('items.create')}
        types={types.itemTypes}
        onClose={() => {
          setCreating(false);
        }}
        onCreate={async (entity) => {
          const item = await api.createItem(table.id, entity);
          setCreating(false);
          setStatus(t('entities.created', { name: item.name }));
          await revalidator.revalidate();
        }}
      />
    </div>
  );
}

function GiveToActor({
  item,
  targets,
  onGive,
}: {
  item: ItemView;
  targets: readonly { id: string; name: string }[];
  onGive: (actorId: string, actorName: string) => Promise<void>;
}): ReactElement {
  const [actorId, setActorId] = useState(targets[0]?.id ?? '');
  const target = targets.find((a) => a.id === actorId) ?? targets[0];
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`give-${item.id}`}>
        {t('items.giveTo', { name: item.name })}
      </label>
      <select
        id={`give-${item.id}`}
        className="min-h-10 rounded-lg border border-line bg-surface px-2 text-fg"
        value={target?.id ?? ''}
        onChange={(e) => {
          setActorId(e.target.value);
        }}
      >
        {targets.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name}
          </option>
        ))}
      </select>
      <Button
        onClick={() => {
          if (target) void onGive(target.id, target.name);
        }}
      >
        {t('items.give')}
      </Button>
    </div>
  );
}
