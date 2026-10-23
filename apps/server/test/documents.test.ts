import { rm } from 'node:fs/promises';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { actors, ydocs } from '../src/db/schema.js';
import { COLLAB_TIMING, type CollabTiming } from '../src/realtime/collab.js';

import type { Client, TestApp } from './support/app.js';
import { openCollab, type CollabDocument } from './support/collab.js';
import { createActorAs, startWithSystems, systemsDir, tableWithPlayer } from './support/systems.js';

let dataDir: string;
let t: TestApp;
let gm: Client;
let bob: { client: Client; userId: string };

const SYSTEMS = ['tiny-d20'];

/** Restarts the server on the same data, with other timings if given. */
async function restart(collabTiming?: CollabTiming) {
  await t.app.close();
  ({ t } = await startWithSystems(dataDir, SYSTEMS, {
    db: t.db,
    admin: gm,
    ...(collabTiming && { collabTiming }),
  }));
}

/** A tiny-d20 character of bob's, with its main and secret document names. */
async function createCharacter() {
  const { table, player } = await tableWithPlayer(t, gm, 'tiny-d20', 'bob');
  bob = player;
  return createActorAs(t, bob.client, table.id, 'character', 'Ayla');
}

const projection = (id: string) =>
  t.db.select({ system: actors.system }).from(actors).where(eq(actors.id, id)).get()?.system;

const data = (document: CollabDocument) => document.doc.getMap('data');

beforeEach(async () => {
  dataDir = await systemsDir(SYSTEMS);
  ({ t, gm } = await startWithSystems(dataDir, SYSTEMS));
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('document persistence (specs §9.6, T-0502)', () => {
  it('starts a document from the projection, with the schema defaults', async () => {
    const actor = await createCharacter();
    const main = await (await openCollab(t.app, bob.client)).open(actor.main);
    expect(data(main).toJSON()).toMatchObject({
      level: 1,
      str: 10,
      hp: { value: 10, max: 10 },
      skills: {},
      notes: '',
    });
    expect(data(main).get('notes')).toBeInstanceOf(Y.Text);
    // Secret fields live only in the secret document.
    expect(data(main).has('gmNotes')).toBe(false);
    const secret = await (await openCollab(t.app, gm)).open(actor.secret);
    expect(data(secret).toJSON()).toEqual({ gmNotes: '' });
  });

  it('keeps the state across a restart, and the projection matches it', async () => {
    const actor = await createCharacter();
    const main = await (await openCollab(t.app, bob.client)).open(actor.main);
    const secret = await (await openCollab(t.app, gm)).open(actor.secret);
    expect(
      await main.change((doc) => {
        const map = doc.getMap('data');
        map.set('str', 16);
        (map.get('notes') as Y.Text).insert(0, 'Likes tea.');
        const row = new Y.Map<unknown>([
          ['name', 'Climb'],
          ['ability', 'str'],
          ['rank', 2],
          ['sort', 'i'],
        ]);
        (map.get('skills') as Y.Map<unknown>).set('s1', row);
      }),
    ).toBe(true);
    expect(
      await secret.change((doc) => {
        (doc.getMap('data').get('gmNotes') as Y.Text).insert(0, 'Secretly a dragon');
      }),
    ).toBe(true);
    const before = { main: data(main).toJSON(), secret: data(secret).toJSON() };

    // Shut down while both are still open: closing stores what the debounce still holds.
    await t.app.close();
    expect(projection(actor.id)).toMatchObject({
      str: 16,
      notes: 'Likes tea.',
      skills: { s1: { name: 'Climb', ability: 'str', rank: 2, sort: 'i' } },
      gmNotes: 'Secretly a dragon',
      hp: { value: 10, max: 10 },
    });
    expect(
      t.db
        .select({ name: ydocs.name })
        .from(ydocs)
        .all()
        .map((row) => row.name)
        .sort(),
    ).toEqual([actor.main, actor.secret].sort());

    ({ t } = await startWithSystems(dataDir, SYSTEMS, { db: t.db, admin: gm }));
    const reopened = await (await openCollab(t.app, bob.client)).open(actor.main);
    const reopenedSecret = await (await openCollab(t.app, gm)).open(actor.secret);
    expect(data(reopened).toJSON()).toEqual(before.main);
    expect(data(reopenedSecret).toJSON()).toEqual(before.secret);
    // The same text type, not a copy of its content.
    expect(data(reopened).get('notes')).toBeInstanceOf(Y.Text);
  });

  it('adds the maps a stored state lacks before clients edit it (specs §9.4)', async () => {
    const actor = await createCharacter();
    // A state stored before the schema had `hp`, `skills` and `notes`.
    const old = new Y.Doc();
    old.getMap('data').set('str', 12);
    t.db
      .insert(ydocs)
      .values({
        name: actor.main,
        actorId: actor.id,
        state: Buffer.from(Y.encodeStateAsUpdate(old)),
        updatedAt: new Date(),
      })
      .run();
    const main = await (await openCollab(t.app, bob.client)).open(actor.main);
    expect(data(main).get('str')).toBe(12);
    expect(data(main).get('skills')).toBeInstanceOf(Y.Map);
    expect(data(main).get('hp')).toBeInstanceOf(Y.Map);
    expect(data(main).get('notes')).toBeInstanceOf(Y.Text);
  });

  it('stores while clients stay connected, after the debounce', async () => {
    await restart({ ...COLLAB_TIMING, debounceMs: 20, maxDebounceMs: 100 });
    const actor = await createCharacter();
    const main = await (await openCollab(t.app, bob.client)).open(actor.main);
    expect(await main.change((doc) => doc.getMap('data').set('dex', 14))).toBe(true);
    await expect.poll(() => projection(actor.id)?.dex).toBe(14);
    expect(t.app.collab.hocuspocus.documents.has(actor.main)).toBe(true);
  });

  it('keeps an unused document in memory for the unload delay, then unloads it', async () => {
    await restart({ ...COLLAB_TIMING, unloadDelayMs: 200 });
    const actor = await createCharacter();
    const loaded = () => t.app.collab.hocuspocus.documents.has(actor.main);

    const first = await openCollab(t.app, bob.client);
    await first.open(actor.main);
    await first.drop();
    // Opening it again within the delay finds it loaded and cancels the unload.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(loaded()).toBe(true);
    const second = await openCollab(t.app, bob.client);
    await second.open(actor.main);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(loaded()).toBe(true);

    await second.drop();
    await expect.poll(() => loaded(), { timeout: 1000 }).toBe(false);
  });

  it('deletes stored documents with their actor', async () => {
    const actor = await createCharacter();
    const socket = await openCollab(t.app, bob.client);
    const main = await socket.open(actor.main);
    expect(await main.change((doc) => doc.getMap('data').set('dex', 12))).toBe(true);
    await socket.drop();
    await expect
      .poll(() => t.db.select().from(ydocs).where(eq(ydocs.actorId, actor.id)).all().length)
      .toBe(1);
    t.db.delete(actors).where(eq(actors.id, actor.id)).run();
    expect(t.db.select().from(ydocs).all()).toEqual([]);
  });
});
