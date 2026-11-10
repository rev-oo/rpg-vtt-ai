import { eq } from 'drizzle-orm';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { TableRole } from '@vtt/shared';
import type { ActorStatus } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import type { Actor } from '../db/repositories/index.js';
import { combatants, tokens } from '../db/schema.js';

import type { DefinitionOf, StoredActor } from './documents.js';
import { dataFilter } from './entities.js';
import { findTable } from './tables.js';

// Token statuses (T-1615): true/false fields an actor type shows on its tokens and in the
// combat tracker while they are on, such as conditions. They read the actor's projection, as
// the member may see it, so a secret field's status shows only to GMs and assistants.

/** An actor's statuses that are on, as one member sees them; none for a token alone. */
export type StatusReader = (actor: Actor | undefined) => ActorStatus[];

/** Where the plugin serves a file of its own, as the theme's images are served (ADR-076). */
const fileUrl = (pluginId: string, file: string): string =>
  `/plugins/${pluginId}/${file.split('/').map(encodeURIComponent).join('/')}`;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at a dotted path of entity data, through objects only. */
function valueAt(data: Readonly<Record<string, unknown>>, path: string): unknown {
  let value: unknown = data;
  for (const key of path.split('.')) {
    value = isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
  }
  return value;
}

/** The statuses of an actor of `plugin` that are on in `data`, in their declared order. */
export function statusesOn(
  plugin: PluginDefinition,
  type: string,
  data: Readonly<Record<string, unknown>>,
): ActorStatus[] {
  const declared = Object.hasOwn(plugin.actorTypes, type) ? plugin.actorTypes[type] : undefined;
  return (declared?.statuses ?? [])
    .filter((status) => valueAt(data, status.field) === true)
    .map((status) => ({
      field: status.field,
      label: status.label,
      iconUrl: fileUrl(plugin.manifest.id, status.icon),
    }));
}

/** Reads the statuses of a table's actors as a member with `role` may see them. */
export function statusReader(
  db: DbOrTx,
  definition: DefinitionOf,
  tableId: string,
  role: TableRole,
): StatusReader {
  const table = findTable(db, tableId);
  const plugin = table ? definition(table.systemId) : undefined;
  if (!plugin) return () => [];
  const visible = dataFilter(plugin, role);
  return (actor) =>
    actor ? statusesOn(plugin, actor.type, visible('actor', actor.type, actor.system)) : [];
}

/** Where an actor's statuses show, when a store turned one on or off; else `undefined`. */
export function statusChange(
  db: DbOrTx,
  definition: DefinitionOf,
  { before, actor }: StoredActor,
): { sceneIds: string[]; inCombat: boolean } | undefined {
  const table = findTable(db, actor.tableId);
  const plugin = table ? definition(table.systemId) : undefined;
  const type =
    plugin && Object.hasOwn(plugin.actorTypes, actor.type)
      ? plugin.actorTypes[actor.type]
      : undefined;
  if (!plugin || !type?.statuses) return undefined;
  const on = (data: Readonly<Record<string, unknown>>) =>
    statusesOn(plugin, actor.type, data)
      .map((status) => status.field)
      .join('\n');
  if (on(before) === on(actor.system)) return undefined;
  const sceneIds = db
    .selectDistinct({ sceneId: tokens.sceneId })
    .from(tokens)
    .where(eq(tokens.actorId, actor.id))
    .all()
    .map((row) => row.sceneId);
  const fighting = db
    .select({ id: combatants.id })
    .from(combatants)
    .where(eq(combatants.actorId, actor.id))
    .get();
  return { sceneIds, inCombat: fighting !== undefined };
}
