import { describe, expect, it } from 'vitest';

import { CHAT_EDIT_WINDOW_MS } from '@vtt/shared';
import type { ChatMessage } from '@vtt/shared/api';

import type { Client } from './support/app.js';
import { openSocket } from './support/socket.js';
import { setupTable, type TableMember, type TableSetup } from './support/table.js';

// T-0805 (FR-CHAT-09, ADR-052): authors edit or delete their text messages for 5 minutes;
// GMs and assistants delete any message they can see.

async function send(t: TableSetup, who: TableMember, payload: Record<string, unknown>) {
  const res = await t.call(who.client, 'POST', `/tables/${t.table.id}/messages`, payload);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ message: ChatMessage }>().message;
}

async function roll(t: TableSetup, who: TableMember) {
  const res = await t.call(who.client, 'POST', `/tables/${t.table.id}/rolls`, { formula: '1d4' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ message: ChatMessage }>().message;
}

const editAs = (t: TableSetup, client: Client, id: string, text = 'changed') =>
  t.call(client, 'PATCH', `/messages/${id}`, { text });
const deleteAs = (t: TableSetup, client: Client, id: string) =>
  t.call(client, 'DELETE', `/messages/${id}`);

async function texts(t: TableSetup, client: Client) {
  const res = await t.call(client, 'GET', `/tables/${t.table.id}/messages`);
  return res.json<{ messages: ChatMessage[] }>().messages.map((m) => m.text);
}

describe('editing messages (T-0805)', () => {
  it('lets the author edit their text message for 5 minutes', async () => {
    const t = await setupTable();
    const message = await send(t, t.bob, { text: 'helo' });
    expect(message.editedAt).toBeNull();
    t.advanceMs(CHAT_EDIT_WINDOW_MS - 1000);

    const res = await editAs(t, t.bob.client, message.id, ' hello ');
    expect(res.statusCode).toBe(200);
    const edited = res.json<{ message: ChatMessage }>().message;
    expect(edited).toMatchObject({ id: message.id, text: 'hello', createdAt: message.createdAt });
    expect(edited.editedAt).not.toBeNull();
    expect(await texts(t, t.carol.client)).toEqual(['hello']);
  });

  it('refuses others, rolls, late edits and empty text', async () => {
    const t = await setupTable();
    const message = await send(t, t.bob, { text: 'mine' });
    expect((await editAs(t, t.carol.client, message.id)).statusCode).toBe(403);
    expect((await editAs(t, t.gm.client, message.id)).statusCode).toBe(403);
    expect((await editAs(t, t.eve.client, message.id)).statusCode).toBe(404);
    expect((await editAs(t, t.bob.client, message.id, '  ')).statusCode).toBe(400);
    const rolled = await roll(t, t.bob);
    expect((await editAs(t, t.bob.client, rolled.id)).statusCode).toBe(403);

    t.advanceMs(CHAT_EDIT_WINDOW_MS);
    expect((await editAs(t, t.bob.client, message.id)).statusCode).toBe(403);
    expect(await texts(t, t.bob.client)).toEqual(['1d4', 'mine']);
  });
});

describe('deleting messages (T-0805)', () => {
  it('lets the author delete their text message for 5 minutes', async () => {
    const t = await setupTable();
    const early = await send(t, t.bob, { text: 'oops' });
    const late = await send(t, t.bob, { text: 'keep' });
    const rolled = await roll(t, t.bob);
    expect((await deleteAs(t, t.carol.client, early.id)).statusCode).toBe(403);
    expect((await deleteAs(t, t.bob.client, rolled.id)).statusCode).toBe(403);
    expect((await deleteAs(t, t.bob.client, early.id)).statusCode).toBe(204);
    expect((await deleteAs(t, t.bob.client, early.id)).statusCode).toBe(404);

    t.advanceMs(CHAT_EDIT_WINDOW_MS);
    expect((await deleteAs(t, t.bob.client, late.id)).statusCode).toBe(403);
    expect(await texts(t, t.carol.client)).toEqual(['1d4', 'keep']);
  });

  it('lets the GM delete any message they can see, at any time', async () => {
    const t = await setupTable();
    const said = await send(t, t.bob, { text: 'rude' });
    const rolled = await roll(t, t.carol);
    const whisper = await send(t, t.bob, {
      text: 'between us',
      audience: 'whisper',
      recipientIds: [t.carol.userId],
    });
    t.advanceMs(CHAT_EDIT_WINDOW_MS * 10);
    expect((await deleteAs(t, t.gm.client, said.id)).statusCode).toBe(204);
    expect((await deleteAs(t, t.gm.client, rolled.id)).statusCode).toBe(204);
    // The GM never saw the whisper, so it does not exist for them.
    expect((await deleteAs(t, t.gm.client, whisper.id)).statusCode).toBe(404);
    expect(await texts(t, t.carol.client)).toEqual(['between us']);
  });
});

describe('edits and deletes on the wire (T-0805)', () => {
  it('sends edits live to the message’s audience only', async () => {
    const t = await setupTable();
    const sockets = await Promise.all(
      [t.gm, t.carol, t.dave].map(async (who) => {
        const socket = await openSocket(t.app, who.client);
        await socket.request({ type: 'subscribe', tableId: t.table.id });
        return socket;
      }),
    );
    const [gm, carol, dave] = sockets;
    if (!gm || !carol || !dave) throw new Error('no sockets');
    const open = await send(t, t.bob, { text: 'hi' });
    const whisper = await send(t, t.bob, {
      text: 'psst',
      audience: 'whisper',
      recipientIds: [t.carol.userId],
    });
    await editAs(t, t.bob.client, open.id, 'hi all');
    await editAs(t, t.bob.client, whisper.id, 'psst, carol');

    const updates = async (socket: typeof gm) => {
      await socket.flush();
      return socket.ofType('chat.updated').map((e) => e.payload.message.text);
    };
    expect(await updates(carol)).toEqual(['hi all', 'psst, carol']);
    expect(await updates(gm)).toEqual(['hi all']);
    expect(await updates(dave)).toEqual(['hi all']);
    for (const socket of sockets) socket.ws.close();
  });

  it('removes a deleted whisper for its recipients too', async () => {
    const t = await setupTable();
    const carol = await openSocket(t.app, t.carol.client);
    const dave = await openSocket(t.app, t.dave.client);
    for (const socket of [carol, dave]) {
      await socket.request({ type: 'subscribe', tableId: t.table.id });
    }
    const whisper = await send(t, t.bob, {
      text: 'psst',
      audience: 'whisper',
      recipientIds: [t.carol.userId],
    });
    expect((await deleteAs(t, t.bob.client, whisper.id)).statusCode).toBe(204);

    await carol.flush();
    expect(carol.ofType('chat.deleted').map((e) => e.payload.id)).toEqual([whisper.id]);
    expect(await texts(t, t.carol.client)).toEqual([]);
    await dave.flush();
    expect(JSON.stringify(dave.received)).not.toContain(whisper.id);
    carol.ws.close();
    dave.ws.close();
  });
});
