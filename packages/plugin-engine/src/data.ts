import type { FieldSchema } from '@vtt/plugin-schema';

/**
 * A collection row as stored (specs §9.4): the row's fields plus its `sort` key. The row id
 * is the key in the collection, never a field.
 */
export type CollectionValue = Record<string, Record<string, unknown>>;

/** A row read from a collection, with its id, in `sort` order. */
export type CollectionRow = Record<string, unknown> & { id: string; sort: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isCollection = (field: FieldSchema): boolean =>
  field.type === 'array' && field['x-kind'] === 'collection';

/**
 * The sort key of the n-th default row. Keys compare as strings; reordering later puts a row
 * between two keys without touching the others.
 */
export const defaultSortKey = (index: number): string => `a${index.toString(36).padStart(4, '0')}`;

/** Defaults come from JSON files, so a JSON copy is a full copy. */
const cloneJson = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(cloneJson)
    : isRecord(value)
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]))
      : value;

const EMPTY: Record<Exclude<FieldSchema['type'], 'object' | 'array'>, unknown> = {
  string: '',
  integer: 0,
  number: 0,
  boolean: false,
};

/**
 * The value a new entity starts with for one field: its `default`, else an empty value of
 * its type. Objects are built from their properties' defaults, and a collection's default
 * rows get ids `d0`, `d1`… in order.
 */
export function defaultValue(field: FieldSchema): unknown {
  if (isCollection(field)) {
    const rows = Array.isArray(field.default) ? (field.default as unknown[]) : [];
    return Object.fromEntries(
      rows.map((row, index) => [
        `d${String(index)}`,
        { ...withDefaults(field.items, row), sort: defaultSortKey(index) },
      ]),
    );
  }
  if (field.type === 'object') return withDefaults(field, field.default);
  if (field.default !== undefined) return cloneJson(field.default);
  return field.type === 'array' ? [] : EMPTY[field.type];
}

/**
 * Fills in what `value` leaves out of `field`: missing properties get their defaults, at
 * every depth and in every collection row. Values that are present are kept as they are,
 * even when they do not fit the schema; checking them is the store's job (specs §9.7).
 */
export function withDefaults(
  field: FieldSchema | undefined,
  value: unknown,
): Record<string, unknown> {
  const data = isRecord(value) ? { ...value } : {};
  for (const [name, child] of Object.entries(field?.properties ?? {})) {
    const current = data[name];
    if (current === undefined) data[name] = defaultValue(child);
    else if (child.type === 'object' && isRecord(current))
      data[name] = withDefaults(child, current);
    else if (isCollection(child) && isRecord(current)) {
      data[name] = Object.fromEntries(
        Object.entries(current).map(([id, row]) => [id, withDefaults(child.items, row)]),
      );
    }
  }
  return data;
}

/** A collection's rows with their ids, by `sort` key and then id. Non-rows are skipped. */
export function collectionRows(value: unknown): CollectionRow[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
    .map(([id, row]) => ({ ...row, id, sort: typeof row.sort === 'string' ? row.sort : '' }))
    .sort((a, b) => (a.sort === b.sort ? (a.id < b.id ? -1 : 1) : a.sort < b.sort ? -1 : 1));
}
