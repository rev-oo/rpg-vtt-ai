import { describe, expect, it } from 'vitest';

import type { ActorView, ItemView } from '@vtt/shared/api';

import { buildApp } from '../src/http/app.js';
import { createLogger } from '../src/logger/index.js';

import type { Client } from './support/app.js';
import { setupTable, type TableSetup } from './support/table.js';

const UNKNOWN_ID = '11111111-1111-4111-8111-111111111111';

async function createActor(
  t: TableSetup,
  client: Client,
  payload: Record<string, unknown>,
): Promise<ActorView> {
  const res = await t.call(client, 'POST', `/tables/${t.table.id}/actors`, {
    type: 'character',
    name: 'Hero',
    ...payload,
  });
  if (res.statusCode !== 201) throw new Error(`create actor failed: ${res.body}`);
  return res.json<{ actor: ActorView }>().actor;
}

async function listNames(t: TableSetup, client: Client, query = ''): Promise<string[]> {
  const res = await t.call(client, 'GET', `/tables/${t.table.id}/actors${query}`);
  expect(res.statusCode).toBe(200);
  return res.json<{ actors: ActorView[] }>().actors.map((a) => a.name);
}

/** Bob's private character, a public NPC and Carol's character that everyone observes. */
async function cast(t: TableSetup) {
  const bobs = await createActor(t, t.bob.client, { name: 'Bob the Brave' });
  const npc = await createActor(t, t.gm.client, {
    type: 'npc',
    name: 'Goblin',
    ownership: { default: 'observer', users: {} },
  });
  const carols = await createActor(t, t.carol.client, { name: 'Carol the Clever' });
  await t.call(t.gm.client, 'PATCH', `/actors/${carols.id}`, {
    ownership: { default: 'observer', users: { [t.carol.userId]: 'owner' } },
  });
  return { bobs, npc, carols };
}

describe('creating actors (FR-ENT-01, 02)', () => {
  it("makes a player's actor theirs alone, stamped with the table's system version", async () => {
    const t = await setupTable();
    const actor = await createActor(t, t.bob.client, {
      name: 'Bob the Brave',
      imageUrl: 'https://img.example.com/bob.png',
    });
    expect(actor).toMatchObject({
      tableId: t.table.id,
      type: 'character',
      name: 'Bob the Brave',
      imageUrl: 'https://img.example.com/bob.png',
      ownership: { default: 'none', users: { [t.bob.userId]: 'owner' } },
      system: {},
      dataVersion: '1.2.0',
      deletedAt: null,
      access: 'owner',
    });
  });

  it('lets the GM create any type with any ownership', async () => {
    const t = await setupTable();
    const npc = await createActor(t, t.gm.client, {
      type: 'npc',
      name: 'Goblin',
      ownership: { default: 'observer', users: { [t.bob.userId]: 'owner' } },
    });
    expect(npc.ownership).toEqual({ default: 'observer', users: { [t.bob.userId]: 'owner' } });
    // Without an explicit ownership, a GM's actor is hidden from players.
    const secret = await createActor(t, t.gm.client, { type: 'npc', name: 'Lich' });
    expect(secret.ownership).toEqual({ default: 'none', users: {} });
  });

  it('keeps players to player types unless the GM allows any', async () => {
    const t = await setupTable();
    const npc = { type: 'npc', name: 'Goblin' };
    const url = `/tables/${t.table.id}/actors`;
    expect((await t.call(t.bob.client, 'POST', url, npc)).statusCode).toBe(403);

    const patch = await t.call(t.bob.client, 'PATCH', `/tables/${t.table.id}`, {
      playersMayCreateAnyActorType: true,
    });
    expect(patch.statusCode).toBe(403);
    const allowed = await t.call(t.gm.client, 'PATCH', `/tables/${t.table.id}`, {
      playersMayCreateAnyActorType: true,
    });
    expect(allowed.json()).toMatchObject({ table: { playersMayCreateAnyActorType: true } });
    expect((await t.call(t.bob.client, 'POST', url, npc)).statusCode).toBe(201);
  });

  it('rejects spectators, non-members, player-set ownership and unknown types', async () => {
    const t = await setupTable();
    const url = `/tables/${t.table.id}/actors`;
    const hero = { type: 'character', name: 'Hero' };
    expect((await t.call(t.dave.client, 'POST', url, hero)).statusCode).toBe(403);
    expect((await t.call(t.eve.client, 'POST', url, hero)).statusCode).toBe(404);

    const withOwnership = await t.call(t.bob.client, 'POST', url, {
      ...hero,
      ownership: { default: 'owner', users: {} },
    });
    expect(withOwnership.statusCode).toBe(403);

    const unknown = await t.call(t.gm.client, 'POST', url, { type: 'dragon', name: 'Smaug' });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({ error: { code: 'unknown_actor_type' } });
    // Inherited object keys are not types.
    const proto = await t.call(t.gm.client, 'POST', url, { type: 'toString', name: 'x' });
    expect(proto.statusCode).toBe(422);

    const badUrl = await t.call(t.gm.client, 'POST', url, { ...hero, imageUrl: 'javascript:x' });
    expect(badUrl.statusCode).toBe(400);
  });
});

describe('listing and reading actors (FR-ENT-03, 04)', () => {
  it('shows each member only the actors they may see', async () => {
    const t = await setupTable();
    await cast(t);

    expect(await listNames(t, t.gm.client)).toEqual([
      'Bob the Brave',
      'Carol the Clever',
      'Goblin',
    ]);
    expect(await listNames(t, t.bob.client)).toEqual([
      'Bob the Brave',
      'Carol the Clever',
      'Goblin',
    ]);
    expect(await listNames(t, t.carol.client)).toEqual(['Carol the Clever', 'Goblin']);
    expect(await listNames(t, t.dave.client)).toEqual(['Carol the Clever', 'Goblin']);
    expect((await t.call(t.eve.client, 'GET', `/tables/${t.table.id}/actors`)).statusCode).toBe(
      404,
    );
  });

  it('filters by search and type', async () => {
    const t = await setupTable();
    await cast(t);
    expect(await listNames(t, t.gm.client, '?type=npc')).toEqual(['Goblin']);
    expect(await listNames(t, t.gm.client, '?search=the%20c')).toEqual(['Carol the Clever']);
    expect(
      (await t.call(t.gm.client, 'GET', `/tables/${t.table.id}/actors?trash=all`)).statusCode,
    ).toBe(400);
  });

  it('reports the access level and hides actors from those who may not see them', async () => {
    const t = await setupTable();
    const { bobs, carols } = await cast(t);
    const get = (client: Client, id: string) => t.call(client, 'GET', `/actors/${id}`);

    expect((await get(t.bob.client, carols.id)).json()).toMatchObject({
      actor: { access: 'observer' },
    });
    expect((await get(t.carol.client, carols.id)).json()).toMatchObject({
      actor: { access: 'owner' },
    });
    expect((await get(t.gm.client, bobs.id)).json()).toMatchObject({ actor: { access: 'owner' } });
    // A spectator never edits, even an actor they were given (FR-ENT-03, §2).
    expect((await get(t.dave.client, carols.id)).json()).toMatchObject({
      actor: { access: 'observer' },
    });

    expect((await get(t.carol.client, bobs.id)).statusCode).toBe(404);
    expect((await get(t.eve.client, carols.id)).statusCode).toBe(404);
    expect((await get(t.gm.client, UNKNOWN_ID)).statusCode).toBe(404);
    expect((await get(t.gm.client, 'not-a-uuid')).statusCode).toBe(400);
  });
});

describe('updating actors', () => {
  it('lets owners rename and the GM change ownership', async () => {
    const t = await setupTable();
    const { bobs } = await cast(t);
    const patch = (client: Client, payload: Record<string, unknown>) =>
      t.call(client, 'PATCH', `/actors/${bobs.id}`, payload);

    expect((await patch(t.bob.client, { name: 'Bob the Bold' })).json()).toMatchObject({
      actor: { name: 'Bob the Bold', access: 'owner' },
    });
    expect(
      (await patch(t.bob.client, { ownership: { default: 'owner', users: {} } })).statusCode,
    ).toBe(403);
    expect((await patch(t.carol.client, { name: 'Mine now' })).statusCode).toBe(404);

    const shared = await patch(t.gm.client, {
      ownership: { default: 'observer', users: { [t.bob.userId]: 'owner' } },
    });
    expect(shared.statusCode).toBe(200);
    expect(await listNames(t, t.carol.client)).toContain('Bob the Bold');
    // Carol can now read it, but still not edit it.
    expect((await patch(t.carol.client, { name: 'Mine now' })).statusCode).toBe(403);
    expect((await patch(t.bob.client, {})).statusCode).toBe(400);
  });
});

describe('trash (FR-ENT-04)', () => {
  it('soft-deletes, lists the trash for those who may restore, and restores', async () => {
    const t = await setupTable();
    const { bobs, carols } = await cast(t);

    expect((await t.call(t.bob.client, 'DELETE', `/actors/${carols.id}`)).statusCode).toBe(403);
    expect((await t.call(t.carol.client, 'DELETE', `/actors/${bobs.id}`)).statusCode).toBe(404);
    expect((await t.call(t.bob.client, 'DELETE', `/actors/${bobs.id}`)).statusCode).toBe(204);

    expect(await listNames(t, t.bob.client)).toEqual(['Carol the Clever', 'Goblin']);
    expect((await t.call(t.bob.client, 'GET', `/actors/${bobs.id}`)).statusCode).toBe(404);
    expect(await listNames(t, t.bob.client, '?trash=restorable')).toEqual(['Bob the Brave']);
    expect(await listNames(t, t.gm.client, '?trash=restorable')).toEqual(['Bob the Brave']);
    expect(await listNames(t, t.carol.client, '?trash=restorable')).toEqual([]);

    expect((await t.call(t.carol.client, 'POST', `/actors/${bobs.id}/restore`)).statusCode).toBe(
      404,
    );
    t.advanceDays(29);
    const restored = await t.call(t.bob.client, 'POST', `/actors/${bobs.id}/restore`);
    expect(restored.json()).toMatchObject({ actor: { id: bobs.id, deletedAt: null } });

    const again = await t.call(t.bob.client, 'POST', `/actors/${bobs.id}/restore`);
    expect(again.statusCode).toBe(409);
  });

  it('refuses to restore after the retention window', async () => {
    const t = await setupTable();
    const { bobs } = await cast(t);
    await t.call(t.bob.client, 'DELETE', `/actors/${bobs.id}`);
    t.advanceDays(30);

    const res = await t.call(t.bob.client, 'POST', `/actors/${bobs.id}/restore`);
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: { code: 'restore_expired' } });
    expect(await listNames(t, t.bob.client, '?trash=restorable')).toEqual([]);
  });

  it('purges expired trash when the server starts', async () => {
    const t = await setupTable();
    const { bobs } = await cast(t);
    await t.call(t.bob.client, 'DELETE', `/actors/${bobs.id}`);
    t.advanceDays(31);
    // A fresh app on the same database runs the purge on startup.
    const restarted = await buildApp({
      logger: createLogger('silent'),
      db: t.db,
      config: t.config,
      now: () => new Date('2026-04-15T00:00:00Z'),
    });
    await restarted.ready();
    const res = await t.call(t.gm.client, 'POST', `/actors/${bobs.id}/restore`);
    expect(res.statusCode).toBe(404);
    await restarted.close();
  });
});

describe('duplicating actors (FR-ENT-04)', () => {
  it('copies an actor with its items, owned by a player who duplicates it', async () => {
    const t = await setupTable();
    const { carols } = await cast(t);
    const sword = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/items`, {
      type: 'weapon',
      name: 'Sword',
    });
    const swordId = sword.json<{ item: ItemView }>().item.id;
    await t.call(t.carol.client, 'POST', `/actors/${carols.id}/items`, { itemId: swordId });

    const dup = await t.call(t.bob.client, 'POST', `/actors/${carols.id}/duplicate`);
    expect(dup.statusCode).toBe(201);
    const copy = dup.json<{ actor: ActorView }>().actor;
    expect(copy).toMatchObject({
      name: 'Carol the Clever (copy)',
      ownership: { default: 'none', users: { [t.bob.userId]: 'owner' } },
      access: 'owner',
    });
    const items = await t.call(t.bob.client, 'GET', `/actors/${copy.id}/items`);
    expect(items.json<{ items: ItemView[] }>().items).toMatchObject([
      { name: 'Sword', actorId: copy.id, sourceId: swordId },
    ]);
  });

  it('keeps ownership when the GM duplicates, and checks the type and visibility', async () => {
    const t = await setupTable();
    const { bobs, npc } = await cast(t);

    const gmCopy = await t.call(t.gm.client, 'POST', `/actors/${npc.id}/duplicate`);
    expect(gmCopy.json()).toMatchObject({
      actor: { name: 'Goblin (copy)', ownership: npc.ownership },
    });
    // Players may not create GM types, so they may not copy them either.
    expect((await t.call(t.bob.client, 'POST', `/actors/${npc.id}/duplicate`)).statusCode).toBe(
      403,
    );
    expect((await t.call(t.carol.client, 'POST', `/actors/${bobs.id}/duplicate`)).statusCode).toBe(
      404,
    );
  });
});

describe('system types (§8.4)', () => {
  it('lists the actor and item types to every member', async () => {
    const t = await setupTable();
    const res = await t.call(t.dave.client, 'GET', `/tables/${t.table.id}/types`);
    expect(res.json()).toEqual({
      actorTypes: [
        { type: 'character', controlledBy: 'player' },
        { type: 'npc', controlledBy: 'gm' },
      ],
      itemTypes: ['weapon', 'consumable'],
    });
    expect((await t.call(t.eve.client, 'GET', `/tables/${t.table.id}/types`)).statusCode).toBe(404);
  });
});
