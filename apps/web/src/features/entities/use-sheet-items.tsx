import { useCallback, useMemo } from 'react';

import type { Value } from '@vtt/formula';
import { documentLayout, type DocumentLayout } from '@vtt/plugin-engine';
import type { PluginDefinition, SheetNode } from '@vtt/plugin-schema';
import type { ActorView, ItemView } from '@vtt/shared/api';
import type { ItemsNodeProps, ItemsRenderer } from '@vtt/sheet-renderer';

import { useLiveItems, type LiveItem } from '../../collab/use-live-items.js';
import type { TableSystem } from '../../plugin-host/system-context.js';

import { ItemsNode } from './ItemsNode.js';
import { useActorItems } from './use-actor-items.js';

type ReadySystem = Extract<TableSystem, { status: 'ready' }>;

const NONE: ReadonlySet<string> = new Set();

/** The nodes directly inside `node`. */
function childrenOf(node: SheetNode): readonly SheetNode[] {
  switch (node.type) {
    case 'row':
    case 'column':
    case 'grid':
    case 'section':
      return node.children;
    case 'tabs':
      return node.tabs.flatMap((tab) => tab.children);
    case 'list':
    case 'items':
      return [node.item];
    default:
      return [];
  }
}

/**
 * The item types an actor sheet needs live: those its `items` nodes list, and those that
 * contribute to `@items` (ADR-063).
 */
export function neededItemTypes(definition: PluginDefinition, layout: SheetNode): Set<string> {
  const all = Object.keys(definition.itemTypes);
  const needed = new Set(all.filter((name) => definition.itemTypes[name]?.contributes));
  const pending = [layout];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (node.type === 'items') for (const name of node.itemTypes ?? all) needed.add(name);
    pending.push(...childrenOf(node));
  }
  return needed;
}

/** An item's data for totals: its live document once synced, else its projection. */
const dataOf = (item: ItemView, live: ReadonlyMap<string, LiveItem>) => {
  const entry = live.get(item.id);
  return entry?.ready ? entry.store.getSnapshot() : item.system;
};

/**
 * What an actor's sheet needs for its items (FR-SHEET-12, ADR-063): the totals `@items`
 * reads, computed from the items' live documents so derived values follow every edit, and
 * the `items` node. Item sheets get neither.
 */
export function useSheetItems({
  host,
  actor,
  enabled,
  readOnly,
}: {
  host: ReadySystem;
  actor: ActorView | ItemView;
  enabled: boolean;
  readOnly: boolean;
}): { itemTotals?: Readonly<Record<string, Value>>; renderItems?: ItemsRenderer } {
  const { definition } = host.system;
  const sheetName = enabled ? definition.actorTypes[actor.type]?.sheet : undefined;
  const layout = sheetName === undefined ? undefined : definition.sheets[sheetName]?.layout;
  const needed = useMemo(
    () => (layout ? neededItemTypes(definition, layout) : NONE),
    [definition, layout],
  );
  const { items, reload } = useActorItems(actor.tableId, actor.id, needed.size > 0);
  const held = useMemo(
    () => (items.status === 'ready' ? items.items.filter((item) => needed.has(item.type)) : []),
    [items, needed],
  );
  const layouts = useMemo(
    () =>
      new Map<string, DocumentLayout>(
        [...needed].flatMap((name) => {
          const itemType = definition.itemTypes[name];
          return itemType ? [[name, documentLayout(itemType.schema)] as const] : [];
        }),
      ),
    [definition, needed],
  );
  const layoutOf = useCallback((type: string) => layouts.get(type), [layouts]);
  const live = useLiveItems(held, layoutOf);
  const itemTotals = useMemo(
    () =>
      host.rules.itemTotals(
        held
          .filter((item) => Object.hasOwn(definition.itemTypes, item.type))
          .map((item) => ({ type: item.type, data: dataOf(item, live) })),
      ),
    [host.rules, definition, held, live],
  );
  const renderItems = useCallback(
    ({ node }: ItemsNodeProps) => (
      <ItemsNode
        node={node}
        host={host}
        actor={actor}
        items={items}
        live={live}
        readOnly={readOnly}
        reload={reload}
      />
    ),
    [host, actor, items, live, readOnly, reload],
  );
  return enabled ? { itemTotals, renderItems } : {};
}
