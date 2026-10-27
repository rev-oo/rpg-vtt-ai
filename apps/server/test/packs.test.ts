import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  packImportResponseSchema,
  packsResponseSchema,
  type ActorView,
  type ItemView,
} from '@vtt/shared/api';

import { members } from '../src/db/schema.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { copyReferencePlugin } from './support/reference.js';

// T-0803 (FR-PLUGIN-09, ADR-051): importing tiny-d20's bestiary pack into a table.

let dataDir: string;
let t: TestApp;
let gm: Client;
let bob: { client: Client; userId: string };
let tableId: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'vtt-packs-'));
  await copyReferencePlugin('tiny-d20', path.join(dataDir, 'plugins', 'tiny-d20'));
  t = await createTestApp({ env: { DATA_DIR: dataDir } });
  gm = await setupAdmin(t.app);
  const headers = authHeaders(gm);
  await t.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
  await t.app.inject({
    method: 'POST',
    url: '/api/v1/plugins/tiny-d20/enable',
    headers,
    payload: { acknowledgeCode: true },
  });
  tableId = (await createTable(t.app, gm, { systemId: 'tiny-d20' })).id;
  bob = await createUserClient(t.app, gm, 'bob');
  t.db.insert(members).values({ tableId, userId: bob.userId, role: 'player' }).run();
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const call = (client: Client, method: 'GET' | 'POST' | 'DELETE', url: string) =>
  t.app.inject({ method, url: `/api/v1${url}`, headers: authHeaders(client) });

async function packs() {
  const res = await call(gm, 'GET', `/tables/${tableId}/packs`);
  expect(res.statusCode, res.body).toBe(200);
  return packsResponseSchema.parse(res.json()).packs;
}

async function importBestiary() {
  const res = await call(gm, 'POST', `/tables/${tableId}/packs/bestiary/import`);
  expect(res.statusCode, res.body).toBe(200);
  return packImportResponseSchema.parse(res.json());
}

async function library() {
  const actors = (await call(gm, 'GET', `/tables/${tableId}/actors`)).json<{
    actors: ActorView[];
  }>().actors;
  const items = (await call(gm, 'GET', `/tables/${tableId}/items`)).json<{ items: ItemView[] }>()
    .items;
  return { actors, items };
}

describe('compendium packs (T-0803)', () => {
  it('lists the system’s packs for GMs only', async () => {
    expect(await packs()).toEqual([
      { name: 'bestiary', label: 'pack.bestiary', actors: 2, items: 2, imported: 0 },
    ]);
    expect((await call(bob.client, 'GET', `/tables/${tableId}/packs`)).statusCode).toBe(403);
    const asBob = await call(bob.client, 'POST', `/tables/${tableId}/packs/bestiary/import`);
    expect(asBob.statusCode).toBe(403);
    expect((await call(gm, 'POST', `/tables/${tableId}/packs/nope/import`)).statusCode).toBe(404);
  });

  it('imports actors and library items with their data', async () => {
    expect(await importBestiary()).toEqual({ created: 4, skipped: 0 });
    const { actors, items } = await library();
    const ogre = actors.find((actor) => actor.name === 'Ogre');
    expect(ogre).toMatchObject({ type: 'npc', access: 'owner' });
    expect(ogre?.system).toMatchObject({ str: 19, dex: 8, gmNotes: 'Hates bright light.' });
    expect(items.map((item) => [item.name, item.actorId])).toEqual(
      expect.arrayContaining([
        ['Shortsword', null],
        ['Greatclub', null],
      ]),
    );
    expect(items.find((item) => item.name === 'Greatclub')?.system).toMatchObject({
      damage: '2d8',
      bonus: 1,
    });
    // NPCs belong to the GM: players do not see them.
    const seen = (await call(bob.client, 'GET', `/tables/${tableId}/actors`)).json<{
      actors: ActorView[];
    }>().actors;
    expect(seen).toEqual([]);
  });

  it('never duplicates on re-import, even after an entry went to the trash', async () => {
    await importBestiary();
    const goblin = (await library()).actors.find((actor) => actor.name === 'Goblin');
    expect((await call(gm, 'DELETE', `/actors/${String(goblin?.id)}`)).statusCode).toBe(204);

    expect(await importBestiary()).toEqual({ created: 0, skipped: 4 });
    const { actors, items } = await library();
    expect(actors.map((actor) => actor.name)).toEqual(['Ogre']);
    expect(items).toHaveLength(2);
    expect((await packs())[0]?.imported).toBe(4);
  });

  it('keeps packs out of the system definition browsers load', async () => {
    const res = await call(gm, 'GET', '/systems/tiny-d20');
    const { definition } = res.json<{ system: { definition: Record<string, unknown> } }>().system;
    expect(definition).not.toHaveProperty('packs');
    expect(res.body).not.toContain('Hates bright light');
  });
});
