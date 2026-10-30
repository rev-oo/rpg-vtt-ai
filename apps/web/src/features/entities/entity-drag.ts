import type { DragEvent } from 'react';

// Library items and compendium entries can be dropped onto an actor sheet's items (ADR-063),
// and actors onto the map, where they become tokens (ADR-068).

/** A library item's id. */
export const LIBRARY_ITEM = 'application/x-vtt-library-item';
/** A compendium item entry's ref (`<system>:<pack>:<id>`). */
export const COMPENDIUM_ITEM = 'application/x-vtt-compendium-item';

/** An actor's id. */
export const ACTOR = 'application/x-vtt-actor';

export type ItemDrag = { kind: 'library'; itemId: string } | { kind: 'compendium'; ref: string };
export type EntityDrag = ItemDrag | { kind: 'actor'; actorId: string };

/** Puts `drag` on a drag that starts from a row. */
export function startEntityDrag(event: DragEvent, drag: EntityDrag): void {
  event.dataTransfer.effectAllowed = 'copy';
  if (drag.kind === 'library') event.dataTransfer.setData(LIBRARY_ITEM, drag.itemId);
  else if (drag.kind === 'compendium') event.dataTransfer.setData(COMPENDIUM_ITEM, drag.ref);
  else event.dataTransfer.setData(ACTOR, drag.actorId);
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

/** Whether a drag carries an actor, before its data can be read. */
export const carriesActor = (event: DragEvent): boolean => event.dataTransfer.types.includes(ACTOR);

/** The id of the actor a drop brings, if any. */
export const droppedActor = (event: DragEvent): string | undefined =>
  event.dataTransfer.getData(ACTOR) || undefined;
