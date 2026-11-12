import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { canManageItemLibrary } from '@vtt/shared';
import type { ItemView } from '@vtt/shared/api';
import { Alert, Button, IconButton } from '@vtt/ui';

import { api, type ListPage } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { ICON } from '../../icons.js';
import type { TableData } from '../table/table-data.js';
import { OpenButton } from '../workspace/OpenButton.js';
import { itemPanelId } from '../workspace/panel-ids.js';

import { CreateEntityDialog } from './CreateEntityDialog.js';
import { EntityRow } from './EntityRow.js';
import type { EntityFilters } from './filters.js';
import { GroupedList } from './GroupedList.js';
import { groupItems, useItemTypes } from './item-groups.js';
import { ListFilters } from './ListFilters.js';
import { LoadMore } from './LoadMore.js';
import { usePagedList } from './paging.js';
import { useTypeLabels } from './type-labels.js';

export interface ItemListProps {
  data: TableData;
  /** The filtered library from the route loader. */
  items: readonly ItemView[];
  /** The page after the loader's, if any (ADR-057). */
  nextCursor: string | null;
  fetchPage: (cursor: string) => Promise<ListPage<ItemView>>;
  filters: EntityFilters;
  onFilters: (filters: EntityFilters) => void;
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
  filters,
  onFilters,
  error,
}: ItemListProps): ReactElement {
  const { trash } = filters;
  const paged = usePagedList(firstPage, nextCursor, fetchPage);
  const labels = useTypeLabels();
  const items = paged.rows;
  const { table, types, actors } = data;
  const revalidator = useRevalidator();
  const { itemTypes, translate } = useItemTypes();
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
          <ListFilters
            searchLabel={t('items.search')}
            types={types.itemTypes}
            typeLabel={labels.item}
            value={filters}
            onChange={onFilters}
          />
        </div>
        {manage && types.itemTypes.length > 0 && (
          <Button
            icon={<ICON.add />}
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

      <GroupedList
        label={t('items.title')}
        groups={groupItems(items, (item) => item.type, itemTypes, translate)}
        rowKey={(item) => item.id}
        renderRow={(item, nested) => (
          <EntityRow
            key={item.id}
            nested={nested}
            name={item.name}
            type={labels.item(item.type)}
            imageUrl={item.imageUrl}
            drag={trash ? undefined : { kind: 'library', itemId: item.id }}
            actions={
              trash ? (
                <IconButton
                  icon={<ICON.restore />}
                  label={t('entities.restore')}
                  onClick={() =>
                    void run(async () => {
                      await api.restoreItem(item.id);
                      return t('entities.restored', { name: item.name });
                    })
                  }
                />
              ) : (
                <>
                  <OpenButton
                    target={{
                      kind: 'item',
                      id: itemPanelId(item.id),
                      itemId: item.id,
                      name: item.name,
                    }}
                    label={t('items.openItem', { name: item.name })}
                  >
                    {t('entities.open')}
                  </OpenButton>
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
                    <IconButton
                      icon={<ICON.delete />}
                      label={t('entities.delete')}
                      onClick={() =>
                        void run(async () => {
                          await api.deleteItem(item.id);
                          return t('entities.deleted', { name: item.name });
                        })
                      }
                    />
                  )}
                </>
              )
            }
          />
        )}
      />
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
  // Nothing is chosen at first, so one click never gives the item to whoever is first (T-1620).
  const [actorId, setActorId] = useState('');
  const target = targets.find((a) => a.id === actorId);
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`give-${item.id}`}>
        {t('items.giveTo', { name: item.name })}
      </label>
      <select
        id={`give-${item.id}`}
        className="min-h-10 min-w-0 rounded-lg border border-line bg-surface px-2 text-fg"
        value={target?.id ?? ''}
        onChange={(e) => {
          setActorId(e.target.value);
        }}
      >
        <option value="">{t('items.chooseActor')}</option>
        {targets.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name}
          </option>
        ))}
      </select>
      <Button
        disabled={!target}
        onClick={() => {
          if (target) void onGive(target.id, target.name);
        }}
      >
        {t('items.give')}
      </Button>
    </div>
  );
}
