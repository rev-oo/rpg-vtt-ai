import { eq } from 'drizzle-orm';
import * as Y from 'yjs';

import {
  adjustCounter,
  documentLayout,
  ensureContainers,
  layerSchemas,
  mergeLayers,
  readLayer,
  repairLayer,
  splitLayers,
  withDefaults,
  writeLayer,
  type DocumentLayout,
  type HeldItem,
  type LayerData,
} from '@vtt/plugin-engine';
import type { FieldSchema, PluginDefinition } from '@vtt/plugin-schema';
import { documentName, type DocumentRef } from '@vtt/shared';
import { MAX_ACTOR_ITEMS, type DataIssue, type FieldPath } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { findActor, findItem, heldItems, type Actor } from '../db/repositories/index.js';
import { actors, items, ydocs } from '../db/schema.js';

import { recordSnapshot } from './history.js';
import { findTable } from './tables.js';

/** The validated definition of a system plugin, from the registry (ADR-020). */
export type DefinitionOf = (systemId: string) => PluginDefinition | undefined;

/** The field `data` map of a collaborative document (specs §9.2). */
export const DATA_MAP = 'data';

/** The kinds of entity with sheet documents: actors and items (ADR-062). */
export type EntityKind = 'actor' | 'item';

/** What the document code needs of an actor or an item. */
export interface SheetEntity {
  id: string;
  tableId: string;
  type: string;
  system: Record<string, unknown>;
}

/** An actor or item, also from the trash, for the documents a ref names. */
function findEntity(db: DbOrTx, kind: EntityKind, id: string): SheetEntity | undefined {
  return kind === 'actor'
    ? findActor(db, id, { includeDeleted: true })
    : findItem(db, id, { includeDeleted: true });
}

/** How an entity's data splits into its documents, if its system still declares its type. */
function entityLayout(db: DbOrTx, kind: EntityKind, entity: SheetEntity, definition: DefinitionOf) {
  const table = findTable(db, entity.tableId);
  const plugin = table ? definition(table.systemId) : undefined;
  const types = plugin && (kind === 'actor' ? plugin.actorTypes : plugin.itemTypes);
  const type = types && Object.hasOwn(types, entity.type) ? types[entity.type] : undefined;
  return type && { schema: type.schema, layout: documentLayout(type.schema) };
}

/**
 * Whether an actor or item has a secret document: its type declares secret fields. While the
 * system cannot describe the type, the document stays reachable for the GM, read-only.
 */
export function hasSecretLayer(
  db: DbOrTx,
  entity: SheetEntity,
  definition: DefinitionOf,
  kind: EntityKind = 'actor',
): boolean {
  const table = findTable(db, entity.tableId);
  if (!table || !definition(table.systemId)) return true;
  return entityLayout(db, kind, entity, definition)?.layout.secret !== undefined;
}

/** The schema of one of an entity's documents, if its system still declares its type. */
function layerSchema(db: DbOrTx, ref: DocumentRef, definition: DefinitionOf) {
  if (ref.kind === 'journal') return undefined;
  const entity = findEntity(db, ref.kind, ref.id);
  const type = entity && entityLayout(db, ref.kind, entity, definition);
  return type && layerSchemas(type.schema)[ref.layer];
}

/**
 * Replaces values that do not fit the schema with their defaults (specs §9.7) and lists
 * them. The repair reaches every client like any change; `origin` marks its transaction.
 * Journal bodies, and entities of types the system no longer declares, are left as they are.
 */
export function repairDocument(
  db: DbOrTx,
  ref: DocumentRef,
  doc: Y.Doc,
  { definition, origin }: { definition: DefinitionOf; origin: unknown },
): DataIssue[] {
  const schema: FieldSchema | undefined = layerSchema(db, ref, definition);
  if (!schema) return [];
  return doc.transact(() => repairLayer(doc.getMap(DATA_MAP), schema), origin);
}

/**
 * Adds `delta` to a counter of the document (specs §9.5) in one transaction on the server's
 * copy, so concurrent adjustments add up. `undefined` when the path names no counter.
 */
export function adjustDocument(
  db: DbOrTx,
  ref: DocumentRef,
  doc: Y.Doc,
  { path, delta }: { path: FieldPath; delta: number },
  { definition, origin }: { definition: DefinitionOf; origin: unknown },
): { value: number; clamped: boolean } | undefined {
  const schema = layerSchema(db, ref, definition);
  if (!schema) return undefined;
  return doc.transact(() => adjustCounter(doc.getMap(DATA_MAP), schema, path, delta), origin);
}

/** The fields of one layer; without a layout every value is plain. */
const layerFields = (layout: DocumentLayout | undefined, layer: DocumentRef['layer']) =>
  (layer === 'secret' ? layout?.secret : layout?.main) ?? {};

/**
 * Loads a document (specs §9.6): its stored state, or else a first state built from the
 * entity's projection with the schema's defaults filled in. Journal bodies start empty.
 * Every object and collection map the layout declares exists afterwards (§9.4).
 */
export function loadDocument(
  db: DbOrTx,
  ref: DocumentRef,
  doc: Y.Doc,
  definition: DefinitionOf,
): void {
  const row = db
    .select({ state: ydocs.state })
    .from(ydocs)
    .where(eq(ydocs.name, documentName(ref)))
    .get();
  if (row) Y.applyUpdate(doc, row.state);
  if (ref.kind === 'journal') return;
  const entity = findEntity(db, ref.kind, ref.id);
  if (!entity) return;
  const type = entityLayout(db, ref.kind, entity, definition);
  if (row) {
    // A schema may have gained maps since the state was stored.
    ensureContainers(doc.getMap(DATA_MAP), layerFields(type?.layout, ref.layer));
    return;
  }
  const data = type ? withDefaults(type.schema, entity.system) : entity.system;
  const layers = type ? splitLayers(type.layout, data) : { main: data, secret: undefined };
  const part = ref.layer === 'secret' ? layers.secret : layers.main;
  const map = doc.getMap(DATA_MAP);
  writeLayer(map, layerFields(type?.layout, ref.layer), part ?? {});
  ensureContainers(map, layerFields(type?.layout, ref.layer));
}

/** The JSON of a stored document's layer, or `undefined` if it was never stored. */
function storedLayer(db: DbOrTx, name: string, fields: Parameters<typeof readLayer>[1]) {
  const row = db.select({ state: ydocs.state }).from(ydocs).where(eq(ydocs.name, name)).get();
  if (!row) return undefined;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.state);
  const data = readLayer(doc.getMap(DATA_MAP), fields);
  doc.destroy();
  return data;
}

/**
 * An entity's data from both layers: each from its live document when loaded, else from its
 * stored state, else from the projection.
 */
/** Reads each layer of an entity: live document, else stored state, else the projection. */
function layerReader(
  db: DbOrTx,
  kind: EntityKind,
  entity: SheetEntity,
  definition: DefinitionOf,
  live: (name: string) => Y.Doc | undefined,
) {
  const type = entityLayout(db, kind, entity, definition);
  const split = type && splitLayers(type.layout, entity.system);
  const layer = (name: DocumentRef['layer']): LayerData | undefined => {
    const fields = layerFields(type?.layout, name);
    const docName = documentName({ kind, id: entity.id, layer: name });
    const doc = live(docName);
    if (doc) return readLayer(doc.getMap(DATA_MAP), fields);
    return storedLayer(db, docName, fields) ?? (split ? split[name] : undefined);
  };
  // Without a layout the projection is one plain layer.
  return {
    main: () => layer('main') ?? (type ? {} : entity.system),
    secret: () => layer('secret'),
  };
}

function joinLayers(
  db: DbOrTx,
  kind: EntityKind,
  entity: SheetEntity,
  definition: DefinitionOf,
  live: (name: string) => Y.Doc | undefined,
): LayerData {
  const read = layerReader(db, kind, entity, definition, live);
  return mergeLayers(read.main(), read.secret());
}

/**
 * An actor's current data for rolls (specs §9.6): from its live documents while one is
 * loaded, so a roll sees edits the store debounce has not saved yet. `undefined` when
 * neither document is loaded; the projection is then current.
 */
export function liveActorData(
  db: DbOrTx,
  actor: Actor,
  definition: DefinitionOf,
  live: (name: string) => Y.Doc | undefined,
): LayerData | undefined {
  const loaded = (['main', 'secret'] as const).some((layer) =>
    live(documentName({ kind: 'actor', id: actor.id, layer })),
  );
  return loaded ? joinLayers(db, 'actor', actor, definition, live) : undefined;
}

/**
 * The items an actor holds, for `@items` (ADR-063): each one's main layer from its live
 * document while one is loaded, so totals see edits not saved yet, else its projection.
 * Contributions only read main-layer fields (the validator checks), so secrets stay unread.
 */
export function liveHeldItems(
  db: DbOrTx,
  actor: Actor,
  definition: DefinitionOf,
  live: (name: string) => Y.Doc | undefined,
): HeldItem[] {
  return heldItems(db, actor.id, MAX_ACTOR_ITEMS).map((item) => ({
    type: item.type,
    data: live(documentName({ kind: 'item', id: item.id, layer: 'main' }))
      ? layerReader(db, 'item', item, definition, live).main()
      : item.system,
  }));
}

/**
 * Stores a document and refreshes its entity's projection in one transaction (specs §9.6).
 * An actor's or item's projection joins both layers: the other one comes from `live` when it
 * is loaded, else from its stored state, else from the projection itself. Only actors keep
 * sheet history (ADR-053).
 */
export function storeDocument(
  db: DbOrTx,
  ref: DocumentRef,
  doc: Y.Doc,
  {
    definition,
    live,
    now,
  }: { definition: DefinitionOf; live: (name: string) => Y.Doc | undefined; now: Date },
): void {
  const name = documentName(ref);
  db.transaction((tx) => {
    const owner = ref.kind === 'journal' ? undefined : findEntity(tx, ref.kind, ref.id);
    // An entity purged meanwhile has nothing to store.
    if (ref.kind !== 'journal' && !owner) return;
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    tx.insert(ydocs)
      .values({
        name,
        actorId: ref.kind === 'actor' ? ref.id : null,
        itemId: ref.kind === 'item' ? ref.id : null,
        journalEntryId: ref.kind === 'journal' ? ref.id : null,
        state,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: ydocs.name, set: { state, updatedAt: now } })
      .run();
    if (!owner || ref.kind === 'journal') return;
    const system = joinLayers(tx, ref.kind, owner, definition, (name) =>
      name === documentName(ref) ? doc : live(name),
    );
    if (ref.kind === 'item') {
      tx.update(items).set({ system, updatedAt: now }).where(eq(items.id, ref.id)).run();
      return;
    }
    recordSnapshot(tx, { actorId: owner.id, layer: ref.layer }, doc.getMap(DATA_MAP), now);
    tx.update(actors).set({ system, updatedAt: now }).where(eq(actors.id, ref.id)).run();
  });
}
