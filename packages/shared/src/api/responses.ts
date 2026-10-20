import { z } from 'zod';

import { CONTROLLED_BY } from '../permissions/entities.js';
import { OWNERSHIP_LEVELS } from '../permissions/ownership.js';
import { TABLE_ROLES } from '../roles.js';

// Response bodies of the HTTP API. The server builds them with these types; the web validates
// them like any external input (specs §17).

export const publicUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  isAdmin: z.boolean(),
  mustChangePassword: z.boolean(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const sessionSchema = z.object({ user: publicUserSchema, csrfToken: z.string() });
export type Session = z.infer<typeof sessionSchema>;

export const setupStatusSchema = z.object({ needsSetup: z.boolean() });

export const userResponseSchema = z.object({ user: publicUserSchema });

/** The table fields members may see, plus the caller's own role. */
export const tableSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemId: z.string(),
  /** The plugin's display name, or its id if the plugin is no longer installed. */
  systemName: z.string(),
  systemVersion: z.string(),
  settings: z.record(z.string(), z.unknown()),
  playersMayCreateAnyActorType: z.boolean(),
  createdAt: z.string(),
  role: z.enum(TABLE_ROLES),
});
export type TableView = z.infer<typeof tableSchema>;

export const tablesResponseSchema = z.object({ tables: z.array(tableSchema) });
export const tableResponseSchema = z.object({ table: tableSchema });

/** A member of a table, as every member sees the list (FR-TABLE-04, 05). */
export const memberSchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: z.enum(TABLE_ROLES),
  defaultCharacterId: z.string().nullable(),
  joinedAt: z.string(),
});
export type MemberView = z.infer<typeof memberSchema>;
export const membersResponseSchema = z.object({ members: z.array(memberSchema) });

export const systemSchema = z.object({ id: z.string(), name: z.string(), version: z.string() });
export type GameSystem = z.infer<typeof systemSchema>;
export const systemsResponseSchema = z.object({ systems: z.array(systemSchema) });

/** The actor and item types the table's system declares (§8.4), for creation forms. */
export const tableTypesSchema = z.object({
  actorTypes: z.array(z.object({ type: z.string(), controlledBy: z.enum(CONTROLLED_BY) })),
  itemTypes: z.array(z.string()),
});
export type TableTypes = z.infer<typeof tableTypesSchema>;

const ownershipView = z.object({
  default: z.enum(OWNERSHIP_LEVELS),
  users: z.record(z.string(), z.enum(OWNERSHIP_LEVELS)),
});

/** What the caller may do with an entity: read it, or read and edit it (FR-ENT-03). */
export const ENTITY_ACCESS = ['observer', 'owner'] as const;

const entityTimestamps = {
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set while the entity is in the trash (FR-ENT-04). */
  deletedAt: z.string().nullable(),
};

/** An actor's listing projection; its live data comes from the collab document (M5). */
export const actorSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  type: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  ownership: ownershipView,
  system: z.record(z.string(), z.unknown()),
  dataVersion: z.string(),
  ...entityTimestamps,
  access: z.enum(ENTITY_ACCESS),
});
export type ActorView = z.infer<typeof actorSchema>;
export const actorsResponseSchema = z.object({ actors: z.array(actorSchema) });
export const actorResponseSchema = z.object({ actor: actorSchema });

/** A library item (`actorId` null) or an item owned by an actor (FR-ENT-05). */
export const itemSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  actorId: z.string().nullable(),
  sourceId: z.string().nullable(),
  type: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  system: z.record(z.string(), z.unknown()),
  dataVersion: z.string(),
  ...entityTimestamps,
  access: z.enum(ENTITY_ACCESS),
});
export type ItemView = z.infer<typeof itemSchema>;
export const itemsResponseSchema = z.object({ items: z.array(itemSchema) });
export const itemResponseSchema = z.object({ item: itemSchema });

/** Every error is rendered as this envelope (specs §10.1). */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
