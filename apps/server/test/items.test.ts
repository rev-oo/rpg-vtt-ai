import { describe, expect, it } from 'vitest';

import type { ActorView, ItemView } from '@vtt/shared/api';

import { generateId } from '../src/domain/auth/tokens.js';

import { createTable, type Client } from './support/app.js';
import { setupTable, type TableSetup } from './support/table.js';

async function libraryItem(t: TableSetup, name = 'Sword', type = 'weapon'): Promise<ItemView> {
  const res = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/items`, { type, name });
  if (res.statusCode !== 201) throw new Error(`create item failed: ${res.body}`);
  return res.json<{ item: ItemView }>().item;
}

async function bobsActor(t: TableSetup): Promise<ActorView> {
  const res = await t.call(t.bob.client, 'POST', `/tables/${t.table.id}/actors`, {
    type: 'character',
    name: 'Bob the Brave',
  });
  return res.json<{ actor: ActorView }>().actor;
}

async function copyInto(t: TableSetup, client: Client, actorId: string, itemId: string) {
  return t.call(client, 'POST', `/actors/${actorId}/items`, { itemId });
}

const libraryNames = async (t: TableSetup, client: Client, query = '') =>
  (await t.call(client, 'GET', `/tables/${t.table.id}/items${query}`))
    .json<{ items: ItemView[] }>()
    .items.map((i) => i.name);

describe('item library (FR-ENT-05, 06)', () => {
  it('is curated by the GM and read by every member', async () => {
    const t = await setupTable();
    const sword = await libraryItem(t);
    await libraryItem(t, 'Potion', 'consumable');
    expect(sword).toMatchObject({
      actorId: null,
      sourceId: null,
      dataVersion: '1.2.0',
      access: 'owner',
    });

    const url = `/tables/${t.table.id}/items`;
    expect(
      (await t.call(t.bob.client, 'POST', url, { type: 'weapon', name: 'Axe' })).statusCode,
    ).toBe(403);
    expect(
      (await t.call(t.gm.client, 'POST', url, { type: 'spell', name: 'Fireball' })).json(),
    ).toMatchObject({
      error: { code: 'unknown_item_type' },
    });

    for (const client of [t.gm.client, t.bob.client, t.dave.client]) {
      expect(await libraryNames(t, client)).toEqual(['Potion', 'Sword']);
    }
    expect(await libraryNames(t, t.bob.client, '?type=consumable')).toEqual(['Potion']);
    expect(await libraryNames(t, t.bob.client, '?search=wor')).toEqual(['Sword']);
    expect((await t.call(t.eve.client, 'GET', url)).statusCode).toBe(404);

    const asPlayer = await t.call(t.bob.client, 'GET', `/items/${sword.id}`);
    expect(asPlayer.json()).toMatchObject({ item: { access: 'observer' } });
    expect((await t.call(t.eve.client, 'GET', `/items/${sword.id}`)).statusCode).toBe(404);
  });

  it('lets only the GM edit, delete and restore library items', async () => {
    const t = await setupTable();
    const sword = await libraryItem(t);

    expect(
      (await t.call(t.bob.client, 'PATCH', `/items/${sword.id}`, { name: 'Mine' })).statusCode,
    ).toBe(403);
    expect(
      (await t.call(t.gm.client, 'PATCH', `/items/${sword.id}`, { name: 'Long sword' })).json(),
    ).toMatchObject({
      item: { name: 'Long sword' },
    });
    expect((await t.call(t.bob.client, 'DELETE', `/items/${sword.id}`)).statusCode).toBe(403);
    expect((await t.call(t.gm.client, 'DELETE', `/items/${sword.id}`)).statusCode).toBe(204);

    expect(await libraryNames(t, t.gm.client)).toEqual([]);
    expect(await libraryNames(t, t.gm.client, '?trash=restorable')).toEqual(['Long sword']);
    expect(await libraryNames(t, t.bob.client, '?trash=restorable')).toEqual([]);
    expect((await t.call(t.bob.client, 'POST', `/items/${sword.id}/restore`)).statusCode).toBe(403);

    const restored = await t.call(t.gm.client, 'POST', `/items/${sword.id}/restore`);
    expect(restored.json()).toMatchObject({ item: { deletedAt: null } });
    expect((await t.call(t.gm.client, 'POST', `/items/${sword.id}/restore`)).statusCode).toBe(409);

    await t.call(t.gm.client, 'DELETE', `/items/${sword.id}`);
    t.advanceDays(30);
    expect((await t.call(t.gm.client, 'POST', `/items/${sword.id}/restore`)).statusCode).toBe(410);
  });
});

describe('owned items (FR-ENT-05)', () => {
  it("copies a library item into an actor, following the actor's ownership", async () => {
    const t = await setupTable();
    const sword = await libraryItem(t);
    const hero = await bobsActor(t);

    const copied = await copyInto(t, t.bob.client, hero.id, sword.id);
    expect(copied.statusCode).toBe(201);
    const owned = copied.json<{ item: ItemView }>().item;
    expect(owned).toMatchObject({
      actorId: hero.id,
      sourceId: sword.id,
      name: 'Sword',
      access: 'owner',
    });

    // Owned items stay out of the library.
    expect(await libraryNames(t, t.gm.client)).toEqual(['Sword']);
    const list = await t.call(t.bob.client, 'GET', `/actors/${hero.id}/items`);
    expect(list.json<{ items: ItemView[] }>().items.map((i) => i.id)).toEqual([owned.id]);

    // Carol cannot see Bob's actor, so neither its items.
    expect((await t.call(t.carol.client, 'GET', `/items/${owned.id}`)).statusCode).toBe(404);
    expect((await t.call(t.carol.client, 'GET', `/actors/${hero.id}/items`)).statusCode).toBe(404);
    expect((await copyInto(t, t.carol.client, hero.id, sword.id)).statusCode).toBe(404);

    expect(
      (await t.call(t.bob.client, 'PATCH', `/items/${owned.id}`, { name: 'Lucky sword' })).json(),
    ).toMatchObject({
      item: { name: 'Lucky sword' },
    });
    expect((await t.call(t.gm.client, 'GET', `/items/${owned.id}`)).json()).toMatchObject({
      item: { access: 'owner' },
    });
  });

  it('lets observers read but not change owned items', async () => {
    const t = await setupTable();
    const sword = await libraryItem(t);
    const hero = await bobsActor(t);
    const owned = (await copyInto(t, t.bob.client, hero.id, sword.id)).json<{ item: ItemView }>()
      .item;
    await t.call(t.gm.client, 'PATCH', `/actors/${hero.id}`, {
      ownership: { default: 'observer', users: { [t.bob.userId]: 'owner' } },
    });

    expect((await t.call(t.carol.client, 'GET', `/items/${owned.id}`)).json()).toMatchObject({
      item: { access: 'observer' },
    });
    expect(
      (await t.call(t.carol.client, 'PATCH', `/items/${owned.id}`, { name: 'x' })).statusCode,
    ).toBe(403);
    expect((await t.call(t.carol.client, 'DELETE', `/items/${owned.id}`)).statusCode).toBe(403);
    expect((await copyInto(t, t.carol.client, hero.id, sword.id)).statusCode).toBe(403);
    const trash = await t.call(t.carol.client, 'GET', `/actors/${hero.id}/items?trash=restorable`);
    expect(trash.json()).toEqual({ items: [] });
  });

  it('deletes and restores owned items, and hides them while their actor is in the trash', async () => {
    const t = await setupTable();
    const sword = await libraryItem(t);
    const hero = await bobsActor(t);
    const owned = (await copyInto(t, t.bob.client, hero.id, sword.id)).json<{ item: ItemView }>()
      .item;

    expect((await t.call(t.bob.client, 'DELETE', `/items/${owned.id}`)).statusCode).toBe(204);
    const trash = await t.call(t.bob.client, 'GET', `/actors/${hero.id}/items?trash=restorable`);
    expect(trash.json<{ items: ItemView[] }>().items.map((i) => i.id)).toEqual([owned.id]);
    expect((await t.call(t.bob.client, 'POST', `/items/${owned.id}/restore`)).statusCode).toBe(200);

    await t.call(t.bob.client, 'DELETE', `/actors/${hero.id}`);
    expect((await t.call(t.bob.client, 'GET', `/items/${owned.id}`)).statusCode).toBe(404);
    await t.call(t.bob.client, 'POST', `/actors/${hero.id}/restore`);
    expect((await t.call(t.bob.client, 'GET', `/items/${owned.id}`)).statusCode).toBe(200);
  });

  it('only copies live library items from the same table', async () => {
    const t = await setupTable();
    const hero = await bobsActor(t);
    const sword = await libraryItem(t);
    const owned = (await copyInto(t, t.bob.client, hero.id, sword.id)).json<{ item: ItemView }>()
      .item;

    const fromOwned = await copyInto(t, t.bob.client, hero.id, owned.id);
    expect(fromOwned.statusCode).toBe(422);
    expect(fromOwned.json()).toMatchObject({ error: { code: 'not_library_item' } });

    // An item on another table the GM also runs.
    const other = await createTable(t.app, t.gm.client, { name: 'Other' });
    const axe = await t.call(t.gm.client, 'POST', `/tables/${other.id}/items`, {
      type: 'weapon',
      name: 'Axe',
    });
    const axeId = axe.json<{ item: ItemView }>().item.id;
    expect((await copyInto(t, t.gm.client, hero.id, axeId)).statusCode).toBe(404);

    await t.call(t.gm.client, 'DELETE', `/items/${sword.id}`);
    expect((await copyInto(t, t.bob.client, hero.id, sword.id)).statusCode).toBe(404);
    expect((await copyInto(t, t.bob.client, hero.id, generateId())).statusCode).toBe(404);
  });
});
