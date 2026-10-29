import { z } from 'zod';

import { OWNERSHIP_LEVELS } from '../permissions/ownership.js';
import { INVITE_ROLES, TABLE_ROLES } from '../roles.js';

import {
  MAX_ASSET_QUOTA_BYTES,
  MAX_UPLOAD_BYTES,
  MIN_ASSET_QUOTA_BYTES,
  MIN_UPLOAD_BYTES,
  imageUrlSchema,
} from './assets.js';
import {
  MAX_DISPLAY_NAME,
  MAX_ENTITY_NAME,
  MAX_ENTITY_TYPE,
  MAX_LIST_PAGE,
  MAX_SEARCH,
  MAX_SITE_NAME,
  MAX_PASSWORD_LENGTH,
  MAX_SYSTEM_ID,
  MAX_TABLE_DESCRIPTION,
  MAX_TABLE_NAME,
  MAX_USERNAME_INPUT,
  MIN_PASSWORD_LENGTH,
  USERNAME_PATTERN,
} from './constants.js';

// Request bodies of the HTTP API. They carry no messages: each app installs its own error map
// (see ./issues.ts), so the web can translate them. A schema-level message would win over it.

export const usernameSchema = z.string().trim().regex(USERNAME_PATTERN);
export const displayNameSchema = z.string().trim().min(1).max(MAX_DISPLAY_NAME);
export const newPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);
const currentPasswordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);

const atLeastOneField = (body: object) => Object.keys(body).length > 0;
const AT_LEAST_ONE_FIELD = 'Provide at least one field.';

// Setup and auth (FR-AUTH-01, 03, 05)

export const setupAdminBody = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: newPasswordSchema,
});
export type SetupAdminInput = z.input<typeof setupAdminBody>;

export const loginBody = z.object({
  username: z.string().trim().min(1).max(MAX_USERNAME_INPUT),
  password: currentPasswordSchema,
});
export type LoginInput = z.input<typeof loginBody>;

export const updateMeBody = z.object({ displayName: displayNameSchema });
export type UpdateMeInput = z.input<typeof updateMeBody>;

export const changePasswordBody = z.object({
  currentPassword: currentPasswordSchema,
  newPassword: newPasswordSchema,
});
export type ChangePasswordInput = z.input<typeof changePasswordBody>;

// Users (FR-AUTH-02, admin only)

export const createUserBody = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  isAdmin: z.boolean().default(false),
});

export const updateUserBody = z
  .object({
    displayName: displayNameSchema,
    isAdmin: z.boolean(),
    disabled: z.boolean(),
    /** Replaces the password with a new one-time password, returned once. */
    resetPassword: z.literal(true),
  })
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);

// Tables (FR-TABLE-01, 02, 07)

const tableName = z.string().trim().min(1).max(MAX_TABLE_NAME);
const tableDescription = z.string().trim().max(MAX_TABLE_DESCRIPTION);
const tableSettings = z.record(z.string(), z.unknown());

export const createTableBody = z.object({
  name: tableName,
  description: tableDescription.default(''),
  systemId: z.string().min(1).max(MAX_SYSTEM_ID),
  settings: tableSettings.default({}),
});
export type CreateTableInput = z.input<typeof createTableBody>;

// Strict: the system plugin and version are fixed at creation (FR-TABLE-02).
export const updateTableBody = z
  .strictObject({
    name: tableName,
    description: tableDescription,
    settings: tableSettings,
    /** Lets players create actor types meant for the GM (FR-ENT-01). */
    playersMayCreateAnyActorType: z.boolean(),
  })
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdateTableInput = z.input<typeof updateTableBody>;

// Members and invites (FR-TABLE-03..06)

export const updateMemberBody = z
  .strictObject({
    role: z.enum(TABLE_ROLES),
    /** Validated against the table's actors once they exist (M2). */
    defaultCharacterId: z.uuid().nullable(),
  })
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdateMemberInput = z.input<typeof updateMemberBody>;

const DAY_SECONDS = 24 * 60 * 60;

export const createInviteBody = z.object({
  role: z.enum(INVITE_ROLES),
  /** Lifetime in seconds; `null` never expires. Default: 7 days. */
  expiresInSeconds: z
    .number()
    .int()
    .min(60)
    .max(90 * DAY_SECONDS)
    .nullable()
    .default(7 * DAY_SECONDS),
});
export type CreateInviteInput = z.input<typeof createInviteBody>;

// Actors and items (FR-ENT-01..06). Plugin data (`system`) is not written over REST: it is
// edited live on the sheet (M5).

const entityName = z.string().trim().min(1).max(MAX_ENTITY_NAME);
const entityType = z.string().min(1).max(MAX_ENTITY_TYPE);
const imageUrl = imageUrlSchema.nullable();

export const ownershipSchema = z.object({
  default: z.enum(OWNERSHIP_LEVELS),
  /** Per-user levels, keyed by user id; they override the default (FR-ENT-02). */
  users: z.record(z.uuid(), z.enum(OWNERSHIP_LEVELS)),
});

/** `GET /tables/:id/actors` and `/items`. */
/**
 * A page of a list (§10.1, ADR-057): up to `limit` entries after `cursor`, the `nextCursor`
 * of the page before. Without `limit`, the whole list.
 */
const listPage = {
  limit: z.coerce.number().int().min(1).max(MAX_LIST_PAGE).optional(),
  cursor: z.string().max(512).optional(),
};

export const entityListQuery = z.object({
  /** Case-insensitive substring of the name. */
  search: z.string().trim().max(MAX_SEARCH).optional(),
  type: entityType.optional(),
  /** `restorable`: the trash, within the retention window (FR-ENT-04). */
  trash: z.enum(['live', 'restorable']).default('live'),
  ...listPage,
});
export type EntityListQuery = z.input<typeof entityListQuery>;

export const createActorBody = z.object({
  type: entityType,
  name: entityName,
  imageUrl: imageUrl.default(null),
  /** GMs and assistants only; players' actors are owned by their creator. */
  ownership: ownershipSchema.optional(),
});
export type CreateActorInput = z.input<typeof createActorBody>;

export const updateActorBody = z
  .strictObject({
    name: entityName,
    imageUrl,
    /** GMs and assistants only. */
    ownership: ownershipSchema,
  })
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdateActorInput = z.input<typeof updateActorBody>;

export const createItemBody = z.object({
  type: entityType,
  name: entityName,
  imageUrl: imageUrl.default(null),
});
export type CreateItemInput = z.input<typeof createItemBody>;

export const updateItemBody = z
  .strictObject({ name: entityName, imageUrl })
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdateItemInput = z.input<typeof updateItemBody>;

/** `POST /actors/:id/items`: copies a library item into the actor (FR-ENT-05). */
export const copyItemBody = z.object({ itemId: z.uuid() });
export type CopyItemInput = z.input<typeof copyItemBody>;

// Journal entries (FR-JOURNAL-01..03). The body is a collaborative document, not REST data.

const journalTitle = z.string().trim().min(1).max(MAX_ENTITY_NAME);

/** `GET /tables/:id/journal`. */
export const journalListQuery = z.object({
  /** Case-insensitive substring of the title. */
  search: z.string().trim().max(MAX_SEARCH).optional(),
  /** `restorable`: the trash, within the retention window. */
  trash: z.enum(['live', 'restorable']).default('live'),
  ...listPage,
});
export type JournalListQuery = z.input<typeof journalListQuery>;

export const createJournalBody = z.object({
  title: journalTitle,
  /** Players observe entries by default (FR-JOURNAL-02). */
  ownership: ownershipSchema.optional(),
  /** New entries stay with the GM until revealed (FR-JOURNAL-03, ADR-038). */
  hidden: z.boolean().default(true),
});
export type CreateJournalInput = z.input<typeof createJournalBody>;

export const updateJournalBody = z
  .strictObject({
    title: journalTitle,
    /** GMs and assistants only. */
    ownership: ownershipSchema,
    /** GMs and assistants only. */
    hidden: z.boolean(),
  })
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdateJournalInput = z.input<typeof updateJournalBody>;

// Instance settings (FR-ADMIN-01) and sign-up through an invite link.

/** `closed`: only admins create accounts. `invite`: a table invite link also lets people sign up. */
export const REGISTRATION_POLICIES = ['closed', 'invite'] as const;
export type RegistrationPolicy = (typeof REGISTRATION_POLICIES)[number];

export const MIN_SESSION_LIFETIME_SECONDS = 60 * 60;
export const MAX_SESSION_LIFETIME_SECONDS = 90 * DAY_SECONDS;

export const instanceSettingsSchema = z.object({
  siteName: z.string().trim().min(1).max(MAX_SITE_NAME),
  registration: z.enum(REGISTRATION_POLICIES),
  /** How long a new session lasts; sessions already issued keep their expiry. */
  sessionLifetimeSeconds: z
    .int()
    .min(MIN_SESSION_LIFETIME_SECONDS)
    .max(MAX_SESSION_LIFETIME_SECONDS),
  /** The largest file an upload may be (ADR-064). */
  maxUploadBytes: z.int().min(MIN_UPLOAD_BYTES).max(MAX_UPLOAD_BYTES),
  /** All assets of the instance together; uploads past it are refused. */
  assetQuotaBytes: z.int().min(MIN_ASSET_QUOTA_BYTES).max(MAX_ASSET_QUOTA_BYTES),
});
export type InstanceSettings = z.infer<typeof instanceSettingsSchema>;

export const updateInstanceSettingsBody = instanceSettingsSchema
  .strict()
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdateInstanceSettingsInput = z.input<typeof updateInstanceSettingsBody>;

/** `POST /invites/:token/signup`: a new account that joins the invite's table. */
export const signupBody = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: newPasswordSchema,
});
export type SignupInput = z.input<typeof signupBody>;
