import { eq } from 'drizzle-orm';

import {
  canEditActor,
  canManageItemLibrary,
  canViewActor,
  type ControlledBy,
  type Ownership,
  type OwnershipLevel,
  type Subject,
} from '@vtt/shared';
import type { ActorView, ItemView } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import type { Actor, Item } from '../db/repositories/index.js';
import { plugins } from '../db/schema.js';
import { conflict, unprocessable } from '../errors.js';

import { isAvailable } from './plugins.js';
import type { GameTable } from './tables.js';

export type EntityAccess = ActorView['access'];

/** What a member may do with an actor, or `null` if they may not see it (FR-ENT-03). */
export function actorAccess(subject: Subject, actor: Actor): EntityAccess | null {
  if (!canViewActor(subject, actor.ownership)) return null;
  return canEditActor(subject, actor.ownership) ? 'owner' : 'observer';
}

/**
 * Library items are read by every member and edited by GMs and assistants; owned items follow
 * their actor (FR-ENT-05). `actor` is the owning actor, when there is one.
 */
export function itemAccess(subject: Subject, actor: Actor | undefined): EntityAccess | null {
  if (actor) return actorAccess(subject, actor);
  return canManageItemLibrary(subject.role) ? 'owner' : 'observer';
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

function definedLevels(users: Ownership['users']): Record<string, OwnershipLevel> {
  const levels: Record<string, OwnershipLevel> = {};
  for (const [userId, level] of Object.entries(users)) if (level) levels[userId] = level;
  return levels;
}

export function toActorView(actor: Actor, access: EntityAccess): ActorView {
  return {
    id: actor.id,
    tableId: actor.tableId,
    type: actor.type,
    name: actor.name,
    imageUrl: actor.imageUrl,
    ownership: { default: actor.ownership.default, users: definedLevels(actor.ownership.users) },
    system: actor.system,
    dataVersion: actor.dataVersion,
    createdAt: actor.createdAt.toISOString(),
    updatedAt: actor.updatedAt.toISOString(),
    deletedAt: iso(actor.softDeletedAt),
    access,
  };
}

export function toItemView(item: Item, access: EntityAccess): ItemView {
  return {
    id: item.id,
    tableId: item.tableId,
    actorId: item.actorId,
    sourceId: item.sourceId,
    type: item.type,
    name: item.name,
    imageUrl: item.imageUrl,
    system: item.system,
    dataVersion: item.dataVersion,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    deletedAt: iso(item.softDeletedAt),
    access,
  };
}

/** The entity types the table's system plugin declares (§8.4). */
export interface SystemTypes {
  actorTypes: Readonly<Record<string, { controlledBy: ControlledBy }>>;
  itemTypes: readonly string[];
}

export function systemTypes(db: DbOrTx, table: GameTable): SystemTypes {
  const plugin = db
    .select({ actorTypes: plugins.actorTypes, itemTypes: plugins.itemTypes })
    .from(plugins)
    .where(eq(plugins.id, table.systemId))
    .get();
  if (!plugin) {
    throw unprocessable('system_unavailable', "The table's system plugin is not installed.");
  }
  return plugin;
}

/** Whether the table's system plugin is available, so its entities may change (FR-PLUGIN-07). */
export function isSystemWritable(db: DbOrTx, table: GameTable): boolean {
  const plugin = db
    .select({ enabled: plugins.enabled, status: plugins.status })
    .from(plugins)
    .where(eq(plugins.id, table.systemId))
    .get();
  return plugin !== undefined && isAvailable(plugin);
}

/**
 * Tables of a disabled, broken or removed system are read-only (FR-PLUGIN-07): entity
 * changes and rolls fail with 409 `table_read_only`. Members can still read and chat.
 */
export function requireWritableSystem(db: DbOrTx, table: GameTable): void {
  if (!isSystemWritable(db, table)) {
    throw conflict(
      'table_read_only',
      "The table's system plugin is disabled or unavailable, so the table is read-only.",
    );
  }
}

/** The types of a table's system, for creating entities; the table must be writable. */
export function writableSystemTypes(db: DbOrTx, table: GameTable): SystemTypes {
  requireWritableSystem(db, table);
  return systemTypes(db, table);
}

/** How a type is controlled; throws 422 if the system does not declare it. */
export function actorTypeControl(types: SystemTypes, type: string): ControlledBy {
  const declared = Object.hasOwn(types.actorTypes, type) ? types.actorTypes[type] : undefined;
  if (!declared) {
    throw unprocessable('unknown_actor_type', `The system has no actor type "${type}".`);
  }
  return declared.controlledBy;
}

export function requireItemType(types: SystemTypes, type: string): void {
  if (!types.itemTypes.includes(type)) {
    throw unprocessable('unknown_item_type', `The system has no item type "${type}".`);
  }
}
