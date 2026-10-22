import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { documentName } from '@vtt/shared';

import { createJournalEntry } from '../src/db/repositories/index.js';
import { plugins } from '../src/db/schema.js';
import { MAX_COLLAB_MESSAGE_BYTES } from '../src/realtime/collab.js';

import { authHeaders } from './support/app.js';
import { openCollab, type CollabDocument } from './support/collab.js';
import { setupTable, type TableMember, type TableSetup } from './support/table.js';

/** A character the GM creates, owned by bob and observed by everyone else. */
async function createActor(t: TableSetup, ownership?: Record<string, unknown>): Promise<string> {
  const res = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/actors`, {
    type: 'character',
    name: 'Ayla',
    ownership: ownership ?? { default: 'observer', users: { [t.bob.userId]: 'owner' } },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ actor: { id: string } }>().actor.id;
}

const actorDoc = (id: string, layer: 'main' | 'secret' = 'main') =>
  documentName({ kind: 'actor', id, layer });

async function openAs(t: TableSetup, who: TableMember, name: string): Promise<CollabDocument> {
  const socket = await openCollab(t.app, who.client);
  return socket.open(name);
}

const setHp = (hp: number) => (doc: Y.Doc) => {
  doc.getMap('data').set('hp', hp);
};

describe('connecting to /ws/collab (§10.3)', () => {
  it('needs a session and a same-origin page', async () => {
    const t = await setupTable();
    await expect(openCollab(t.app, null)).rejects.toThrow('401');
    await expect(
      openCollab(t.app, t.gm.client, {
        origin: 'https://evil.example.com',
        host: 'localhost:3000',
      }),
    ).rejects.toThrow('403');
    const socket = await openCollab(t.app, t.gm.client, { origin: 'http://localhost:3000' });
    socket.ws.close();
  });

  it('closes the socket on a frame over 1 MiB', async () => {
    const t = await setupTable();
    const socket = await openCollab(t.app, t.gm.client);
    socket.ws.send(new Uint8Array(MAX_COLLAB_MESSAGE_BYTES + 1));
    expect(await socket.closed).toBe(1009);
  });

  it('closes every socket on shutdown', async () => {
    const t = await setupTable();
    const socket = await openCollab(t.app, t.gm.client);
    expect((await socket.open(actorDoc(await createActor(t)))).auth).toEqual({
      scope: 'read-write',
    });
    await t.app.close();
    expect(await socket.closed).toBe(1001);
  });
});

describe('document access (§9.3)', () => {
  it('rejects documents a user may not open, and logs the denial', async () => {
    const t = await setupTable();
    const actorId = await createActor(t);
    const hidden = createJournalEntry(
      t.db,
      { tableId: t.table.id, title: 'Plot', hidden: true },
      new Date(),
    );
    const denied = [
      // Not a member of the table.
      [t.eve, actorDoc(actorId)],
      // Players never open the secret layer, even of their own actor.
      [t.bob, actorDoc(actorId, 'secret')],
      [t.carol, documentName({ kind: 'journal', id: hidden.id, layer: 'main' })],
      // Unknown entities and names that are not document names.
      [t.gm, actorDoc(randomUUID())],
      [t.gm, `actor:${actorId}:gm`],
      [t.gm, `table:${t.table.id}:main`],
      [t.gm, ''],
    ] as const;

    for (const [who, name] of denied) {
      const document = await openAs(t, who, name);
      expect(document.auth, name).toEqual({ denied: 'Forbidden' });
      // Nothing of the document reaches the client: the denial is the only frame.
      expect(document.frames).toHaveLength(1);
      expect(document.doc.getMap('data').size).toBe(0);
    }
    const logged = t.logs.lines.filter((line) => line.msg === 'collab access denied');
    expect(logged).toHaveLength(denied.length);
    expect(logged[0]).toMatchObject({
      level: 40,
      userId: t.eve.userId,
      documentName: actorDoc(actorId),
      reason: 'none',
    });
  });

  it('rejects a document whose entity is in the trash', async () => {
    const t = await setupTable();
    const actorId = await createActor(t);
    expect((await t.call(t.gm.client, 'DELETE', `/actors/${actorId}`)).statusCode).toBe(204);
    expect((await openAs(t, t.gm, actorDoc(actorId))).auth).toEqual({ denied: 'Forbidden' });
  });

  it('grants writes to owners, GMs and assistants, and reads to observers', async () => {
    const t = await setupTable();
    const actorId = await createActor(t);
    const entry = createJournalEntry(t.db, { tableId: t.table.id, title: 'Lore' }, new Date());
    const journal = documentName({ kind: 'journal', id: entry.id, layer: 'main' });
    const expected = [
      [t.gm, actorDoc(actorId), 'read-write'],
      [t.gm, actorDoc(actorId, 'secret'), 'read-write'],
      [t.bob, actorDoc(actorId), 'read-write'],
      [t.carol, actorDoc(actorId), 'readonly'],
      // Spectators are observers at most.
      [t.dave, actorDoc(actorId), 'readonly'],
      [t.gm, journal, 'read-write'],
      [t.bob, journal, 'readonly'],
    ] as const;
    for (const [who, name, scope] of expected) {
      expect((await openAs(t, who, name)).auth, `${who.userId} ${name}`).toEqual({ scope });
    }
  });

  it('applies updates from writers and drops updates from observers', async () => {
    const t = await setupTable();
    const name = actorDoc(await createActor(t));
    const gm = await openAs(t, t.gm, name);
    const owner = await openAs(t, t.bob, name);
    const observer = await openAs(t, t.carol, name);

    expect(await owner.change(setHp(7))).toBe(true);
    await expect.poll(() => gm.doc.getMap('data').get('hp')).toBe(7);
    await expect.poll(() => observer.doc.getMap('data').get('hp')).toBe(7);

    // The observer's change stays on its own copy: the server refuses it.
    expect(await observer.change(setHp(99))).toBe(false);
    expect(await gm.change(setHp(8))).toBe(true);
    await expect.poll(() => owner.doc.getMap('data').get('hp')).toBe(8);
    // A fresh copy shows what the server holds.
    const fresh = await openAs(t, t.gm, name);
    expect(fresh.doc.getMap('data').get('hp')).toBe(8);
    expect(fresh.doc.getMap('data').toJSON()).not.toHaveProperty('notes');
  });

  it('re-checks access on every update', async () => {
    const t = await setupTable();
    const actorId = await createActor(t);
    const owner = await openAs(t, t.bob, actorDoc(actorId));
    expect(await owner.change(setHp(5))).toBe(true);

    const setOwnership = async (ownership: Record<string, unknown>) => {
      const res = await t.call(t.gm.client, 'PATCH', `/actors/${actorId}`, { ownership });
      expect(res.statusCode).toBe(200);
    };
    // Demoted to observer: updates are dropped from now on.
    await setOwnership({ default: 'observer', users: {} });
    expect(await owner.change(setHp(6))).toBe(false);

    // No access at all: the server closes the document.
    await setOwnership({ default: 'none', users: {} });
    void owner.change(setHp(7)).catch(() => undefined);
    expect(await owner.closed).toBe('Forbidden');
    expect(t.logs.lines.filter((line) => line.msg === 'collab access denied').at(-1)).toMatchObject(
      { userId: t.bob.userId, reason: 'none' },
    );
  });

  it('makes documents read-only while the table system is unavailable (FR-PLUGIN-07)', async () => {
    const t = await setupTable();
    const name = actorDoc(await createActor(t));
    t.db.update(plugins).set({ enabled: false }).where(eq(plugins.id, 'test-system')).run();
    const gm = await openAs(t, t.gm, name);
    expect(gm.auth).toEqual({ scope: 'readonly' });
    expect(await gm.change(setHp(1))).toBe(false);
  });

  it('closes documents once the session ends', async () => {
    const t = await setupTable();
    const owner = await openAs(t, t.bob, actorDoc(await createActor(t)));
    const logout = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authHeaders(t.bob.client),
    });
    expect(logout.statusCode).toBe(204);
    void owner.change(setHp(2)).catch(() => undefined);
    expect(await owner.closed).toBe('Unauthorized');
  });
});
