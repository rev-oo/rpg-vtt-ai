import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Db } from '../src/db/client.js';
import {
  createActor,
  createItem,
  createJournalEntry,
  findActor,
  findItem,
  findJournalEntry,
  listActors,
  listItems,
  listJournalEntries,
  purgeDeletedEntities,
  restoreActor,
  restoreItem,
  restoreJournalEntry,
  softDeleteActor,
  softDeleteItem,
  softDeleteJournalEntry,
  updateActor,
  updateItem,
  updateJournalEntry,
  type Retention,
} from '../src/db/repositories/index.js';
import { gameTables, items } from '../src/db/schema.js';
import { generateId } from '../src/domain/auth/tokens.js';

import { createTestDb } from './support/db.js';
import { insertPlugin, insertUser } from './support/fixtures.js';

const DAY = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY;
const T0 = new Date('2026-10-20T12:00:00.000Z');
const at = (days: number): Retention => ({
  now: new Date(T0.getTime() + days * DAY),
  retentionMs: RETENTION_MS,
});

function setup() {
  const db = createTestDb();
  insertPlugin(db);
  const user = insertUser(db);
  const table = (name: string) =>
    db
      .insert(gameTables)
      .values({ id: generateId(), name, systemId: 'test-system', systemVersion: '1.2.0' })
      .returning()
      .get();
  return { db, user, table: table('Main'), other: table('Other') };
}

const actor = (db: Db, tableId: string, name: string, type = 'character') =>
  createActor(db, { tableId, type, name, dataVersion: '1.2.0' }, T0);

describe('actors', () => {
  it('creates an actor with defaults', () => {
    const { db, table, user } = setup();
    const created = createActor(
      db,
      { tableId: table.id, type: 'npc', name: 'Goblin', dataVersion: '1.2.0', createdBy: user.id },
      T0,
    );
    expect(created).toMatchObject({
      tableId: table.id,
      type: 'npc',
      name: 'Goblin',
      imageUrl: null,
      ownership: { default: 'none', users: {} },
      system: {},
      createdBy: user.id,
      createdAt: T0,
      updatedAt: T0,
      softDeletedAt: null,
    });
    expect(findActor(db, created.id)).toEqual(created);
  });

  it('lists by table, ordered by name, with search and type filters (FR-ENT-04)', () => {
    const { db, table, other } = setup();
    actor(db, table.id, 'zed');
    actor(db, table.id, 'Alice');
    actor(db, table.id, 'Goblin 100%_', 'npc');
    actor(db, other.id, 'Elsewhere');

    const names = (filter: Parameters<typeof listActors>[2]) =>
      listActors(db, table.id, filter, at(0)).map((a) => a.name);

    expect(names({})).toEqual(['Alice', 'Goblin 100%_', 'zed']);
    expect(names({ type: 'npc' })).toEqual(['Goblin 100%_']);
    expect(names({ search: 'ALI' })).toEqual(['Alice']);
    // Search is literal: no LIKE wildcards.
    expect(names({ search: '%_' })).toEqual(['Goblin 100%_']);
    expect(names({ search: 'e', type: 'character' })).toEqual(['Alice', 'zed']);
  });

  it('updates live actors only', () => {
    const { db, table } = setup();
    const a = actor(db, table.id, 'Alice');
    const later = at(1).now;

    const updated = updateActor(
      db,
      a.id,
      {
        name: 'Alicia',
        ownership: { default: 'observer', users: { u1: 'owner' } },
        system: { hp: 3 },
      },
      later,
    );
    expect(updated).toMatchObject({ name: 'Alicia', system: { hp: 3 }, updatedAt: later });
    expect(updated?.ownership.users).toEqual({ u1: 'owner' });

    softDeleteActor(db, a.id, later);
    expect(updateActor(db, a.id, { name: 'Ghost' }, later)).toBeUndefined();
  });

  it('soft-deletes into the trash and restores within the retention window', () => {
    const { db, table } = setup();
    const a = actor(db, table.id, 'Alice');
    actor(db, table.id, 'Bob');

    expect(softDeleteActor(db, a.id, T0)).toBe(true);
    expect(softDeleteActor(db, a.id, T0)).toBe(false);
    expect(findActor(db, a.id)).toBeUndefined();
    expect(listActors(db, table.id, {}, at(0)).map((x) => x.name)).toEqual(['Bob']);
    expect(listActors(db, table.id, { trash: 'restorable' }, at(29)).map((x) => x.name)).toEqual([
      'Alice',
    ]);

    expect(restoreActor(db, a.id, at(29))).toBe('restored');
    expect(findActor(db, a.id)).toMatchObject({ softDeletedAt: null, updatedAt: at(29).now });
    expect(restoreActor(db, a.id, at(29))).toBe('not_deleted');
  });

  it('refuses to restore once the window has closed, and purges', () => {
    const { db, table } = setup();
    const a = actor(db, table.id, 'Alice');
    softDeleteActor(db, a.id, T0);

    expect(listActors(db, table.id, { trash: 'restorable' }, at(30))).toEqual([]);
    expect(restoreActor(db, a.id, at(30))).toBe('expired');
    expect(restoreActor(db, generateId(), at(0))).toBe('not_found');

    expect(purgeDeletedEntities(db, at(29.9)).actors).toBe(0);
    expect(purgeDeletedEntities(db, at(30)).actors).toBe(1);
    expect(restoreActor(db, a.id, at(30))).toBe('not_found');
  });

  it('is removed with its table', () => {
    const { db, table } = setup();
    const a = actor(db, table.id, 'Alice');
    db.delete(gameTables).where(eq(gameTables.id, table.id)).run();
    expect(findActor(db, a.id)).toBeUndefined();
  });
});

describe('items', () => {
  const item = (
    db: Db,
    tableId: string,
    name: string,
    extra: { actorId?: string; type?: string } = {},
  ) =>
    createItem(
      db,
      { tableId, type: extra.type ?? 'weapon', name, dataVersion: '1.2.0', ...extra },
      T0,
    );

  it('separates the library from owned items (FR-ENT-05)', () => {
    const { db, table } = setup();
    const owner = actor(db, table.id, 'Alice');
    const sword = item(db, table.id, 'Sword');
    item(db, table.id, 'Potion', { type: 'consumable' });
    const copy = createItem(
      db,
      {
        tableId: table.id,
        actorId: owner.id,
        sourceId: sword.id,
        type: 'weapon',
        name: 'Sword',
        dataVersion: '1.2.0',
      },
      T0,
    );

    const names = (filter: Parameters<typeof listItems>[2]) =>
      listItems(db, table.id, filter, at(0)).map((i) => i.name);
    expect(names({ actorId: null })).toEqual(['Potion', 'Sword']);
    expect(names({ actorId: null, type: 'consumable' })).toEqual(['Potion']);
    expect(names({ actorId: null, search: 'sw' })).toEqual(['Sword']);
    expect(listItems(db, table.id, { actorId: owner.id }, at(0))).toEqual([copy]);
    expect(copy).toMatchObject({ actorId: owner.id, sourceId: sword.id });
  });

  it('keeps a copy when its source is purged, and drops owned items with their actor', () => {
    const { db, table } = setup();
    const owner = actor(db, table.id, 'Alice');
    const sword = item(db, table.id, 'Sword');
    const copy = item(db, table.id, 'Sword', { actorId: owner.id });
    db.update(items).set({ sourceId: sword.id }).where(eq(items.id, copy.id)).run();

    softDeleteItem(db, sword.id, T0);
    softDeleteActor(db, owner.id, T0);
    expect(purgeDeletedEntities(db, at(31))).toEqual({ items: 1, actors: 1, journalEntries: 0 });
    expect(db.select().from(items).all()).toEqual([]);
  });

  it('updates, soft-deletes and restores', () => {
    const { db, table } = setup();
    const sword = item(db, table.id, 'Sword');

    expect(
      updateItem(db, sword.id, { name: 'Long sword', system: { damage: '1d8' } }, at(1).now),
    ).toMatchObject({
      name: 'Long sword',
      system: { damage: '1d8' },
    });
    expect(softDeleteItem(db, sword.id, T0)).toBe(true);
    expect(softDeleteItem(db, sword.id, T0)).toBe(false);
    expect(findItem(db, sword.id)).toBeUndefined();
    expect(updateItem(db, sword.id, { name: 'x' }, T0)).toBeUndefined();
    expect(listItems(db, table.id, { actorId: null, trash: 'restorable' }, at(1))).toHaveLength(1);
    expect(restoreItem(db, sword.id, at(31))).toBe('expired');
    expect(restoreItem(db, sword.id, at(1))).toBe('restored');
    expect(restoreItem(db, sword.id, at(1))).toBe('not_deleted');
    expect(restoreItem(db, generateId(), at(1))).toBe('not_found');
  });
});

describe('journal entries', () => {
  it('defaults to observer for players and filters hidden entries (FR-JOURNAL-02, 03)', () => {
    const { db, table } = setup();
    const lore = createJournalEntry(db, { tableId: table.id, title: 'Lore' }, T0);
    createJournalEntry(db, { tableId: table.id, title: 'Ambush plan', hidden: true }, T0);

    expect(lore.ownership).toEqual({ default: 'observer', users: {} });
    const titles = (filter: Parameters<typeof listJournalEntries>[2]) =>
      listJournalEntries(db, table.id, filter, at(0)).map((e) => e.title);
    expect(titles({})).toEqual(['Ambush plan', 'Lore']);
    expect(titles({ includeHidden: false })).toEqual(['Lore']);
    expect(titles({ search: 'AMB' })).toEqual(['Ambush plan']);
  });

  it('updates, soft-deletes, restores and purges', () => {
    const { db, table } = setup();
    const entry = createJournalEntry(db, { tableId: table.id, title: 'Lore', hidden: true }, T0);

    expect(updateJournalEntry(db, entry.id, { hidden: false }, at(1).now)?.hidden).toBe(false);
    expect(softDeleteJournalEntry(db, entry.id, T0)).toBe(true);
    expect(softDeleteJournalEntry(db, entry.id, T0)).toBe(false);
    expect(findJournalEntry(db, entry.id)).toBeUndefined();
    expect(updateJournalEntry(db, entry.id, { title: 'x' }, T0)).toBeUndefined();
    expect(listJournalEntries(db, table.id, { trash: 'restorable' }, at(1))).toHaveLength(1);
    expect(restoreJournalEntry(db, entry.id, at(1))).toBe('restored');
    expect(restoreJournalEntry(db, entry.id, at(1))).toBe('not_deleted');
    expect(restoreJournalEntry(db, generateId(), at(1))).toBe('not_found');

    softDeleteJournalEntry(db, entry.id, T0);
    expect(restoreJournalEntry(db, entry.id, at(30))).toBe('expired');
    expect(purgeDeletedEntities(db, at(30)).journalEntries).toBe(1);
  });
});
