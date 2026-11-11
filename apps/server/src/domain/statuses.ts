import { activeStatuses } from '@vtt/plugin-engine';
import { isGmLike, type TableRole } from '@vtt/shared';
import type { TokenStatus } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import type { Actor } from '../db/repositories/index.js';

import type { DefinitionOf } from './documents.js';
import { findTable } from './tables.js';

/** An actor's statuses that are on, as one member sees them (T-1618). */
export type StatusesOf = (actor: Actor | undefined) => TokenStatus[];

/** Where a file of a plugin is served (§4.2). */
export const pluginFileUrl = (pluginId: string, file: string): string =>
  `/plugins/${encodeURIComponent(pluginId)}/${file}`;

/**
 * Reads the statuses of a table's actors (T-1618): the true/false fields their type lists as
 * statuses that are on in the actor's data. A secret field's status is for GMs and
 * assistants only. None while the table's system is unavailable.
 */
export function statusReader(
  db: DbOrTx,
  tableId: string,
  definition: DefinitionOf,
  role: TableRole,
): StatusesOf {
  const table = findTable(db, tableId);
  const plugin = table && definition(table.systemId);
  if (!table || !plugin) return () => [];
  const secrets = isGmLike(role);
  return (actor) => {
    if (!actor || !Object.hasOwn(plugin.actorTypes, actor.type)) return [];
    return activeStatuses(plugin.actorTypes[actor.type], actor.system, { secrets }).map(
      ({ field, label, icon }) => ({ field, label, icon: pluginFileUrl(table.systemId, icon) }),
    );
  };
}
