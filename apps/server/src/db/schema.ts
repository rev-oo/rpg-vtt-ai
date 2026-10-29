// Drizzle schema for the core server (specs T-0102). Timestamps are Unix milliseconds.
import { sql } from 'drizzle-orm';
import {
  blob,
  index,
  type AnySQLiteColumn,
  integer,
  primaryKey,
  real,
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
import {
  ASSET_TYPES,
  MESSAGE_KINDS,
  PLUGIN_STATUSES,
  type PluginIssueView,
  type RecipeCard,
  type Roll,
  type Speaker,
} from '@vtt/shared/api';

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
 * Installed plugins, one row per folder in `DATA_DIR/plugins` (T-0403). The scanner writes
 * every column except `enabled`, which only admins change. Tables reference a plugin by id.
 */
export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  description: text('description'),
  coreApi: text('core_api').notNull().default(''),
  hasCode: integer('has_code', { mode: 'boolean' }).notNull().default(false),
  /** Files under `code/` (§8.10). */
  codeEntries: text('code_entries', { mode: 'json' }).$type<string[]>().notNull().default([]),
  status: text('status', { enum: PLUGIN_STATUSES }).notNull().default('ready'),
  /** The validator's issues from the last scan (ADR-019). */
  issues: text('issues', { mode: 'json' }).$type<PluginIssueView[]>().notNull().default([]),
  scannedAt: timestamp('scanned_at'),
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
    /** Set while the table is archived: read-only for everyone (FR-TABLE-06, ADR-054). */
    archivedAt: timestamp('archived_at'),
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
    /** The pack entry it was imported from, `<plugin>:<pack>:<entry>` (ADR-051). */
    packRef: text('pack_ref'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    softDeletedAt: softDeletedAt(),
  },
  (t) => [
    index('actors_table_id_idx').on(t.tableId, t.softDeletedAt),
    index('actors_pack_ref_idx').on(t.tableId, t.packRef),
  ],
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
    /** The pack entry it was imported from, `<plugin>:<pack>:<entry>` (ADR-051). */
    packRef: text('pack_ref'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    softDeletedAt: softDeletedAt(),
  },
  (t) => [
    index('items_table_id_idx').on(t.tableId, t.softDeletedAt),
    index('items_actor_id_idx').on(t.actorId),
    index('items_pack_ref_idx').on(t.tableId, t.packRef),
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

/**
 * A table's encounter (FR-COMBAT-01, ADR-049). A table has at most one; ending it deletes it.
 * `round` is 0 until it starts; `currentId` is the combatant whose turn it is.
 */
export const encounters = sqliteTable('encounters', {
  id: text('id').primaryKey(),
  tableId: text('table_id')
    .notNull()
    .unique()
    .references(() => gameTables.id, { onDelete: 'cascade' }),
  round: integer('round').notNull().default(0),
  currentId: text('current_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * One side of an encounter: an actor of the table, or a free-form entry without one
 * (FR-COMBAT-01). Hidden combatants reach only GMs and assistants (FR-COMBAT-04).
 */
export const combatants = sqliteTable(
  'combatants',
  {
    id: text('id').primaryKey(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => actors.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    initiative: real('initiative'),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    /** Adding order, which breaks ties. */
    sort: integer('sort').notNull(),
    /** Place in the turn order, set after every change (ADR-050); `null` until then. */
    position: integer('position'),
    createdAt: createdAt(),
  },
  (t) => [index('combatants_encounter_id_idx').on(t.encounterId)],
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
    /** What a recipe roll resolved, on `card` messages (FR-CHAT-06, ADR-025). */
    card: text('card', { mode: 'json' }).$type<RecipeCard>(),
    createdAt: createdAt(),
    /** Set when the author edits the text (FR-CHAT-09). */
    editedAt: timestamp('edited_at'),
  },
  (t) => [index('chat_messages_history_idx').on(t.tableId, t.seq)],
);

/**
 * Binary Yjs state of the collaborative documents (specs §9.1, §9.6), keyed by document name.
 * Each row belongs to its actor or journal entry and goes with it when it is purged.
 */
/**
 * Sheet history (FR-SHEET-11, ADR-053): copies of an actor document's data without its edit
 * history, taken on store at most every few minutes; the newest 50 per document are kept.
 */
export const actorSnapshots = sqliteTable(
  'actor_snapshots',
  {
    /** Taking order; several snapshots can share a millisecond. */
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    /** Which document: secret snapshots are GM-only, as the secret document is (§9.3). */
    layer: text('layer', { enum: ['main', 'secret'] }).notNull(),
    /** A Yjs update holding the `data` map alone. */
    state: blob('state', { mode: 'buffer' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('actor_snapshots_actor_idx').on(t.actorId, t.layer, t.seq)],
);

export const ydocs = sqliteTable(
  'ydocs',
  {
    name: text('name').primaryKey(),
    actorId: text('actor_id').references(() => actors.id, { onDelete: 'cascade' }),
    /** An item's documents (ADR-062). */
    itemId: text('item_id').references(() => items.id, { onDelete: 'cascade' }),
    journalEntryId: text('journal_entry_id').references(() => journalEntries.id, {
      onDelete: 'cascade',
    }),
    state: blob('state', { mode: 'buffer' }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ydocs_actor_id_idx').on(t.actorId),
    index('ydocs_item_id_idx').on(t.itemId),
    index('ydocs_journal_entry_id_idx').on(t.journalEntryId),
  ],
);

/**
 * Images uploaded to a table (ADR-064). The file is `DATA_DIR/assets/<table id>/<id>`; its
 * type was told from its bytes, so the row, not a file name, says what it is.
 */
export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    tableId: text('table_id')
      .notNull()
      .references(() => gameTables.id, { onDelete: 'cascade' }),
    uploaderId: text('uploader_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    type: text('type', { enum: ASSET_TYPES }).notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('assets_table_idx').on(t.tableId, t.createdAt)],
);
