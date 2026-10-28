import type { ItemType } from '@vtt/plugin-schema';

import { t } from '../../i18n/index.js';
import { useSystem } from '../../plugin-host/system-context.js';

/** Rows under one heading; a `null` title is the one list of a system without groups. */
export interface RowGroup<T> {
  key: string;
  title: string | null;
  rows: T[];
}

/** Rows that are not items, such as a compendium's actors, listed as a group of their own. */
export interface OtherRows<T> {
  title: string;
  order: number;
  has: (row: T) => boolean;
}

interface Bucket<T> extends RowGroup<T> {
  order: number;
}

/**
 * Item rows under their types' groups (FR-PLUGIN-11, ADR-061). A type without a group heads
 * its own items with its plural label. Groups come by their types' lowest `order`, then by
 * title; rows keep their order inside a group. A system that declares no group gets one list.
 */
export function groupItems<T>(
  rows: readonly T[],
  typeOf: (row: T) => string,
  itemTypes: Readonly<Record<string, ItemType>> | undefined,
  translate: (text: string) => string,
  other?: OtherRows<T>,
): RowGroup<T>[] {
  const declared = Object.values(itemTypes ?? {}).some((type) => type.group !== undefined);
  if (!itemTypes || !declared) return [{ key: 'all', title: null, rows: [...rows] }];

  const buckets = new Map<string, Bucket<T>>();
  const add = (key: string, title: string, order: number, row: T) => {
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.rows.push(row);
      bucket.order = Math.min(bucket.order, order);
    } else buckets.set(key, { key, title, order, rows: [row] });
  };
  for (const row of rows) {
    if (other?.has(row)) {
      add('other-rows', other.title, other.order, row);
      continue;
    }
    const name = typeOf(row);
    const type = Object.hasOwn(itemTypes, name) ? itemTypes[name] : undefined;
    if (!type) add('unknown', t('items.otherTypes'), Number.POSITIVE_INFINITY, row);
    else if (type.group !== undefined)
      add(`group:${type.group}`, translate(type.group), type.order ?? 0, row);
    else add(`type:${name}`, translate(type.labelPlural ?? type.label), type.order ?? 0, row);
  }
  return [...buckets.values()]
    .sort((a, b) => a.order - b.order || (a.title ?? '').localeCompare(b.title ?? ''))
    .map(({ key, title, rows: grouped }) => ({ key, title, rows: grouped }));
}

/** The item types of the table's system, and its translator, while it is loaded. */
export function useItemTypes(): {
  itemTypes: Readonly<Record<string, ItemType>> | undefined;
  translate: (text: string) => string;
} {
  const system = useSystem();
  return system.status === 'ready'
    ? { itemTypes: system.system.definition.itemTypes, translate: system.translate }
    : { itemTypes: undefined, translate: (text) => text };
}
