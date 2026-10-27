import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { actorHistoryResponseSchema } from '@vtt/shared/api';

import { actorSnapshots } from '../src/db/schema.js';
import {
  decodeSnapshot,
  listSnapshots,
  MAX_SNAPSHOTS,
  recordSnapshot,
  SNAPSHOT_INTERVAL_MS,
} from '../src/domain/history.js';
import { COLLAB_TIMING } from '../src/realtime/collab.js';

import { authHeaders, createUserClient, type Client, type TestApp } from './support/app.js';
import { openCollab, type CollabDocument } from './support/collab.js';
import { createActorAs, startWithSystems, systemsDir, tableWithPlayer } from './support/systems.js';

// T-0806 (FR-SHEET-11, ADR-053): snapshots of actor documents, listed and restored.

const SYSTEMS = ['tiny-d20'];

let dataDir: string;
let t: TestApp;
let gm: Client;
let clock: Date;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

beforeEach(async () => {
  clock = new Date('2026-03-01T12:00:00Z');
  dataDir = await systemsDir(SYSTEMS);
  ({ t, gm } = await startWithSystems(dataDir, SYSTEMS, {
    collabTiming: { ...COLLAB_TIMING, debounceMs: 20, maxDebounceMs: 100 },
    now: () => clock,
  }));
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const data = (document: CollabDocument) => document.doc.getMap('data');
const count = () => t.db.select().from(actorSnapshots).all().length;

async function character() {
  const { table, player: bob } = await tableWithPlayer(t, gm, 'tiny-d20', 'bob');
  const actor = await createActorAs(t, bob.client, table.id, 'character', 'Ayla');
  return { table, bob, actor };
}

const history = async (client: Client, actorId: string) => {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/v1/actors/${actorId}/history`,
    headers: authHeaders(client),
  });
  return {
    status: res.statusCode,
    body: res.statusCode === 200 ? res.json<unknown>() : undefined,
  };
};
const snapshotsOf = async (client: Client, actorId: string) => {
  const { status, body } = await history(client, actorId);
  expect(status).toBe(200);
  return actorHistoryResponseSchema.parse(body).snapshots;
};
const restore = (client: Client, actorId: string, snapshotId: string) =>
  t.app.inject({
    method: 'POST',
    url: `/api/v1/actors/${actorId}/history/${snapshotId}/restore`,
    headers: authHeaders(client),
  });

describe('taking snapshots (T-0806)', () => {
  it('takes one at most every 5 minutes, skips unchanged data and keeps the newest 50', async () => {
    const { actor } = await character();
    const doc = new Y.Doc();
    const map = doc.getMap('data');
    const ref = { actorId: actor.id, layer: 'main' as const };
    const take = (str: number) => {
      map.set('str', str);
      recordSnapshot(t.db, ref, map, clock);
    };

    take(1);
    advance(SNAPSHOT_INTERVAL_MS - 1);
    take(2);
    expect(listSnapshots(t.db, actor.id, ['main'])).toHaveLength(1);
    advance(1);
    recordSnapshot(t.db, ref, map, clock);
    // Still 1 = str 1: the wait is over, so str 2 is kept now.
    expect(listSnapshots(t.db, actor.id, ['main'])).toHaveLength(2);
    advance(SNAPSHOT_INTERVAL_MS);
    recordSnapshot(t.db, ref, map, clock);
    expect(listSnapshots(t.db, actor.id, ['main'])).toHaveLength(2);

    for (let str = 3; str < 3 + MAX_SNAPSHOTS + 5; str += 1) {
      advance(SNAPSHOT_INTERVAL_MS);
      take(str);
    }
    const kept = listSnapshots(t.db, actor.id, ['main']);
    expect(kept).toHaveLength(MAX_SNAPSHOTS);
    const values = kept.map((row) => {
      const { doc: copy, data: copied } = decodeSnapshot(row.state);
      const str = copied.get('str');
      copy.destroy();
      return str;
    });
    // Newest first, the oldest rotated out.
    expect(values[0]).toBe(2 + MAX_SNAPSHOTS + 5);
    expect(values.at(-1)).toBe(8);
  });

  it('snapshots documents as the server stores them', async () => {
    const { bob, actor } = await character();
    const main = await (await openCollab(t.app, bob.client)).open(actor.main);
    await main.change((doc) => doc.getMap('data').set('str', 15));
    await expect.poll(count).toBe(1);
    await main.change((doc) => doc.getMap('data').set('str', 16));
    advance(SNAPSHOT_INTERVAL_MS);
    await main.change((doc) => doc.getMap('data').set('str', 17));
    await expect.poll(count).toBe(2);
  });
});

describe('listing and restoring (T-0806)', () => {
  /** Ayla with main snapshots at str 15 then 17, and a secret one with GM notes. */
  async function withHistory() {
    const found = await character();
    const bobMain = await (await openCollab(t.app, found.bob.client)).open(found.actor.main);
    const gmSocket = await openCollab(t.app, gm);
    const gmMain = await gmSocket.open(found.actor.main);
    const gmSecret = await gmSocket.open(found.actor.secret);
    await bobMain.change((doc) => doc.getMap('data').set('str', 15));
    await expect.poll(count).toBe(1);
    advance(SNAPSHOT_INTERVAL_MS);
    await bobMain.change((doc) => doc.getMap('data').set('str', 17));
    await gmSecret.change((doc) => {
      const notes = doc.getMap('data').get('gmNotes');
      if (notes instanceof Y.Text) notes.insert(0, 'Is a spy.');
      else doc.getMap('data').set('gmNotes', 'Is a spy.');
    });
    await expect.poll(count).toBe(3);
    return { ...found, bobMain, gmMain, gmSecret };
  }

  it('lists main snapshots to owners and secret ones to GMs only', async () => {
    const { actor, bob, table } = await withHistory();
    const mine = await snapshotsOf(bob.client, actor.id);
    expect(mine.map((s) => s.layer)).toEqual(['main', 'main']);
    const all = await snapshotsOf(gm, actor.id);
    expect(all.map((s) => s.layer).sort()).toEqual(['main', 'main', 'secret']);

    // Another player only observes Ayla, or does not see her at all.
    const carol = await createUserClient(t.app, gm, 'carol');
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
      headers: authHeaders(carol.client),
    });
    expect((await history(carol.client, actor.id)).status).toBe(404);
    const secret = all.find((s) => s.layer === 'secret');
    expect((await restore(bob.client, actor.id, secret?.id ?? 'x')).statusCode).toBe(404);
  });

  it('restores a snapshot into open sheets, keeping what it replaced', async () => {
    const { actor, bob, bobMain, gmMain } = await withHistory();
    const [newest, oldest] = await snapshotsOf(bob.client, actor.id);
    expect(newest).toBeDefined();
    advance(1000);
    const res = await restore(bob.client, actor.id, oldest?.id ?? 'x');
    expect(res.statusCode, res.body).toBe(204);

    await expect.poll(() => data(bobMain).get('str')).toBe(15);
    await expect.poll(() => data(gmMain).get('str')).toBe(15);
    // The replaced state (str 17) was already the newest snapshot, so none was added; it
    // undoes the restore.
    expect(await snapshotsOf(bob.client, actor.id)).toHaveLength(2);
    const undo = await restore(bob.client, actor.id, newest?.id ?? 'x');
    expect(undo.statusCode).toBe(204);
    await expect.poll(() => data(gmMain).get('str')).toBe(17);
  });

  it('keeps an unsaved state before restoring over it', async () => {
    const { actor, bob, bobMain } = await withHistory();
    const [, oldest] = await snapshotsOf(bob.client, actor.id);
    await bobMain.change((doc) => doc.getMap('data').set('str', 18));
    const res = await restore(bob.client, actor.id, oldest?.id ?? 'x');
    expect(res.statusCode).toBe(204);
    await expect.poll(() => data(bobMain).get('str')).toBe(15);
    expect(await snapshotsOf(bob.client, actor.id)).toHaveLength(3);
  });
});
