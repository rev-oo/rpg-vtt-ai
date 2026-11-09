import { useMemo, useSyncExternalStore, type ReactElement } from 'react';

import { computeDerived, withDefaults } from '@vtt/plugin-engine';
import type { FieldSchema, SheetNode } from '@vtt/plugin-schema';

import { SheetContext, useSheet, type SheetEnvironment, type SheetItemRef } from './context.js';
import { SheetNodeView } from './nodes.js';
import type { SheetStore } from './store.js';

export interface ItemRowProps {
  item: SheetItemRef;
  /** The item's own store: fields in the row read and write it. */
  store: SheetStore;
  /** The item's type. */
  schema: FieldSchema;
  /** The item cannot be edited, even where its holder can. */
  readOnly: boolean;
  /** The `items` node's `item` layout. */
  layout: SheetNode;
  /** The item type's derived values, read as `@item.derived.<name>` (T-1608). */
  derived?: Readonly<Record<string, string>> | undefined;
}

/**
 * One row of an `items` node (FR-SHEET-12, ADR-063): fields are the item's, while formulas
 * still read the holder, its derived values and `@item`. Secret fields of the item stay on
 * its own sheet, and so do presence and rich text.
 */
export function ItemRow({
  item,
  store,
  schema,
  readOnly,
  layout,
  derived,
}: ItemRowProps): ReactElement {
  const sheet = useSheet();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const data = useMemo(() => withDefaults(schema, snapshot), [schema, snapshot]);
  const { settings, functions } = sheet;
  // Formulas in the row read the item's fields and derived values as `@item` (T-1608).
  const itemScope = useMemo(() => {
    const values = computeDerived(derived ?? {}, data, { settings, functions }).values;
    return { ...data, derived: values, id: item.id, name: item.name, type: item.type };
  }, [derived, data, settings, functions, item.id, item.name, item.type]);
  const row: SheetEnvironment = {
    ...sheet,
    store,
    schema,
    data,
    holderData: sheet.holderData ?? sheet.data,
    item,
    itemScope,
    readOnly: sheet.readOnly || readOnly,
    secret: false,
    presence: undefined,
    renderRichText: undefined,
    renderItems: undefined,
  };
  return (
    <SheetContext.Provider value={row}>
      <SheetNodeView node={layout} />
    </SheetContext.Provider>
  );
}
