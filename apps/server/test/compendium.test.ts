import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  compendiumCopyResponseSchema,
  compendiumPageSchema,
  type ActorView,
  type CompendiumCopyInput,
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

// T-1202 (FR-PLUGIN-09, ADR-060): browsing tiny-d20's bestiary pack and copying its entries.

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

const call = (
  client: Client,
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  url: string,
  payload?: object,
) =>
  t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: authHeaders(client),
    ...(payload && { payload }),
  });

const GOBLIN = 'tiny-d20:bestiary:goblin';
const OGRE = 'tiny-d20:bestiary:ogre';
const SHORTSWORD = 'tiny-d20:bestiary:shortsword';
const GREATCLUB = 'tiny-d20:bestiary:greatclub';

async function browse(client: Client = gm, query = '') {
  const res = await call(client, 'GET', `/tables/${tableId}/compendium${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return compendiumPageSchema.parse(res.json());
}

const names = (page: { entries: { name: string }[] }) => page.entries.map((entry) => entry.name);

function copy(client: Client, input: CompendiumCopyInput) {
  return call(client, 'POST', `/tables/${tableId}/compendium/copy`, input);
}

async function copied(client: Client, input: CompendiumCopyInput) {
  const res = await copy(client, input);
  expect(res.statusCode, res.body).toBe(201);
  return compendiumCopyResponseSchema.parse(res.json());
}

async function library() {
  const actors = (await call(gm, 'GET', `/tables/${tableId}/actors`)).json<{
    actors: ActorView[];
  }>().actors;
  const items = (await call(gm, 'GET', `/tables/${tableId}/items`)).json<{ items: ItemView[] }>()
    .items;
  return { actors, items };
}

async function bobsCharacter() {
  const res = await call(bob.client, 'POST', `/tables/${tableId}/actors`, {
    type: 'character',
    name: 'Brin',
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ actor: ActorView }>().actor;
}

describe('compendium browser (T-1202)', () => {
  it('lists every pack entry by name for every member, without their secret fields', async () => {
    const page = await browse();
    expect(page.packs).toEqual([{ name: 'bestiary', label: 'pack.bestiary' }]);
    expect(names(page)).toEqual([
      'Chain mail',
      'Goblin',
      'Greatclub',
      'Leather armour',
      'Mend',
      'Ogre',
      'Shortsword',
      'Spark',
    ]);
    expect(page.nextCursor).toBeNull();
    const ogre = page.entries.find((entry) => entry.ref === OGRE);
    expect(ogre).toMatchObject({ pack: 'bestiary', kind: 'actor', type: 'npc', inTable: false });
    expect(ogre?.system).toMatchObject({ str: 19, gmNotes: 'Hates bright light.' });

    const asBob = await browse(bob.client);
    expect(names(asBob)).toEqual(names(page));
    const seen = asBob.entries.find((entry) => entry.ref === OGRE);
    expect(seen?.system).toMatchObject({ str: 19 });
    expect(seen?.system).not.toHaveProperty('gmNotes');
  });

  it('filters by name, pack, kind and type', async () => {
    expect(names(await browse(gm, '?search=GOB'))).toEqual(['Goblin']);
    expect(names(await browse(gm, '?kind=item'))).toEqual([
      'Chain mail',
      'Greatclub',
      'Leather armour',
      'Mend',
      'Shortsword',
      'Spark',
    ]);
    expect(names(await browse(gm, '?type=spell'))).toEqual(['Mend', 'Spark']);
    expect(names(await browse(gm, '?kind=actor&type=npc'))).toEqual(['Goblin', 'Ogre']);
    expect(names(await browse(gm, '?type=weapon&search=short'))).toEqual(['Shortsword']);
    expect(names(await browse(gm, '?pack=bestiary&search=o'))).toEqual([
      'Goblin',
      'Leather armour',
      'Ogre',
      'Shortsword',
    ]);
    expect(names(await browse(gm, '?pack=missing'))).toEqual([]);
    expect((await call(gm, 'GET', `/tables/${tableId}/compendium?kind=spell`)).statusCode).toBe(
      400,
    );
  });

  it('pages in name order with opaque cursors', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await browse(
        gm,
        `?limit=3${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...names(page));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual([
      'Chain mail',
      'Goblin',
      'Greatclub',
      'Leather armour',
      'Mend',
      'Ogre',
      'Shortsword',
      'Spark',
    ]);
    expect(
      (await call(gm, 'GET', `/tables/${tableId}/compendium?limit=2&cursor=nope`)).statusCode,
    ).toBe(400);
  });

  it('lets GMs copy actors and items into the table, marked as in it', async () => {
    const created = await copied(gm, { refs: [OGRE, GREATCLUB] });
    expect(created.actors.map((actor) => [actor.name, actor.access])).toEqual([['Ogre', 'owner']]);
    expect(created.actors[0]?.system).toMatchObject({ str: 19, gmNotes: 'Hates bright light.' });
    expect(created.items.map((item) => [item.name, item.actorId])).toEqual([['Greatclub', null]]);
    expect(created.items[0]?.system).toMatchObject({ damage: '2d8', bonus: 1 });

    const marks = Object.fromEntries((await browse()).entries.map((e) => [e.ref, e.inTable]));
    expect(marks).toEqual({
      [GOBLIN]: false,
      [GREATCLUB]: true,
      [OGRE]: true,
      [SHORTSWORD]: false,
      'tiny-d20:bestiary:chainmail': false,
      'tiny-d20:bestiary:leather': false,
      'tiny-d20:bestiary:mend': false,
      'tiny-d20:bestiary:spark': false,
    });

    // A second copy is another actor; the mark stays while a copy is in the trash.
    await copied(gm, { refs: [OGRE] });
    const ogres = (await library()).actors.filter((actor) => actor.name === 'Ogre');
    expect(ogres).toHaveLength(2);
    for (const ogre of ogres) {
      expect((await call(gm, 'DELETE', `/actors/${ogre.id}`)).statusCode).toBe(204);
    }
    expect((await browse(gm, '?search=ogre')).entries[0]?.inTable).toBe(true);
  });

  it('lets players copy items onto actors they own, and nothing else', async () => {
    const brin = await bobsCharacter();
    expect((await copy(bob.client, { refs: [SHORTSWORD] })).statusCode).toBe(403);

    const created = await copied(bob.client, { refs: [SHORTSWORD], actorId: brin.id });
    expect(created.items.map((item) => [item.name, item.actorId])).toEqual([
      ['Shortsword', brin.id],
    ]);
    const owned = (await call(bob.client, 'GET', `/actors/${brin.id}/items`)).json<{
      items: ItemView[];
    }>().items;
    expect(owned.map((item) => item.name)).toEqual(['Shortsword']);
    // An actor's items are its owner's copies, not the table's library.
    expect((await browse(bob.client, '?search=short')).entries[0]?.inTable).toBe(false);

    const actorEntry = await copy(bob.client, { refs: [GOBLIN], actorId: brin.id });
    expect(actorEntry.statusCode).toBe(422);
    const { actor: gmActor } = (
      await call(gm, 'POST', `/tables/${tableId}/actors`, { type: 'npc', name: 'Guard' })
    ).json<{ actor: ActorView }>();
    expect((await copy(bob.client, { refs: [SHORTSWORD], actorId: gmActor.id })).statusCode).toBe(
      404,
    );
    expect((await copy(gm, { refs: ['tiny-d20:bestiary:dragon'] })).statusCode).toBe(404);
    expect((await library()).items).toEqual([]);
  });

  it('keeps packs out of the system definition browsers load', async () => {
    const res = await call(gm, 'GET', '/systems/tiny-d20');
    const { definition } = res.json<{ system: { definition: Record<string, unknown> } }>().system;
    expect(definition).not.toHaveProperty('packs');
    expect(res.body).not.toContain('Hates bright light');
  });
});
