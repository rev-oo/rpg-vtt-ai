// Drizzle schema for the core server (specs T-0102). Timestamps are Unix milliseconds.
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { INVITE_ROLES, TABLE_ROLES } from '@vtt/shared';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () =>
  timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date());

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Login name as entered; uniqueness is case-insensitive. */
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** Instance admin (FR-AUTH-08): distinct from any table's GM role. */
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    /** Set for admin-generated one-time passwords (FR-AUTH-02). */
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    disabledAt: timestamp('disabled_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_username_unique').on(sql`lower(${t.username})`)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only ever lives in the cookie. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** Instance-wide settings (FR-ADMIN-01) as JSON values keyed by name. */
export const instanceSettings = sqliteTable('instance_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

/**
 * Installed plugins. Rows are written by the plugin scanner (T-0403); until then tests
 * insert them directly. Tables reference a plugin by id.
 */
export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  hasCode: integer('has_code', { mode: 'boolean' }).notNull().default(false),
  updatedAt: timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

export const gameTables = sqliteTable(
  'game_tables',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** System plugin and version, fixed at creation (FR-TABLE-02). */
    systemId: text('system_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'restrict' }),
    systemVersion: text('system_version').notNull(),
    settings: text('settings', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('game_tables_system_id_idx').on(t.systemId)],
);

export const members = sqliteTable(
  'members',
  {
    tableId: text('table_id')
      .notNull()
      .references(() => gameTables.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: TABLE_ROLES }).notNull(),
    /** Default character for this table (FR-TABLE-05); actors arrive in M2, so no FK yet. */
    defaultCharacterId: text('default_character_id'),
    joinedAt: timestamp('joined_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.tableId, t.userId] }),
    index('members_user_id_idx').on(t.userId),
  ],
);

export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => gameTables.id, { onDelete: 'cascade' }),
    /** SHA-256 of the invite token; the raw token only appears in the link. */
    tokenHash: text('token_hash').notNull().unique(),
    role: text('role', { enum: INVITE_ROLES }).notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [index('invites_table_id_idx').on(t.tableId)],
);
