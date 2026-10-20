import { z } from 'zod';

import { INVITE_ROLES, TABLE_ROLES } from '../roles.js';

import {
  MAX_DISPLAY_NAME,
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
  .strictObject({ name: tableName, description: tableDescription, settings: tableSettings })
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);

// Members and invites (FR-TABLE-03..06)

export const updateMemberBody = z
  .strictObject({
    role: z.enum(TABLE_ROLES),
    /** Validated against the table's actors once they exist (M2). */
    defaultCharacterId: z.uuid().nullable(),
  })
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);

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
