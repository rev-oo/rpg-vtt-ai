import { rm } from 'node:fs/promises';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { ChatMessage } from '@vtt/shared/api';

import { actors, plugins } from '../src/db/schema.js';
import { COLLAB_TIMING } from '../src/realtime/collab.js';

import { authHeaders, type Client, type TestApp } from './support/app.js';
import { openCollab, type CollabDocument } from './support/collab.js';
import { createActorAs, startWithSystems, systemsDir, tableWithPlayer } from './support/systems.js';

const SYSTEMS = ['tiny-d20'];

let dataDir: string;
let t: TestApp;
let gm: Client;

beforeEach(async () => {
  dataDir = await systemsDir(SYSTEMS);
  // Short debounces, so stores (and their repairs) happen within a test.
  ({ t, gm } = await startWithSystems(dataDir, SYSTEMS, {
    collabTiming: { ...COLLAB_TIMING, debounceMs: 20, maxDebounceMs: 100 },
  }));
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** Bob's tiny-d20 character, with bob's and the GM's view of its main document. */
async function character() {
  const { table, player: bob } = await tableWithPlayer(t, gm, 'tiny-d20', 'bob');
  const actor = await createActorAs(t, bob.client, table.id, 'character', 'Ayla');
  const bobMain = await (await openCollab(t.app, bob.client)).open(actor.main);
  const gmMain = await (await openCollab(t.app, gm)).open(actor.main);
  return { actor, bobMain, gmMain };
}

const data = (document: CollabDocument) => document.doc.getMap('data');
const hp = (document: CollabDocument) => (data(document).get('hp') as Y.Map<unknown>).get('value');
const projection = (id: string) =>
  t.db.select({ system: actors.system }).from(actors).where(eq(actors.id, id)).get()?.system;

describe('adjust (FR-SHEET-08, specs §9.5, T-0505)', () => {
  it('adds up concurrent adjustments from two clients', async () => {
    const { actor, bobMain, gmMain } = await character();
    // Both send before either answer arrives.
    bobMain.send({ type: 'adjust', id: 'b1', path: ['hp', 'value'], delta: -3 });
    gmMain.send({ type: 'adjust', id: 'g1', path: ['hp', 'value'], delta: -3 });
    const answers = [await bobMain.next(), await gmMain.next()];
    expect(answers).toEqual([
      expect.objectContaining({ type: 'adjusted', id: 'b1', clamped: false }),
      expect.objectContaining({ type: 'adjusted', id: 'g1', clamped: false }),
    ]);
    // Every copy converges on 10 − 6.
    await expect.poll(() => hp(bobMain)).toBe(4);
    await expect.poll(() => hp(gmMain)).toBe(4);
    await expect.poll(() => (projection(actor.id)?.hp as { value: number }).value).toBe(4);
  });

  it('answers what it cannot adjust', async () => {
    const { bobMain } = await character();
    bobMain.send('not json');
    expect(await bobMain.next()).toEqual({ type: 'error', id: null, code: 'invalid_message' });
    bobMain.send({ type: 'adjust', id: 'x', path: ['hp', 'value'], delta: 'lots' });
    expect(await bobMain.next()).toEqual({ type: 'error', id: null, code: 'invalid_message' });
    for (const path of [['str'], ['hp', 'max'], ['gmNotes'], ['hp']]) {
      bobMain.send({ type: 'adjust', id: path.join('.'), path, delta: 1 });
      expect(await bobMain.next()).toEqual({
        type: 'error',
        id: path.join('.'),
        code: 'not_a_counter',
      });
    }

    // While the system is unavailable the sheet is read-only, adjustments included.
    t.db.update(plugins).set({ enabled: false }).where(eq(plugins.id, 'tiny-d20')).run();
    bobMain.send({ type: 'adjust', id: 'ro', path: ['hp', 'value'], delta: -1 });
    expect(await bobMain.next()).toEqual({ type: 'error', id: 'ro', code: 'read_only' });
    expect(hp(bobMain)).toBe(10);
  });
});

describe('validation on store (FR-SHEET-09, specs §9.7, T-0505)', () => {
  it('replaces invalid values with defaults and tells the editor', async () => {
    const { actor, bobMain, gmMain } = await character();
    expect(
      await bobMain.change((doc) => {
        const map = doc.getMap('data');
        map.set('str', 99);
        map.set('notes', 'a plain string');
        map.set('dex', 12);
      }),
    ).toBe(true);

    expect(await bobMain.next()).toEqual({
      type: 'validation',
      issues: [
        { path: ['str'], reason: 'maximum' },
        { path: ['notes'], reason: 'type' },
      ],
    });
    // Every copy gets the repair; valid changes stay.
    for (const document of [bobMain, gmMain]) {
      await expect.poll(() => data(document).get('str')).toBe(10);
      expect(data(document).get('notes')).toBeInstanceOf(Y.Text);
      expect(data(document).get('dex')).toBe(12);
    }
    await expect.poll(() => projection(actor.id)).toMatchObject({ str: 10, notes: '', dex: 12 });

    // The GM changed nothing, so the GM heard nothing.
    expect(await gmMain.change((doc) => doc.getMap('data').set('dex', 13))).toBe(true);
    await expect.poll(() => projection(actor.id)?.dex).toBe(13);
    await expect(Promise.race([gmMain.next(), settle()])).resolves.toBe('quiet');
  });
});

/** Resolves after the store debounce has long passed. */
const settle = () =>
  new Promise((resolve) =>
    setTimeout(() => {
      resolve('quiet');
    }, 300),
  );

describe('rolls read the live sheet (specs §9.6, T-0509)', () => {
  it('uses edits the store has not saved yet', async () => {
    // The default debounce: the change stays unsaved during the test.
    await t.app.close();
    ({ t } = await startWithSystems(dataDir, SYSTEMS, { db: t.db, admin: gm }));
    const { table, player: bob } = await tableWithPlayer(t, gm, 'tiny-d20', 'lena');
    const actor = await createActorAs(t, bob.client, table.id, 'character', 'Ayla');
    const main = await (await openCollab(t.app, bob.client)).open(actor.main);
    expect(await main.change((doc) => doc.getMap('data').set('str', 18))).toBe(true);
    expect(projection(actor.id)).not.toMatchObject({ str: 18 });

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/tables/${table.id}/rolls`,
      headers: authHeaders(bob.client),
      payload: { formula: '1d20 + @str', actorId: actor.id },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<{ message: ChatMessage }>().message.rolls[0]?.resolved).toBe('1d20 + 18');
  });
});
