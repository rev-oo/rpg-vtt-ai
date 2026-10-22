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

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A key strictly between `a` and `b` (`''` and `null` are the open ends). */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let shared = 0;
    while ((a[shared] ?? '0') === b[shared]) shared += 1;
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
  }
  const low = a ? DIGITS.indexOf(a.charAt(0)) : 0;
  const high = b === null ? DIGITS.length : DIGITS.indexOf(b.charAt(0));
  if (high - low > 1) return DIGITS.charAt(Math.round((low + high) / 2));
  if (b !== null && b.length > 1) return b.charAt(0);
  return DIGITS.charAt(low) + midpoint(a.slice(1), null);
}

const SORT_KEY = /^[0-9a-z]*[1-9a-z]$/;

/**
 * A collection sort key between two neighbours (specs §9.4): `null` for the start or the end
 * of the list. Keys are base-36 fractions compared as strings, so a row moves by changing
 * only its own key. Keys that are not of this form (or not in order) are treated as absent.
 */
export function sortKeyBetween(before: string | null, after: string | null): string {
  const low = before !== null && SORT_KEY.test(before) ? before : '';
  const high = after !== null && SORT_KEY.test(after) && after > low ? after : null;
  return midpoint(low, high);
}

/** Sort keys for `count` rows in order, as given to a collection's default rows. */
export function sortKeys(count: number): string[] {
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) {
    keys.push(sortKeyBetween(keys.at(-1) ?? null, null));
  }
  return keys;
}

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
    const keys = sortKeys(rows.length);
    return Object.fromEntries(
      rows.map((row, index) => [
        `d${String(index)}`,
        { ...withDefaults(field.items, row), sort: keys[index] ?? '' },
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
