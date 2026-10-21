// Drizzle schema for the core server (specs T-0102). Timestamps are Unix milliseconds.
import { sql } from 'drizzle-orm';
import {
  index,
  type AnySQLiteColumn,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import {
  AUDIENCES,
  INVITE_ROLES,
  TABLE_ROLES,
  type ControlledBy,
  type Ownership,
} from '@vtt/shared';
import { MESSAGE_KINDS, type Roll, type Speaker } from '@vtt/shared/api';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () =>
  timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date());
/** Set when an entity is in the trash; it can be restored within the retention window (FR-ENT-04). */
const softDeletedAt = () => timestamp('soft_deleted_at');
const ownership = (fallback: Ownership) =>
  text('ownership', { mode: 'json' }).$type<Ownership>().notNull().default(fallback);
/** SQL projection of the entity's plugin data (specs §9.6); the live data is the CRDT doc (M5). */
const systemData = () =>
  text('system', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({});

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
  /** Actor types the plugin declares (§8.4), keyed by type id. */
  actorTypes: text('actor_types', { mode: 'json' })
    .$type<Record<string, { controlledBy: ControlledBy }>>()
    .notNull()
    .default({}),
  /** Item type ids the plugin declares. */
  itemTypes: text('item_types', { mode: 'json' }).$type<string[]>().notNull().default([]),
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
    /** Lets players create actor types meant for the GM (FR-ENT-01). */
    playersMayCreateAnyActorType: integer('players_may_create_any_actor_type', { mode: 'boolean' })
      .notNull()
      .default(false),
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

/** Actors (FR-ENT-01..04). Players see an actor according to its ownership (FR-ENT-03). */
export const actors = sqliteTable(
  'actors',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => gameTables.id, { onDelete: 'cascade' }),
    /** Actor type declared by the table's system plugin (§8.4). */
    type: text('type').notNull(),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
    ownership: ownership({ default: 'none', users: {} }),
    system: systemData(),
    /** Plugin version the data was written with (§9.7). */
    dataVersion: text('data_version').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    softDeletedAt: softDeletedAt(),
  },
  (t) => [index('actors_table_id_idx').on(t.tableId, t.softDeletedAt)],
);

/**
 * Items (FR-ENT-05, 06). Library items have no `actorId`; copying one into an actor creates an
 * owned item with `actorId` and `sourceId` set. Owned items follow their actor's ownership.
 */
export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => gameTables.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => actors.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').references((): AnySQLiteColumn => items.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
    system: systemData(),
    dataVersion: text('data_version').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    softDeletedAt: softDeletedAt(),
  },
  (t) => [
    index('items_table_id_idx').on(t.tableId, t.softDeletedAt),
    index('items_actor_id_idx').on(t.actorId),
  ],
);

/**
 * Journal entry metadata (FR-JOURNAL-01..03); the body is a CRDT doc (M5). Players observe
 * entries by default (FR-JOURNAL-02); hidden entries reach only GMs and assistants (§9.3).
 */
export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => gameTables.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    ownership: ownership({ default: 'observer', users: {} }),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    softDeletedAt: softDeletedAt(),
  },
  (t) => [index('journal_entries_table_id_idx').on(t.tableId, t.softDeletedAt)],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    /** Send order; history pages on it, since several messages can share a millisecond. */
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    tableId: text('table_id')
      .notNull()
      .references(() => gameTables.id, { onDelete: 'cascade' }),
    /** Kept as `null` when the account is deleted; `speaker` keeps the name (FR-AUTH-06). */
    senderId: text('sender_id').references(() => users.id, { onDelete: 'set null' }),
    /** Who spoke, as it was when the message was sent (FR-CHAT-01). */
    speaker: text('speaker', { mode: 'json' }).$type<Speaker>().notNull(),
    audience: text('audience', { enum: AUDIENCES }).notNull(),
    /** Whisper recipients' user ids; empty for other audiences (FR-CHAT-02). */
    recipients: text('recipients', { mode: 'json' }).$type<string[]>().notNull().default([]),
    kind: text('kind', { enum: MESSAGE_KINDS }).notNull(),
    text: text('text').notNull(),
    /** Full die results of roll messages (FR-CHAT-04). */
    rolls: text('rolls', { mode: 'json' }).$type<Roll[]>().notNull().default([]),
    /** Plugin card data (FR-CHAT-06, M3). */
    card: text('card', { mode: 'json' }).$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [index('chat_messages_history_idx').on(t.tableId, t.seq)],
);
