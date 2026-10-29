import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { documentName } from '@vtt/shared';
import type { ItemView } from '@vtt/shared/api';

import { items, ydocs } from '../src/db/schema.js';
import { COLLAB_TIMING } from '../src/realtime/collab.js';

import { authHeaders, type Client, type TestApp } from './support/app.js';
import { openCollab } from './support/collab.js';
import { createActorAs, startWithSystems, systemsDir, tableWithPlayer } from './support/systems.js';

// T-1204 (FR-ENT-06, ADR-062): items are edited on live documents of their own.

const SYSTEMS = ['tiny-d20'];

let dataDir: string;
let t: TestApp;
let gm: Client;

beforeEach(async () => {
  dataDir = await systemsDir(SYSTEMS);
  // A secret field on weapons, so the item's secret document exists.
  const file = path.join(dataDir, 'plugins/tiny-d20/types/items/weapon.json');
  const weapon = JSON.parse(await readFile(file, 'utf8')) as {
    schema: { properties: Record<string, unknown> };
  };
  weapon.schema.properties.curse = {
    type: 'string',
    default: '',
    maxLength: 100,
    'x-layer': 'secret',
  };
  await writeFile(file, JSON.stringify(weapon));
  ({ t, gm } = await startWithSystems(dataDir, SYSTEMS, {
    collabTiming: { ...COLLAB_TIMING, debounceMs: 20, maxDebounceMs: 100 },
  }));
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function call(client: Client, method: 'POST' | 'DELETE' | 'GET', url: string, body?: object) {
  return t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: authHeaders(client),
    ...(body && { payload: body }),
  });
}

/** A table with a library sword, and bob's character. */
async function table() {
  const { table: created, player: bob } = await tableWithPlayer(t, gm, 'tiny-d20', 'bob');
  const res = await call(gm, 'POST', `/tables/${created.id}/items`, {
    type: 'weapon',
    name: 'Sword',
  });
  expect(res.statusCode, res.body).toBe(201);
  const sword = res.json<{ item: ItemView }>().item;
  const ayla = await createActorAs(t, bob.client, created.id, 'character', 'Ayla');
  return { bob: bob.client, sword, ayla };
}

const itemDoc = (id: string, layer: 'main' | 'secret' = 'main') =>
  documentName({ kind: 'item', id, layer });
const open = async (client: Client, name: string) => (await openCollab(t.app, client)).open(name);
const projection = (id: string) =>
  t.db.select({ system: items.system }).from(items).where(eq(items.id, id)).get()?.system;

describe('item documents (T-1204, ADR-062)', () => {
  it('lets GMs edit library items and every member read them', async () => {
    const { bob, sword } = await table();
    const gmDoc = await open(gm, itemDoc(sword.id));
    const bobDoc = await open(bob, itemDoc(sword.id));
    expect(gmDoc.auth).toEqual({ scope: 'read-write' });
    expect(bobDoc.auth).toEqual({ scope: 'readonly' });
    // The first state comes from the projection, with the schema's defaults.
    expect(gmDoc.doc.getMap('data').toJSON()).toEqual({ damage: '1d6', bonus: 0 });

    expect(
      await gmDoc.change((doc) => {
        doc.getMap('data').set('damage', '1d8');
      }),
    ).toBe(true);
    await expect.poll(() => bobDoc.doc.getMap('data').get('damage')).toBe('1d8');
    expect(
      await bobDoc.change((doc) => {
        doc.getMap('data').set('damage', '9d9');
      }),
    ).toBe(false);
    // Stores refresh the item's projection.
    await expect.poll(() => projection(sword.id)).toMatchObject({ damage: '1d8' });
  });

  it('keeps the secret layer for GMs and assistants', async () => {
    const { bob, sword } = await table();
    const secret = await open(gm, itemDoc(sword.id, 'secret'));
    expect(secret.auth).toEqual({ scope: 'read-write' });
    await secret.change((doc) => {
      doc.getMap('data').set('curse', 'Bites its wielder.');
    });
    await expect.poll(() => projection(sword.id)).toMatchObject({ curse: 'Bites its wielder.' });
    expect((await open(bob, itemDoc(sword.id, 'secret'))).auth).toEqual({ denied: 'Forbidden' });
    // Players never see the secret field over REST either.
    const seen = (await call(bob, 'GET', `/items/${sword.id}`)).json<{ item: ItemView }>().item;
    expect(seen.system).not.toHaveProperty('curse');
  });

  it("follows the owning actor's ownership, and the trash", async () => {
    const { bob, sword, ayla } = await table();
    const res = await call(bob, 'POST', `/actors/${ayla.id}/items`, { itemId: sword.id });
    expect(res.statusCode, res.body).toBe(201);
    const owned = res.json<{ item: ItemView }>().item;
    expect((await open(bob, itemDoc(owned.id))).auth).toEqual({ scope: 'read-write' });
    expect((await open(gm, itemDoc(owned.id))).auth).toEqual({ scope: 'read-write' });

    expect((await call(bob, 'DELETE', `/actors/${ayla.id}`)).statusCode).toBe(204);
    expect((await open(bob, itemDoc(owned.id))).auth).toEqual({ denied: 'Forbidden' });
    expect((await call(gm, 'DELETE', `/items/${sword.id}`)).statusCode).toBe(204);
    expect((await open(gm, itemDoc(sword.id))).auth).toEqual({ denied: 'Forbidden' });
  });

  it('drops an item’s documents with the item', async () => {
    const { sword } = await table();
    const doc = await open(gm, itemDoc(sword.id));
    await doc.change((d) => {
      d.getMap('data').set('bonus', 2);
    });
    const stored = () => t.db.select().from(ydocs).where(eq(ydocs.itemId, sword.id)).all();
    await expect.poll(() => stored().length).toBe(1);
    t.db.delete(items).where(eq(items.id, sword.id)).run();
    expect(stored()).toEqual([]);
  });
});
