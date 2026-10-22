import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { documentName } from '@vtt/shared';

import { actors, ydocs } from '../src/db/schema.js';
import { COLLAB_TIMING, type CollabTiming } from '../src/realtime/collab.js';

import {
  authHeaders,
  createTable,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { openCollab, type CollabDocument } from './support/collab.js';
import { copyReferencePlugin } from './support/reference.js';

let dataDir: string;
let t: TestApp;
let gm: Client;
let bob: { client: Client; userId: string };

/**
 * Starts the server on `dataDir` with tiny-d20 enabled; given the database of a previous run,
 * it restarts on that data, where sessions are still valid.
 */
async function start(options: { db?: TestApp['db']; collabTiming?: CollabTiming } = {}) {
  const app = await createTestApp({ env: { DATA_DIR: dataDir }, ...options });
  const admin = options.db ? gm : await setupAdmin(app.app);
  const headers = authHeaders(admin);
  await app.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
  await app.app.inject({
    method: 'POST',
    url: '/api/v1/plugins/tiny-d20/enable',
    headers,
    payload: {},
  });
  return { app, admin };
}

/** A tiny-d20 character of bob's, with its main and secret document names. */
async function createCharacter() {
  const table = await createTable(t.app, gm, { systemId: 'tiny-d20' });
  bob = await createUserClient(t.app, gm, 'bob');
  const invite = await t.app.inject({
    method: 'POST',
    url: `/api/v1/tables/${table.id}/invites`,
    headers: authHeaders(gm),
    payload: { role: 'player' },
  });
  const { token } = invite.json<{ token: string }>();
  await t.app.inject({
    method: 'POST',
    url: `/api/v1/invites/${token}/accept`,
    headers: authHeaders(bob.client),
  });
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1/tables/${table.id}/actors`,
    headers: authHeaders(bob.client),
    payload: { type: 'character', name: 'Ayla' },
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json<{ actor: { id: string } }>().actor.id;
  return {
    id,
    main: documentName({ kind: 'actor', id, layer: 'main' }),
    secret: documentName({ kind: 'actor', id, layer: 'secret' }),
  };
}

const projection = (id: string) =>
  t.db.select({ system: actors.system }).from(actors).where(eq(actors.id, id)).get()?.system;

const data = (document: CollabDocument) => document.doc.getMap('data');

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'vtt-documents-'));
  await copyReferencePlugin('tiny-d20', path.join(dataDir, 'plugins', 'tiny-d20'));
  const started = await start();
  t = started.app;
  gm = started.admin;
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

    t = (await start({ db: t.db })).app;
    const reopened = await (await openCollab(t.app, bob.client)).open(actor.main);
    const reopenedSecret = await (await openCollab(t.app, gm)).open(actor.secret);
    expect(data(reopened).toJSON()).toEqual(before.main);
    expect(data(reopenedSecret).toJSON()).toEqual(before.secret);
    // The same text type, not a copy of its content.
    expect(data(reopened).get('notes')).toBeInstanceOf(Y.Text);
  });

  it('stores while clients stay connected, after the debounce', async () => {
    await t.app.close();
    const timing = { ...COLLAB_TIMING, debounceMs: 20, maxDebounceMs: 100 };
    t = (await start({ db: t.db, collabTiming: timing })).app;
    const actor = await createCharacter();
    const main = await (await openCollab(t.app, bob.client)).open(actor.main);
    expect(await main.change((doc) => doc.getMap('data').set('dex', 14))).toBe(true);
    await expect.poll(() => projection(actor.id)?.dex).toBe(14);
    expect(t.app.collab.hocuspocus.documents.has(actor.main)).toBe(true);
  });

  it('keeps an unused document in memory for the unload delay, then unloads it', async () => {
    await t.app.close();
    t = (await start({ db: t.db, collabTiming: { ...COLLAB_TIMING, unloadDelayMs: 200 } })).app;
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
