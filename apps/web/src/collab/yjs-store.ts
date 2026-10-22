import * as Y from 'yjs';

import {
  collectionRows,
  mergeLayers,
  readLayer,
  sortKeyBetween,
  splitLayers,
  writeLayer,
  type DocumentLayout,
  type FieldLayout,
} from '@vtt/plugin-engine';
import { valueAt, type FieldPath, type SheetStore } from '@vtt/sheet-renderer';

/** The field `data` map of a collaborative document (specs §9.2). */
export const DATA_MAP = 'data';

export type Layer = 'main' | 'secret';
const LAYERS = ['main', 'secret'] as const;
type Fields = Record<string, FieldLayout>;

export interface YjsStoreOptions {
  /** An actor's documents; `secret` only for viewers who may open it (§9.3). */
  docs: { main: Y.Doc; secret?: Y.Doc | undefined };
  layout: DocumentLayout;
  /** Sends an adjustment to the server, which applies it on its copy (§9.5). */
  adjust: (layer: Layer, path: FieldPath, delta: number) => void;
  /** Ids of new collection rows. */
  newId?: () => string;
}

/** The layout of the field at `path`; a row id is skipped inside collections. */
function layoutAt(fields: Fields | undefined, path: FieldPath): FieldLayout | undefined {
  const [key, ...rest] = path;
  const layout =
    key !== undefined && fields && Object.hasOwn(fields, key) ? fields[key] : undefined;
  if (!layout || rest.length === 0) return layout;
  if (layout.kind === 'map') return layoutAt(layout.fields, rest);
  if (layout.kind === 'collection')
    return rest.length === 1 ? layout : layoutAt(layout.row, rest.slice(1));
  return undefined;
}

/** Which document holds `path`: the secret one when its layout names the field there. */
function layerOf(layout: DocumentLayout, path: FieldPath): Layer {
  return layoutAt(layout.secret, path) ? 'secret' : 'main';
}

/** The map at `path` under `map`, created on the way when `create` is set. */
function mapAt(map: Y.Map<unknown>, path: FieldPath, create: boolean): Y.Map<unknown> | undefined {
  let current = map;
  for (const key of path) {
    const child: unknown = current.get(key);
    if (child instanceof Y.Map) current = child as Y.Map<unknown>;
    else if (create && child === undefined) {
      const created = new Y.Map<unknown>();
      current.set(key, created);
      current = created;
    } else return undefined;
  }
  return current;
}

const defaultId = () => crypto.randomUUID().slice(0, 8);

/**
 * A `SheetStore` over an actor's Yjs documents (specs §9.1, §9.2). Reads join both layers;
 * each write goes to the document whose layout holds the field. Text fields keep their
 * `Y.Text`, collection rows are keyed maps with a `sort` key in the main document (§9.4),
 * and counters are adjusted by the server so concurrent deltas add up (§9.5).
 */
export function createYjsStore({
  docs,
  layout,
  adjust,
  newId = defaultId,
}: YjsStoreOptions): SheetStore & { destroy: () => void } {
  const maps = {
    main: docs.main.getMap<unknown>(DATA_MAP),
    secret: docs.secret?.getMap<unknown>(DATA_MAP),
  };
  const fieldsOf = (layer: Layer): Fields =>
    (layer === 'secret' ? layout.secret : layout.main) ?? {};
  const read = () =>
    mergeLayers(
      readLayer(maps.main, layout.main),
      maps.secret && readLayer(maps.secret, layout.secret ?? {}),
    );

  let snapshot = read();
  const listeners = new Set<() => void>();
  const onUpdate = () => {
    snapshot = read();
    for (const listener of listeners) listener();
  };
  docs.main.on('update', onUpdate);
  docs.secret?.on('update', onUpdate);

  const write = (layer: Layer, edit: (map: Y.Map<unknown>) => void) => {
    const map = maps[layer];
    const doc = layer === 'secret' ? docs.secret : docs.main;
    if (map && doc)
      doc.transact(() => {
        edit(map);
      });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (path, value) => {
      const key = path.at(-1);
      if (key === undefined) return;
      const layer = layerOf(layout, path);
      write(layer, (map) => {
        const parent = mapAt(map, path.slice(0, -1), true);
        if (!parent) return;
        const field = layoutAt(fieldsOf(layer), path);
        const current: unknown = parent.get(key);
        if (field?.kind === 'text' && current instanceof Y.Text && typeof value === 'string') {
          current.delete(0, current.length);
          current.insert(0, value);
        } else if (value === undefined) {
          parent.delete(key);
        } else {
          writeLayer(parent, field ? { [key]: field } : {}, { [key]: value });
        }
      });
    },
    adjust: (path, delta) => {
      adjust(layerOf(layout, path), path, delta);
    },
    addRow: (path, row) => {
      const id = newId();
      const mainRow = layoutAt(layout.main, path);
      const secretRow = layoutAt(layout.secret, path);
      const parts = splitLayers(
        {
          main: mainRow?.kind === 'collection' ? mainRow.row : {},
          secret: secretRow?.kind === 'collection' ? secretRow.row : undefined,
        },
        row,
      );
      const last = collectionRows(valueAt(snapshot, path)).at(-1);
      const sort = sortKeyBetween(last?.sort ?? null, null);
      for (const layer of LAYERS) {
        const rowLayout = layer === 'main' ? mainRow : secretRow;
        const part = layer === 'main' ? { ...parts.main, sort } : parts.secret;
        if (rowLayout?.kind !== 'collection' || !part) continue;
        if (layer === 'secret' && Object.keys(part).length === 0) continue;
        write(layer, (map) => {
          const rows = mapAt(map, path, true);
          if (rows)
            writeLayer(rows, { [id]: { kind: 'map', fields: rowLayout.row } }, { [id]: part });
        });
      }
      return id;
    },
    removeRow: (path, id) => {
      for (const layer of LAYERS) {
        write(layer, (map) => {
          mapAt(map, path, false)?.delete(id);
        });
      }
    },
    moveRow: (path, id, before) => {
      const rows = collectionRows(valueAt(snapshot, path)).filter((row) => row.id !== id);
      const index = before === null ? rows.length : rows.findIndex((row) => row.id === before);
      if (index < 0) return;
      const sort = sortKeyBetween(rows[index - 1]?.sort ?? null, rows[index]?.sort ?? null);
      write('main', (map) => {
        mapAt(map, [...path, id], false)?.set('sort', sort);
      });
    },
    destroy: () => {
      docs.main.off('update', onUpdate);
      docs.secret?.off('update', onUpdate);
      listeners.clear();
    },
  };
}
