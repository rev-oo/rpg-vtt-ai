import type { DragEvent } from 'react';

// Library items and compendium entries can be dropped onto an actor sheet's items (ADR-063).

/** A library item's id. */
export const LIBRARY_ITEM = 'application/x-vtt-library-item';
/** A compendium item entry's ref (`<system>:<pack>:<id>`). */
export const COMPENDIUM_ITEM = 'application/x-vtt-compendium-item';

export type ItemDrag = { kind: 'library'; itemId: string } | { kind: 'compendium'; ref: string };

/** Puts `drag` on a drag that starts from a row. */
export function startItemDrag(event: DragEvent, drag: ItemDrag): void {
  event.dataTransfer.effectAllowed = 'copy';
  if (drag.kind === 'library') event.dataTransfer.setData(LIBRARY_ITEM, drag.itemId);
  else event.dataTransfer.setData(COMPENDIUM_ITEM, drag.ref);
}

/** Whether a drag carries an item, before its data can be read. */
export function carriesItem(event: DragEvent): boolean {
  const { types } = event.dataTransfer;
  return types.includes(LIBRARY_ITEM) || types.includes(COMPENDIUM_ITEM);
}

/** The item a drop brings, if any. */
export function droppedItem(event: DragEvent): ItemDrag | undefined {
  const itemId = event.dataTransfer.getData(LIBRARY_ITEM);
  if (itemId) return { kind: 'library', itemId };
  const ref = event.dataTransfer.getData(COMPENDIUM_ITEM);
  return ref ? { kind: 'compendium', ref } : undefined;
}
