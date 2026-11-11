import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { EncounterView, TokenView } from '@vtt/shared/api';

import { actors } from '../src/db/schema.js';
import { COLLAB_TIMING } from '../src/realtime/collab.js';

import {
  authHeaders,
  createTestApp,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { openCollab, type CollabDocument } from './support/collab.js';
import { copyReferencePlugin } from './support/reference.js';
import { openSocket, type TestSocket } from './support/socket.js';
import { createActorAs, tableWithPlayer } from './support/systems.js';

// T-1618: an actor type's statuses show on its tokens and combatants while their fields are
// on, a secret field's only to GMs and assistants, and follow the sheet as it changes.

let dir: string;
let t: TestApp;
let gm: Client;
let bob: Client;
let tableId: string;
let sceneId: string;
let goblin: { id: string; main: string; secret: string };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vtt-statuses-'));
  const srd5 = path.join(dir, 'plugins', 'srd5');
  await copyReferencePlugin('srd5', srd5, { code: true });
  // A secret status, for this test: the GM marks a creature as hunted.
  const npcFile = path.join(srd5, 'types/actors/npc.json');
  const npc = JSON.parse(await readFile(npcFile, 'utf8')) as {
    schema: { properties: Record<string, unknown> };
    statuses: unknown[];
  };
  npc.schema.properties.hunted = { type: 'boolean', default: false, 'x-layer': 'secret' };
  npc.statuses.push({ field: 'hunted', label: 'Hunted', icon: 'icons/prone.svg' });
  await writeFile(npcFile, JSON.stringify(npc));

  t = await createTestApp({
    env: { DATA_DIR: dir },
    // Short debounces, so sheet edits are stored within a test.
    collabTiming: { ...COLLAB_TIMING, debounceMs: 20, maxDebounceMs: 100 },
  });
  gm = await setupAdmin(t.app);
  await post(gm, '/plugins/rescan', {});
  const enabled = await post(gm, '/plugins/srd5/enable', { acknowledgeCode: true });
  expect(enabled.statusCode, enabled.body).toBe(200);
  const { table, player } = await tableWithPlayer(t, gm, 'srd5', 'bob');
  tableId = table.id;
  bob = player.client;
  goblin = await createActorAs(t, gm, tableId, 'npc', 'Goblin');
  const mira = await createActorAs(t, bob, tableId, 'character', 'Mira');

  const scene = await post(gm, `/tables/${tableId}/scenes`, {
    name: 'Ambush',
    columns: 8,
    rows: 6,
  });
  sceneId = scene.json<{ scene: { id: string } }>().scene.id;
  await post(gm, `/tables/${tableId}/scenes/active`, { sceneId });
  for (const [actorId, column] of [
    [goblin.id, 4],
    [mira.id, 1],
  ] as const)
    expect(
      (await post(gm, `/scenes/${sceneId}/tokens`, { actorId, column, row: 1 })).statusCode,
    ).toBe(201);
  await post(gm, `/tables/${tableId}/encounter`, {});
  await post(gm, `/tables/${tableId}/encounter/combatants`, { actorId: goblin.id });
}, 60_000);

afterAll(async () => {
  await t.app.close();
  await rm(dir, { recursive: true, force: true });
});

function post(client: Client, url: string, payload: object) {
  return t.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: authHeaders(client),
    payload,
  });
}

async function get<T>(client: Client, url: string): Promise<T> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/v1${url}`,
    headers: authHeaders(client),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
}

/** The fields of the goblin's statuses on its token and its combatant, as `client` sees them. */
async function shown(client: Client) {
  const { tokens } = await get<{ tokens: TokenView[] }>(client, `/scenes/${sceneId}/tokens`);
  const { encounter } = await get<{ encounter: EncounterView | null }>(
    client,
    `/tables/${tableId}/encounter`,
  );
  const fields = (statuses: { field: string }[] | undefined) =>
    statuses?.map((status) => status.field);
  return {
    token: fields(tokens.find((token) => token.actorId === goblin.id)?.statuses),
    combatant: fields(encounter?.combatants.find((c) => c.name === 'Goblin')?.statuses),
  };
}

const setGoblin = (system: Record<string, unknown>) => {
  t.db.update(actors).set({ system }).where(eq(actors.id, goblin.id)).run();
};

/** A nested map of a document's data, created if missing. */
function mapIn(document: CollabDocument, key: string): Y.Map<unknown> {
  const data = document.doc.getMap('data');
  const found = data.get(key);
  if (found instanceof Y.Map) return found;
  const created = new Y.Map<unknown>();
  data.set(key, created);
  return created;
}

describe('token statuses (T-1618)', () => {
  it('shows the statuses that are on, a secret one only to the GM', async () => {
    setGoblin({ conditions: { prone: true, poisoned: true, blinded: false }, hunted: true });
    // In the order the type lists them; the label is a lang key, the icon the plugin's file.
    expect(await shown(bob)).toEqual({
      token: ['conditions.poisoned', 'conditions.prone'],
      combatant: ['conditions.poisoned', 'conditions.prone'],
    });
    expect(await shown(gm)).toEqual({
      token: ['conditions.poisoned', 'conditions.prone', 'hunted'],
      combatant: ['conditions.poisoned', 'conditions.prone', 'hunted'],
    });
    const { tokens } = await get<{ tokens: TokenView[] }>(bob, `/scenes/${sceneId}/tokens`);
    expect(tokens.find((token) => token.actorId === goblin.id)?.statuses[0]).toEqual({
      field: 'conditions.poisoned',
      label: 'condition.poisoned',
      icon: '/plugins/srd5/icons/poisoned.svg',
    });
    // The icon is served to members.
    const icon = await t.app.inject({
      method: 'GET',
      url: '/plugins/srd5/icons/poisoned.svg',
      headers: authHeaders(bob),
    });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers['content-type']).toMatch(/^image\/svg\+xml/);
    // An actor without statuses on shows none.
    expect(tokens.find((token) => token.actorId !== goblin.id)?.statuses).toEqual([]);
    setGoblin({});
  });

  it('follows the sheet, telling only those who may see the change', async () => {
    const sockets: Record<'gm' | 'bob', TestSocket> = {
      gm: await openSocket(t.app, gm),
      bob: await openSocket(t.app, bob),
    };
    for (const socket of Object.values(sockets))
      expect((await socket.request({ type: 'subscribe', tableId })).type).toBe('ack');
    const collab = await openCollab(t.app, gm);
    const main = await collab.open(goblin.main);
    const secret = await collab.open(goblin.secret);
    const count = (socket: TestSocket) =>
      socket.ofType('token.updated').length + socket.ofType('combat.updated').length;

    // A condition goes on: everyone who sees the token and the combatant hears of it.
    await main.change(() => mapIn(main, 'conditions').set('prone', true));
    for (const socket of Object.values(sockets)) {
      await socket.next((event) => event.type === 'token.updated');
      await socket.next((event) => event.type === 'combat.updated');
    }
    await expect.poll(async () => (await shown(bob)).token).toEqual(['conditions.prone']);

    // A secret status reaches the GM alone.
    const before = { gm: count(sockets.gm), bob: count(sockets.bob) };
    await secret.change((doc) => doc.getMap('data').set('hunted', true));
    await expect.poll(() => count(sockets.gm)).toBeGreaterThan(before.gm);
    await expect.poll(async () => (await shown(gm)).token).toEqual(['conditions.prone', 'hunted']);
    // Something that is no status tells no one.
    const quiet = { gm: count(sockets.gm), bob: count(sockets.bob) };
    await main.change(() => mapIn(main, 'hp').set('value', 3));
    await expect
      .poll(
        () =>
          (
            t.db.select().from(actors).where(eq(actors.id, goblin.id)).get()?.system.hp as
              { value?: number } | undefined
          )?.value,
      )
      .toBe(3);
    for (const socket of Object.values(sockets)) await socket.flush();
    expect(count(sockets.bob)).toBe(before.bob);
    expect({ gm: count(sockets.gm), bob: count(sockets.bob) }).toEqual(quiet);
    expect((await shown(bob)).token).toEqual(['conditions.prone']);

    await collab.drop();
    for (const socket of Object.values(sockets)) socket.ws.close();
  });
});
