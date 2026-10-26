import { collectionRows, sortKeyBetween } from '@vtt/plugin-engine';

/** Keys from the data root to a value; inside a collection, the row id is a key. */
export type FieldPath = readonly string[];

/** One edit of a text: `remove` characters at `index` replaced by `insert` characters. */
export interface TextChange {
  index: number;
  remove: number;
  insert: number;
}

/**
 * A text several people edit at once (FR-SHEET-07): edits are splices, so concurrent typing
 * merges instead of one whole value replacing another.
 */
export interface SharedText {
  read: () => string;
  /** Replaces `remove` characters at `index` with `insert`. */
  splice: (index: number, remove: number, insert: string) => void;
  /** Listens to every change, as splices in order, so a caret can follow other people's. */
  observe: (listener: (changes: readonly TextChange[]) => void) => () => void;
}

/**
 * Where a sheet reads and writes an entity's data. The live store (M5) backs it with the
 * actor's Yjs documents; `createMemoryStore()` keeps it in memory for previews and tests.
 *
 * Collections are id-keyed maps of rows, each with a `sort` key (specs §9.4).
 */
export interface SheetStore {
  /** The current data. It is a new object after every change, as `useSyncExternalStore` needs. */
  getSnapshot: () => Readonly<Record<string, unknown>>;
  subscribe: (onChange: () => void) => () => void;
  set: (path: FieldPath, value: unknown) => void;
  /**
   * Adds `delta` to a counter (FR-SHEET-08). The live store has the server do it, starting a
   * missing counter from its default; the memory store counts a non-number as 0, so previews
   * seed the defaults.
   */
  adjust: (path: FieldPath, delta: number) => void;
  /** Appends a row and returns its id. */
  addRow: (path: FieldPath, row: Readonly<Record<string, unknown>>) => string;
  removeRow: (path: FieldPath, id: string) => void;
  /** Moves a row before another one, or to the end when `before` is null. */
  moveRow: (path: FieldPath, id: string, before: string | null) => void;
  /**
   * The shared text of a `longText` field, on live stores. The same object for the same
   * text. Without it, text areas write the whole value with `set`.
   */
  text?: (path: FieldPath) => SharedText | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at `path`, or undefined. */
export function valueAt(data: unknown, path: FieldPath): unknown {
  let value = data;
  for (const key of path) {
    value = isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
  }
  return value;
}

/** A copy of `data` with `path` set to `update(old value)`; missing objects are created. */
function updateAt(
  data: Readonly<Record<string, unknown>>,
  path: FieldPath,
  update: (current: unknown) => unknown,
): Record<string, unknown> {
  const [key, ...rest] = path;
  if (key === undefined) return { ...data };
  const current = Object.hasOwn(data, key) ? data[key] : undefined;
  return {
    ...data,
    [key]:
      rest.length === 0
        ? update(current)
        : updateAt(isRecord(current) ? current : {}, rest, update),
  };
}

export interface MemoryStoreOptions {
  /** Row ids for `addRow`; defaults to `r1`, `r2`… */
  newId?: () => string;
}

/** A `SheetStore` kept in memory. */
export function createMemoryStore(
  initial: Readonly<Record<string, unknown>> = {},
  { newId }: MemoryStoreOptions = {},
): SheetStore {
  let data: Readonly<Record<string, unknown>> = initial;
  let counter = 0;
  const listeners = new Set<() => void>();
  const nextId = newId ?? (() => `r${String((counter += 1))}`);
  const change = (path: FieldPath, update: (current: unknown) => unknown) => {
    data = updateAt(data, path, update);
    for (const listener of listeners) listener();
  };
  const rowsOf = (current: unknown): Record<string, unknown> => (isRecord(current) ? current : {});

  return {
    getSnapshot: () => data,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (path, value) => {
      change(path, () => value);
    },
    adjust: (path, delta) => {
      change(path, (current) => (typeof current === 'number' ? current : 0) + delta);
    },
    addRow: (path, row) => {
      const id = nextId();
      const last = collectionRows(valueAt(data, path)).at(-1);
      change(path, (current) => ({
        ...rowsOf(current),
        [id]: { ...row, sort: sortKeyBetween(last?.sort ?? null, null) },
      }));
      return id;
    },
    removeRow: (path, id) => {
      change(path, (current) =>
        Object.fromEntries(Object.entries(rowsOf(current)).filter(([key]) => key !== id)),
      );
    },
    moveRow: (path, id, before) => {
      const rows = collectionRows(valueAt(data, path)).filter((row) => row.id !== id);
      const index = before === null ? rows.length : rows.findIndex((row) => row.id === before);
      if (index < 0) return;
      const sort = sortKeyBetween(rows[index - 1]?.sort ?? null, rows[index]?.sort ?? null);
      change([...path, id], (row) => (isRecord(row) ? { ...row, sort } : row));
    },
  };
}
