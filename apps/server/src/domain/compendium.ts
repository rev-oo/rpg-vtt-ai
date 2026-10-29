import { and, eq, inArray, isNull } from 'drizzle-orm';

import { packData } from '@vtt/plugin-engine';
import type { PackEntry, PluginDefinition } from '@vtt/plugin-schema';
import type { CompendiumPack, CompendiumQuery } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import {
  createActor,
  createItem,
  type Actor,
  type Item,
  type ListWindow,
  type NameKey,
} from '../db/repositories/index.js';
import { actors, items } from '../db/schema.js';
import { notFound, unprocessable } from '../errors.js';

import { requireRoomForItems } from './entities.js';
import type { GameTable } from './tables.js';

// The compendium (FR-PLUGIN-09, ADR-060): the entries of the system's packs, which members
// browse and copy into the table's actors and library, or onto their own actors.

/** An entry of one of the system's packs, with where it came from. */
export interface CompendiumItem {
  /** `<plugin>:<pack>:<entry id>`, kept by copies as their `pack_ref`. */
  ref: string;
  pack: string;
  entry: PackEntry;
}

/** The sort key of the compendium's name order, as the entity lists use (ADR-057). */
type KeyOf = (name: string, id: string) => NameKey;

const before = (a: NameKey, b: NameKey) =>
  a.name < b.name || (a.name === b.name && a.id < b.id) ? -1 : 1;

/** The system's packs, for the pack filter. */
export function compendiumPacks(plugin: PluginDefinition): CompendiumPack[] {
  return Object.entries(plugin.packs ?? {}).map(([name, pack]) => ({ name, label: pack.label }));
}

/** Every entry of every pack of the system, in name order. */
export function compendiumItems(plugin: PluginDefinition, keyOf: KeyOf): CompendiumItem[] {
  const all = Object.entries(plugin.packs ?? {}).flatMap(([pack, { entries }]) =>
    entries.map((entry) => ({ ref: `${plugin.manifest.id}:${pack}:${entry.id}`, pack, entry })),
  );
  return all.sort((a, b) => before(keyOf(a.entry.name, a.ref), keyOf(b.entry.name, b.ref)));
}

/** The entries that match the filters, in a window of the name order (ADR-057). */
export function filterCompendium(
  all: readonly CompendiumItem[],
  query: CompendiumQuery,
  keyOf: KeyOf,
  { after, limit }: ListWindow,
): CompendiumItem[] {
  const search = query.search?.toLowerCase();
  const rows = all.filter(
    ({ pack, entry, ref }) =>
      (!search || entry.name.toLowerCase().includes(search)) &&
      (!query.pack || pack === query.pack) &&
      (!query.kind || entry.kind === query.kind) &&
      (!query.type || entry.type === query.type) &&
      (!after || before(after, keyOf(entry.name, ref)) < 0),
  );
  return limit === undefined ? rows : rows.slice(0, limit);
}

/**
 * The refs among `refs` that the table already holds: an actor, or a library item, live or in
 * the trash. Items on actors are their owners' copies, not the table's.
 */
export function refsInTable(db: DbOrTx, tableId: string, refs: readonly string[]): Set<string> {
  if (refs.length === 0) return new Set();
  const found = new Set<string>();
  const rows = [
    ...db
      .select({ ref: actors.packRef })
      .from(actors)
      .where(and(eq(actors.tableId, tableId), inArray(actors.packRef, [...refs])))
      .all(),
    ...db
      .select({ ref: items.packRef })
      .from(items)
      .where(
        and(eq(items.tableId, tableId), isNull(items.actorId), inArray(items.packRef, [...refs])),
      )
      .all(),
  ];
  for (const { ref } of rows) if (ref) found.add(ref);
  return found;
}

/** The entry's data as a new entity starts with it: lists become keyed rows (ADR-051 §2). */
export function entryData(plugin: PluginDefinition, entry: PackEntry): Record<string, unknown> {
  const types = entry.kind === 'actor' ? plugin.actorTypes : plugin.itemTypes;
  return packData(types[entry.type]?.schema, entry.data ?? {});
}

/** Where copies go: the table (its actors and library), or an actor's items. */
export type CopyTarget = { kind: 'table'; createdBy: string } | { kind: 'actor'; actor: Actor };

/**
 * Copies the entries named by `refs` (FR-PLUGIN-09): actors (owned by whoever copies, as when
 * they create one) and library items into the table, or items onto an actor. Every copy keeps
 * its entry's ref. Copying again makes another copy; the list marks what the table has.
 */
export function copyFromCompendium(
  db: DbOrTx,
  table: GameTable,
  plugin: PluginDefinition,
  refs: readonly string[],
  target: CopyTarget,
  now: Date,
): { actors: Actor[]; items: Item[] } {
  const byRef = new Map(
    compendiumItems(plugin, (name, id) => ({ name, id })).map((item) => [item.ref, item]),
  );
  const chosen = [...new Set(refs)].map((ref) => {
    const found = byRef.get(ref);
    if (!found) throw notFound('Compendium entry not found.');
    if (target.kind === 'actor' && found.entry.kind !== 'item') {
      throw unprocessable('not_an_item', 'Only items can be copied onto an actor.');
    }
    return found;
  });
  return db.transaction((tx) => {
    if (target.kind === 'actor') requireRoomForItems(tx, target.actor.id, chosen.length);
    const created = { actors: [] as Actor[], items: [] as Item[] };
    for (const { ref, entry } of chosen) {
      const base = {
        tableId: table.id,
        type: entry.type,
        name: entry.name,
        system: entryData(plugin, entry),
        dataVersion: table.systemVersion,
        packRef: ref,
      };
      if (entry.kind === 'actor' && target.kind === 'table') {
        created.actors.push(createActor(tx, { ...base, createdBy: target.createdBy }, now));
      } else {
        const actorId = target.kind === 'actor' ? target.actor.id : null;
        created.items.push(createItem(tx, { ...base, actorId }, now));
      }
    }
    return created;
  });
}
