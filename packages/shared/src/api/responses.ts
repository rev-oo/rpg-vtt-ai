import { z } from 'zod';

import { CONTROLLED_BY } from '../permissions/entities.js';
import { OWNERSHIP_LEVELS } from '../permissions/ownership.js';
import { INVITE_ROLES, TABLE_ROLES } from '../roles.js';

import { instanceSettingsSchema, REGISTRATION_POLICIES } from './requests.js';

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
  /** Whether the system plugin is enabled and ready; without it the table is read-only. */
  systemAvailable: z.boolean(),
  createdAt: z.string(),
  /** When the table was archived; archived tables are read-only (FR-TABLE-06). */
  archivedAt: z.string().nullable(),
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
/** `PATCH /tables/:id/members/:userId`. */
export const memberUpdateResponseSchema = z.object({
  member: memberSchema.pick({ userId: true, role: true, defaultCharacterId: true }),
});

export const INVITE_STATUSES = ['active', 'expired', 'revoked'] as const;
export const inviteSchema = z.object({
  id: z.string(),
  role: z.enum(INVITE_ROLES),
  status: z.enum(INVITE_STATUSES),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type InviteView = z.infer<typeof inviteSchema>;
export const invitesResponseSchema = z.object({ invites: z.array(inviteSchema) });
/** The raw token and link are only ever sent once, on creation. */
export const createdInviteResponseSchema = z.object({
  invite: inviteSchema,
  token: z.string(),
  url: z.string(),
});
/** `GET /invites/:token`: which table and role a link is for. */
export const invitePreviewResponseSchema = z.object({
  invite: z.object({
    role: z.enum(INVITE_ROLES),
    table: z.object({ id: z.string(), name: z.string() }),
  }),
});
export type InvitePreview = z.infer<typeof invitePreviewResponseSchema>['invite'];
export const acceptInviteResponseSchema = z.object({ table: tableSchema, joined: z.boolean() });
/** `POST /invites/:token/signup`: the new account is signed in and has joined the table. */
export const signupResponseSchema = sessionSchema.extend({ table: tableSchema });
export type SignupResponse = z.infer<typeof signupResponseSchema>;

export const systemSchema = z.object({ id: z.string(), name: z.string(), version: z.string() });
export type GameSystem = z.infer<typeof systemSchema>;
export const systemsResponseSchema = z.object({ systems: z.array(systemSchema) });

/**
 * `GET /systems/:id`: what the web app needs to run a system plugin (T-0409, ADR-025). The
 * definition is the validator's output; its shape is `pluginDefinitionSchema` in
 * `@vtt/plugin-schema`, which the web checks it against (specs §14).
 */
export const systemDefinitionResponseSchema = z.object({
  system: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    definition: z.record(z.string(), z.unknown()),
    /** Scoped stylesheets, in order (ADR-021, ADR-022). */
    styles: z.array(z.string()),
    /** `code/client.js`, when the plugin has one (specs §8.10). */
    client: z.string().nullable(),
    /** `code/shared.js`, whose functions formulas call in the browser too (ADR-047). */
    shared: z.string().nullable(),
  }),
});
export type SystemDefinitionResponse = z.infer<typeof systemDefinitionResponseSchema>;
export type SystemDefinition = SystemDefinitionResponse['system'];

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

/** A journal entry's metadata; its body is the collaborative document `journal:<id>:main`. */
export const journalEntrySchema = z.object({
  id: z.string(),
  tableId: z.string(),
  title: z.string(),
  /** Hidden entries reach only GMs and assistants (FR-JOURNAL-03). */
  hidden: z.boolean(),
  ownership: ownershipView,
  ...entityTimestamps,
  access: z.enum(ENTITY_ACCESS),
});
export type JournalEntryView = z.infer<typeof journalEntrySchema>;
export const journalEntriesResponseSchema = z.object({ entries: z.array(journalEntrySchema) });
export const journalEntryResponseSchema = z.object({ entry: journalEntrySchema });

/** Every error is rendered as this envelope (specs §10.1). */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/** `GET/PATCH /admin/settings` (FR-ADMIN-01). */
export const instanceSettingsResponseSchema = z.object({ settings: instanceSettingsSchema });

/** `GET /instance`: what anyone may know about the instance, before signing in. */
export const instanceInfoSchema = z.object({
  siteName: z.string(),
  registration: z.enum(REGISTRATION_POLICIES),
});
export type InstanceInfo = z.infer<typeof instanceInfoSchema>;
export const instanceInfoResponseSchema = z.object({ instance: instanceInfoSchema });

/** `GET /api/health` (FR-ADMIN-03): 200 when healthy, 503 otherwise. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'unhealthy']),
  database: z.enum(['ok', 'error']),
  plugins: z.object({
    /** Enabled plugins, and how many of them are loaded and usable. */
    enabled: z.int(),
    ready: z.int(),
    /** Enabled plugins that are invalid, incompatible or missing. */
    failed: z.int(),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * The `details` of a `validation_failed` error, one entry per problem. Table settings also
 * carry a `reason` (a data issue reason or `unknown`, ADR-039) for clients to word.
 */
export const validationDetailsSchema = z.array(
  z.object({ path: z.string(), message: z.string(), reason: z.string().optional() }),
);
