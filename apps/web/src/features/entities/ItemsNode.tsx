import { useEffect, useMemo, useState, type ReactElement } from 'react';

import type { SheetNode } from '@vtt/plugin-schema';
import type { ActorView, ItemView } from '@vtt/shared/api';
import { createMemoryStore, ItemRow, type ItemsNodeProps } from '@vtt/sheet-renderer';
import { Alert, Button, cn, controlClass } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import type { LiveItem } from '../../collab/use-live-items.js';
import { t } from '../../i18n/index.js';
import type { TableSystem } from '../../plugin-host/system-context.js';
import { OpenButton } from '../workspace/OpenButton.js';
import { itemPanelId } from '../workspace/panel-ids.js';

import { GroupedList } from './GroupedList.js';
import { carriesItem, droppedItem, type ItemDrag } from './item-drag.js';
import { groupItems } from './item-groups.js';
import type { ActorItems } from './use-actor-items.js';

type ReadySystem = Extract<TableSystem, { status: 'ready' }>;

/** An actor sheet's `items` node (FR-SHEET-12): grouped rows with open, remove and add. */
export function ItemsNode({
  node,
  host,
  actor,
  items,
  live,
  readOnly,
  reload,
}: ItemsNodeProps & {
  host: ReadySystem;
  actor: ActorView | ItemView;
  items: ActorItems;
  live: ReadonlyMap<string, LiveItem>;
  readOnly: boolean;
  reload: () => void;
}): ReactElement {
  const { definition } = host.system;
  const { translate } = host;
  const types = node.itemTypes ?? Object.keys(definition.itemTypes);
  const shown = items.status === 'ready' ? items.items.filter((i) => types.includes(i.type)) : [];
  const editable = !readOnly && actor.access === 'owner';
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = (action: () => Promise<string>) => {
    setStatus(null);
    setFailure(null);
    action().then(
      (done) => {
        setStatus(done);
        reload();
      },
      (error: unknown) => {
        setFailure(errorMessage(error));
      },
    );
  };
  const add = (drag: ItemDrag) => {
    run(async () => {
      if (drag.kind === 'library') {
        const copy = await api.copyItemToActor(actor.id, drag.itemId);
        return t('sheet.items.added', { name: copy.name });
      }
      const { items: copied } = await api.copyFromCompendium(actor.tableId, {
        refs: [drag.ref],
        actorId: actor.id,
      });
      return t('sheet.items.added', { name: copied.map((copy) => copy.name).join(', ') });
    });
  };

  return (
    <div
      className={cn('vtt-items flex min-w-0 flex-col gap-(--vtt-gap-sm)', node.class)}
      data-items={types.join(' ')}
      {...(editable && {
        onDragOver: (event) => {
          if (carriesItem(event)) event.preventDefault();
        },
        onDrop: (event) => {
          const drag = droppedItem(event);
          if (!drag) return;
          event.preventDefault();
          add(drag);
        },
      })}
    >
      {items.status === 'loading' && (
        <p className="text-sm text-muted">{t('sheet.items.loading')}</p>
      )}
      {items.status === 'failed' && <Alert tone="error">{items.error}</Alert>}
      {items.status === 'ready' && shown.length === 0 && (
        <p className="text-sm text-muted">{t('sheet.items.empty')}</p>
      )}
      {shown.length > 0 && (
        <GroupedList
          label={t('sheet.items.label', { name: actor.name })}
          groups={groupItems(shown, (item) => item.type, definition.itemTypes, translate)}
          rowKey={(item) => item.id}
          headingLevel={4}
          renderRow={(item) => (
            <li
              key={item.id}
              className="vtt-item-row flex min-w-0 flex-col gap-2 @md:flex-row @md:items-end"
              data-item={item.id}
              aria-label={item.name}
            >
              <div className="min-w-0 flex-1">
                {/* The core names each item, so a plugin's row lays out only its fields. */}
                <p className="min-w-0 truncate font-semibold">{item.name}</p>
                <ItemRowView item={item} live={live.get(item.id)} host={host} layout={node.item} />
              </div>
              <div className="flex shrink-0 gap-1">
                <OpenButton
                  target={{
                    kind: 'item',
                    id: itemPanelId(item.id),
                    itemId: item.id,
                    name: item.name,
                  }}
                  label={t('items.openItem', { name: item.name })}
                >
                  {t('items.open')}
                </OpenButton>
                {editable && (
                  <Button
                    variant="ghost"
                    aria-label={t('sheet.items.remove', { name: item.name })}
                    title={t('sheet.items.remove', { name: item.name })}
                    onClick={() => {
                      run(async () => {
                        await api.deleteItem(item.id);
                        return t('sheet.items.removed', { name: item.name });
                      });
                    }}
                  >
                    ✕
                  </Button>
                )}
              </div>
            </li>
          )}
        />
      )}
      {editable && (
        <AddFromLibrary
          tableId={actor.tableId}
          types={types}
          label={node.addLabel ? translate(node.addLabel) : t('sheet.items.add')}
          onAdd={(itemId) => {
            add({ kind: 'library', itemId });
          }}
        />
      )}
      <p role="status" className="text-sm text-muted empty:hidden">
        {status}
      </p>
      {failure && <Alert tone="error">{failure}</Alert>}
    </div>
  );
}

/** One item laid out by the node: live once its document syncs, its projection until then. */
function ItemRowView({
  item,
  live,
  host,
  layout,
}: {
  item: ItemView;
  live: LiveItem | undefined;
  host: ReadySystem;
  layout: SheetNode;
}): ReactElement | null {
  const schema = host.system.definition.itemTypes[item.type]?.schema;
  const stored = useMemo(() => createMemoryStore(item.system), [item.system]);
  if (!schema || live?.denied) return null;
  const ready = live?.ready === true;
  return (
    <ItemRow
      item={{ id: item.id, name: item.name, type: item.type }}
      store={ready ? live.store : stored}
      schema={schema}
      readOnly={!ready || live.readOnly || item.access !== 'owner'}
      layout={layout}
    />
  );
}

/** Copies a library item of `types` onto the actor (FR-ENT-05). */
function AddFromLibrary({
  tableId,
  types,
  label,
  onAdd,
}: {
  tableId: string;
  types: readonly string[];
  label: string;
  onAdd: (itemId: string) => void;
}): ReactElement | null {
  const [library, setLibrary] = useState<readonly ItemView[] | null>(null);
  const [chosen, setChosen] = useState('');

  useEffect(() => {
    let current = true;
    api.listItems(tableId).then(
      (loaded) => {
        if (current) setLibrary(loaded);
      },
      () => {
        if (current) setLibrary([]);
      },
    );
    return () => {
      current = false;
    };
  }, [tableId]);

  const offered = (library ?? []).filter((item) => types.includes(item.type));
  if (offered.length === 0) return null;
  const selected = offered.some((item) => item.id === chosen) ? chosen : (offered[0]?.id ?? '');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={controlClass}
        aria-label={t('sheet.items.choose')}
        value={selected}
        onChange={(event) => {
          setChosen(event.target.value);
        }}
      >
        {offered.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <Button
        onClick={() => {
          onAdd(selected);
        }}
      >
        {label}
      </Button>
    </div>
  );
}
