import { eq } from 'drizzle-orm';
import * as Y from 'yjs';

import {
  adjustCounter,
  documentLayout,
  ensureMaps,
  layerSchemas,
  mergeLayers,
  readLayer,
  repairLayer,
  splitLayers,
  withDefaults,
  writeLayer,
  type DocumentLayout,
  type LayerData,
} from '@vtt/plugin-engine';
import type { FieldSchema, PluginDefinition } from '@vtt/plugin-schema';
import { documentName, type DocumentRef } from '@vtt/shared';
import type { DataIssue, FieldPath } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { findActor, type Actor } from '../db/repositories/index.js';
import { actors, ydocs } from '../db/schema.js';

import { findTable } from './tables.js';

/** The validated definition of a system plugin, from the registry (ADR-020). */
export type DefinitionOf = (systemId: string) => PluginDefinition | undefined;

/** The field `data` map of a collaborative document (specs §9.2). */
export const DATA_MAP = 'data';

/** How an actor's data splits into its documents, if its system still declares its type. */
function actorLayout(db: DbOrTx, actor: Actor, definition: DefinitionOf) {
  const table = findTable(db, actor.tableId);
  const plugin = table ? definition(table.systemId) : undefined;
  const type =
    plugin && Object.hasOwn(plugin.actorTypes, actor.type)
      ? plugin.actorTypes[actor.type]
      : undefined;
  return type && { schema: type.schema, layout: documentLayout(type.schema) };
}

/**
 * Whether an actor has a secret document: its type declares secret fields. While the system
 * cannot describe the type, the document stays reachable for the GM, read-only.
 */
export function hasSecretLayer(db: DbOrTx, actor: Actor, definition: DefinitionOf): boolean {
  const table = findTable(db, actor.tableId);
  if (!table || !definition(table.systemId)) return true;
  return actorLayout(db, actor, definition)?.layout.secret !== undefined;
}

/** The schema of one of an actor's documents, if its system still declares its type. */
function layerSchema(db: DbOrTx, ref: DocumentRef, definition: DefinitionOf) {
  if (ref.kind !== 'actor') return undefined;
  const actor = findActor(db, ref.id, { includeDeleted: true });
  const type = actor && actorLayout(db, actor, definition);
  return type && layerSchemas(type.schema)[ref.layer];
}

/**
 * Replaces values that do not fit the schema with their defaults (specs §9.7) and lists
 * them. The repair reaches every client like any change; `origin` marks its transaction.
 * Journal bodies and actors of types the system no longer declares are left as they are.
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
  if (ref.kind !== 'actor') return;
  const actor = findActor(db, ref.id, { includeDeleted: true });
  if (!actor) return;
  const type = actorLayout(db, actor, definition);
  if (row) {
    // A schema may have gained maps since the state was stored.
    ensureMaps(doc.getMap(DATA_MAP), layerFields(type?.layout, ref.layer));
    return;
  }
  const data = type ? withDefaults(type.schema, actor.system) : actor.system;
  const layers = type ? splitLayers(type.layout, data) : { main: data, secret: undefined };
  const part = ref.layer === 'secret' ? layers.secret : layers.main;
  const map = doc.getMap(DATA_MAP);
  writeLayer(map, layerFields(type?.layout, ref.layer), part ?? {});
  ensureMaps(map, layerFields(type?.layout, ref.layer));
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
 * Stores a document and refreshes its entity's projection in one transaction (specs §9.6).
 * An actor's projection joins both layers: the other one comes from `live` when it is
 * loaded, else from its stored state, else from the projection itself.
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
    const owner =
      ref.kind === 'actor' ? findActor(tx, ref.id, { includeDeleted: true }) : undefined;
    // An entity purged meanwhile has nothing to store.
    if (ref.kind === 'actor' && !owner) return;
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    tx.insert(ydocs)
      .values({
        name,
        actorId: ref.kind === 'actor' ? ref.id : null,
        journalEntryId: ref.kind === 'journal' ? ref.id : null,
        state,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: ydocs.name, set: { state, updatedAt: now } })
      .run();
    if (!owner) return;

    const type = actorLayout(tx, owner, definition);
    const otherLayer = ref.layer === 'main' ? 'secret' : 'main';
    const read = (layer: DocumentRef['layer'], from: Y.Doc) =>
      readLayer(from.getMap(DATA_MAP), layerFields(type?.layout, layer));
    const otherName = documentName({ kind: 'actor', id: ref.id, layer: otherLayer });
    const otherDoc = live(otherName);
    let other: LayerData | undefined = otherDoc
      ? read(otherLayer, otherDoc)
      : storedLayer(tx, otherName, layerFields(type?.layout, otherLayer));
    if (!other && type) {
      const split = splitLayers(type.layout, owner.system);
      other = otherLayer === 'main' ? split.main : split.secret;
    }
    const own = read(ref.layer, doc);
    const system = ref.layer === 'main' ? mergeLayers(own, other) : mergeLayers(other ?? {}, own);
    tx.update(actors).set({ system, updatedAt: now }).where(eq(actors.id, ref.id)).run();
  });
}
