import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import type { ActorView } from '@vtt/shared/api';

import { authHeaders, type Client, type TestApp } from './support/app.js';
import { openCollab } from './support/collab.js';
import { createActorAs, startWithSystems, systemsDir, tableWithPlayer } from './support/systems.js';

const SYSTEMS = ['tiny-d20', 'tiny-pool'];
/** A value that only the secret layer holds; no frame to a player may contain it. */
const MARKER = 'SECRET-6f1c2e-dragon';

let dataDir: string;
let t: TestApp;
let gm: Client;

beforeEach(async () => {
  dataDir = await systemsDir(SYSTEMS);
  ({ t, gm } = await startWithSystems(dataDir, SYSTEMS));
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const contains = (frames: Uint8Array[], text: string) =>
  Buffer.concat(frames).includes(Buffer.from(text));

const text = (doc: Y.Doc, key: string) => doc.getMap('data').get(key) as Y.Text;

describe('secret layer isolation (NFR-08, FR-SHEET-04, T-0503)', () => {
  it('never sends secret bytes to a player socket', async () => {
    const { table, player: bob } = await tableWithPlayer(t, gm, 'tiny-d20', 'bob');
    const actor = await createActorAs(t, bob.client, table.id, 'character', 'Ayla');

    // The owner follows the main document and also tries the secret one.
    const bobSocket = await openCollab(t.app, bob.client);
    const main = await bobSocket.open(actor.main);
    expect((await bobSocket.open(actor.secret)).auth).toEqual({ denied: 'Forbidden' });

    // The GM writes a secret note, then changes the main document while bob listens.
    const gmSocket = await openCollab(t.app, gm);
    const secret = await gmSocket.open(actor.secret);
    const gmMain = await gmSocket.open(actor.main);
    expect(
      await secret.change((doc) => {
        text(doc, 'gmNotes').insert(0, MARKER);
      }),
    ).toBe(true);
    expect(await gmMain.change((doc) => doc.getMap('data').set('str', 15))).toBe(true);
    await expect.poll(() => main.doc.getMap('data').get('str')).toBe(15);
    // Bob opens the secret document again, after it holds the marker.
    expect((await bobSocket.open(actor.secret)).auth).toEqual({ denied: 'Forbidden' });

    // A GM socket opening the document receives the marker, so the check below would see it.
    const gmAgain = await openCollab(t.app, gm);
    await gmAgain.open(actor.secret);
    expect(contains(gmAgain.received, MARKER)).toBe(true);
    expect(contains(bobSocket.received, MARKER)).toBe(false);

    // Stored, the projection holds the secret; the REST view of a player leaves it out.
    await gmSocket.drop();
    await gmAgain.drop();
    const view = async (client: Client) => {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/actors/${actor.id}`,
        headers: authHeaders(client),
      });
      return res.json<{ actor: ActorView }>().actor;
    };
    await expect.poll(async () => (await view(gm)).system.gmNotes).toBe(MARKER);
    const bobView = await view(bob.client);
    expect(bobView.system).toMatchObject({ str: 15 });
    expect(bobView.system).not.toHaveProperty('gmNotes');
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/tables/${table.id}/actors`,
      headers: authHeaders(bob.client),
    });
    expect(list.body).not.toContain(MARKER);
  });

  it('keeps secret fields out of the formulas a player types', async () => {
    const { table, player: bob } = await tableWithPlayer(t, gm, 'tiny-d20', 'bob');
    const actor = await createActorAs(t, bob.client, table.id, 'character', 'Ayla');
    const roll = (client: Client, formula: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/v1/tables/${table.id}/rolls`,
        headers: authHeaders(client),
        payload: { formula, actorId: actor.id },
      });

    // The player reads their own main data, but not the secret note.
    expect((await roll(bob.client, '1d20 + @str')).statusCode).toBe(201);
    expect((await roll(bob.client, '1d20 + @gmNotes')).json()).toMatchObject({
      error: { code: 'invalid_formula', details: { reason: 'unknown_reference' } },
    });
    // The GM's formula does reach it (and fails only because a note is not a number).
    expect((await roll(gm, '1d20 + @gmNotes')).json()).not.toMatchObject({
      error: { details: { reason: 'unknown_reference' } },
    });
  });

  it('has no secret document for a type without secret fields', async () => {
    const { table } = await tableWithPlayer(t, gm, 'tiny-pool', 'bob');
    const actor = await createActorAs(t, gm, table.id, 'character', 'Brask');
    const socket = await openCollab(t.app, gm);
    expect((await socket.open(actor.main)).auth).toEqual({ scope: 'read-write' });
    expect((await socket.open(actor.secret)).auth).toEqual({ denied: 'Forbidden' });
  });
});
