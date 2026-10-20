import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { ActorView, ChatMessage, ChatSendInput } from '@vtt/shared/api';

import { createChatMessage, listChatMessages } from '../src/db/repositories/index.js';
import { members } from '../src/db/schema.js';

import type { Client } from './support/app.js';
import { openSocket, type TestSocket } from './support/socket.js';
import { setupTable, type TableMember, type TableSetup } from './support/table.js';

const post = (t: TableSetup, who: TableMember, payload: Record<string, unknown>) =>
  t.call(who.client, 'POST', `/tables/${t.table.id}/messages`, payload);

async function history(t: TableSetup, client: Client, query = '') {
  const res = await t.call(client, 'GET', `/tables/${t.table.id}/messages${query}`);
  expect(res.statusCode).toBe(200);
  return res.json<{ messages: ChatMessage[]; nextCursor: string | null }>();
}

const texts = async (t: TableSetup, client: Client) =>
  (await history(t, client)).messages.map((m) => m.text);

/** A public message, a whisper from Bob to Carol, and a secret message from Bob to the GM. */
async function conversation(t: TableSetup) {
  for (const payload of [
    { text: 'hello all' },
    { text: 'psst carol', audience: 'whisper', recipientIds: [t.carol.userId] },
    { text: 'secret plan', audience: 'gm' },
  ]) {
    expect((await post(t, t.bob, payload)).statusCode).toBe(201);
  }
}

describe('chat history (T-0205, FR-CHAT-02, 07)', () => {
  it('filters whispers and GM messages by audience', async () => {
    const t = await setupTable();
    await conversation(t);

    expect(await texts(t, t.bob.client)).toEqual(['secret plan', 'psst carol', 'hello all']);
    expect(await texts(t, t.carol.client)).toEqual(['psst carol', 'hello all']);
    // Whispers are private even from the GM (§10.2).
    expect(await texts(t, t.gm.client)).toEqual(['secret plan', 'hello all']);
    expect(await texts(t, t.dave.client)).toEqual(['hello all']);
    expect((await t.call(t.eve.client, 'GET', `/tables/${t.table.id}/messages`)).statusCode).toBe(
      404,
    );

    // Assistants see GM messages too.
    t.db.update(members).set({ role: 'assistant' }).where(eq(members.userId, t.carol.userId)).run();
    expect(await texts(t, t.carol.client)).toEqual(['secret plan', 'psst carol', 'hello all']);
  });

  it('filters in the query, so a page is never short', async () => {
    const t = await setupTable();
    const at = new Date('2026-03-01T12:00:00Z');
    const speaker = { name: 'Bob', actorId: null, imageUrl: null };
    const base = { tableId: t.table.id, senderId: t.bob.userId, speaker, kind: 'text' } as const;
    createChatMessage(t.db, { ...base, audience: 'public', text: 'visible' }, at);
    for (let i = 0; i < 5; i++) {
      createChatMessage(
        t.db,
        { ...base, audience: 'whisper', recipients: [t.gm.userId], text: 'hidden' },
        new Date(at.getTime() + i + 1),
      );
    }
    const page = listChatMessages(
      t.db,
      t.table.id,
      { userId: t.carol.userId, role: 'player' },
      { limit: 1 },
    );
    expect(page.map((m) => m.text)).toEqual(['visible']);
  });

  it('pages through history newest first, 50 at a time', async () => {
    const t = await setupTable();
    for (let i = 0; i < 120; i++) {
      // The clock stands still: send order alone decides the history order.
      await post(t, t.bob, { text: `message ${String(i)}` });
    }

    const pages: string[][] = [];
    let cursor: string | null = null;
    do {
      const page = await history(t, t.gm.client, cursor ? `?before=${cursor}` : '');
      pages.push(page.messages.map((m) => m.text));
      cursor = page.nextCursor;
    } while (cursor);

    expect(pages.map((p) => p.length)).toEqual([50, 50, 20]);
    const all = pages.flat();
    expect(new Set(all).size).toBe(120);
    expect(all[0]).toBe('message 119');

    const small = await history(t, t.gm.client, '?limit=10');
    expect(small.messages).toHaveLength(10);
    for (const query of ['?limit=0', '?limit=101', '?before=bm9wZQ']) {
      const res = await t.call(t.gm.client, 'GET', `/tables/${t.table.id}/messages${query}`);
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('posting messages (FR-CHAT-01, 02)', () => {
  it('snapshots the speaker: the user, or an actor they own', async () => {
    const t = await setupTable();
    const hero = (
      await t.call(t.bob.client, 'POST', `/tables/${t.table.id}/actors`, {
        type: 'character',
        name: 'Bob the Brave',
        imageUrl: 'https://img.example.com/bob.png',
      })
    ).json<{ actor: ActorView }>().actor;

    const asUser = await post(t, t.bob, { text: 'hi' });
    expect(asUser.json()).toMatchObject({
      message: {
        senderId: t.bob.userId,
        speaker: { name: 'bob', actorId: null, imageUrl: null },
        audience: 'public',
        recipientIds: [],
        kind: 'text',
        rolls: [],
        card: null,
      },
    });
    const asActor = await post(t, t.bob, { text: 'For glory!', actorId: hero.id });
    expect(asActor.json()).toMatchObject({
      message: { speaker: { name: 'Bob the Brave', actorId: hero.id, imageUrl: hero.imageUrl } },
    });
    // GMs own every actor (FR-ENT-03).
    expect((await post(t, t.gm, { text: 'Puppet', actorId: hero.id })).statusCode).toBe(201);

    // Renaming the actor later does not rewrite history.
    await t.call(t.bob.client, 'PATCH', `/actors/${hero.id}`, { name: 'Bob the Bold' });
    const [, forGlory] = (await history(t, t.bob.client)).messages;
    expect(forGlory).toMatchObject({ text: 'For glory!', speaker: { name: 'Bob the Brave' } });

    for (const actorId of [hero.id, '11111111-1111-4111-8111-111111111111']) {
      const res = await post(t, t.carol, { text: 'Impostor', actorId });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'invalid_speaker' } });
    }
  });

  it('checks who may post and to whom', async () => {
    const t = await setupTable();
    expect((await post(t, t.dave, { text: 'hi' })).statusCode).toBe(403);
    expect((await post(t, t.eve, { text: 'hi' })).statusCode).toBe(404);
    expect((await post(t, t.bob, { text: '   ' })).statusCode).toBe(400);
    expect((await post(t, t.bob, { text: 'x', audience: 'whisper' })).statusCode).toBe(400);

    for (const recipientIds of [[t.eve.userId], [t.bob.userId]]) {
      const res = await post(t, t.bob, { text: 'x', audience: 'whisper', recipientIds });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'invalid_recipient' } });
    }

    const res = await post(t, t.bob, {
      text: 'to both',
      audience: 'whisper',
      recipientIds: [t.carol.userId, t.gm.userId, t.carol.userId, t.bob.userId],
    });
    expect(res.json()).toMatchObject({ message: { recipientIds: [t.carol.userId, t.gm.userId] } });
    // Recipients only matter for whispers.
    const pub = await post(t, t.bob, { text: 'all', recipientIds: [t.carol.userId] });
    expect(pub.json()).toMatchObject({ message: { recipientIds: [] } });
  });
});

describe('chat on the wire (T-0206, NFR-08)', () => {
  async function listeners(t: TableSetup) {
    const sockets: Record<'gm' | 'bob' | 'carol' | 'dave', TestSocket> = {
      gm: await openSocket(t.app, t.gm.client),
      bob: await openSocket(t.app, t.bob.client),
      carol: await openSocket(t.app, t.carol.client),
      dave: await openSocket(t.app, t.dave.client),
    };
    for (const socket of Object.values(sockets)) {
      await socket.request({ type: 'subscribe', tableId: t.table.id });
    }
    return sockets;
  }

  /** What each socket received, once everything sent so far has been delivered. */
  async function heard(sockets: Record<string, TestSocket>) {
    await Promise.all(Object.values(sockets).map((s) => s.flush()));
    return Object.fromEntries(
      Object.entries(sockets).map(([name, s]) => [
        name,
        s.ofType('chat.message').map((e) => e.payload.message.text),
      ]),
    );
  }

  it('delivers each audience only to permitted sockets', async () => {
    const t = await setupTable();
    const sockets = await listeners(t);
    const send = (payload: ChatSendInput) =>
      sockets.bob.request({ type: 'chat.send', tableId: t.table.id, payload });

    expect((await send({ text: 'hello all' })).type).toBe('ack');
    await send({ text: 'psst carol', audience: 'whisper', recipientIds: [t.carol.userId] });
    await send({ text: 'secret plan', audience: 'gm' });

    expect(await heard(sockets)).toEqual({
      gm: ['hello all', 'secret plan'],
      bob: ['hello all', 'psst carol', 'secret plan'],
      carol: ['hello all', 'psst carol'],
      dave: ['hello all'],
    });
    // Nothing of a hidden message reaches the wire, not even its id.
    const secretId = sockets.bob.ofType('chat.message')[2]?.payload.message.id ?? 'missing';
    for (const socket of [sockets.carol, sockets.dave]) {
      expect(JSON.stringify(socket.received)).not.toContain('secret plan');
      expect(JSON.stringify(socket.received)).not.toContain(secretId);
    }
  });

  it('fans out messages posted over REST as well', async () => {
    const t = await setupTable();
    const sockets = await listeners(t);
    await conversation(t);
    expect(await heard(sockets)).toEqual({
      gm: ['hello all', 'secret plan'],
      bob: ['hello all', 'psst carol', 'secret plan'],
      carol: ['hello all', 'psst carol'],
      dave: ['hello all'],
    });
  });

  it('answers refused messages with an error and sends nothing', async () => {
    const t = await setupTable();
    const sockets = await listeners(t);
    const eve = await openSocket(t.app, t.eve.client);
    const tableId = t.table.id;

    const spectator = await sockets.dave.request({
      type: 'chat.send',
      tableId,
      payload: { text: 'x' },
    });
    expect(spectator).toMatchObject({ type: 'error', payload: { code: 'forbidden' } });
    const outsider = await eve.request({ type: 'chat.send', tableId, payload: { text: 'x' } });
    expect(outsider).toMatchObject({ type: 'error', payload: { code: 'not_found' } });
    const invalid = await sockets.bob.request({
      type: 'chat.send',
      tableId,
      payload: { text: '' },
    });
    expect(invalid).toMatchObject({ type: 'error', payload: { code: 'invalid_message' } });

    expect(await heard(sockets)).toEqual({ gm: [], bob: [], carol: [], dave: [] });
  });
});
