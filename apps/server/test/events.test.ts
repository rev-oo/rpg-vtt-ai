import { describe, expect, it } from 'vitest';

import type { ActorView, ItemView } from '@vtt/shared/api';

import { members } from '../src/db/schema.js';
import { SESSION_ENDED } from '../src/realtime/hub.js';

import { authHeaders, createTable } from './support/app.js';
import { openSocket, type TestSocket } from './support/socket.js';
import { setupTable, type TableSetup } from './support/table.js';

async function subscribed(t: TableSetup, who: TableSetup['gm']): Promise<TestSocket> {
  const socket = await openSocket(t.app, who.client);
  const ack = await socket.request({ type: 'subscribe', tableId: t.table.id });
  expect(ack.type).toBe('ack');
  return socket;
}

const changesOf = (socket: TestSocket) =>
  socket.ofType('entity.changed').map((e) => `${e.payload.kind}:${e.payload.change}`);

describe('connecting to /ws/events (§10.2)', () => {
  it('needs a session and a same-origin page', async () => {
    const t = await setupTable();
    await expect(openSocket(t.app, null)).rejects.toThrow('401');
    await expect(
      openSocket(t.app, t.gm.client, {
        origin: 'https://evil.example.com',
        host: 'localhost:3000',
      }),
    ).rejects.toThrow('403');

    // The instance's own page, directly or through a dev proxy on the same host.
    for (const headers of [
      { origin: 'http://localhost:3000' },
      { origin: 'http://localhost:5173', host: 'localhost:5173' },
    ]) {
      const socket = await openSocket(t.app, t.gm.client, headers);
      socket.ws.close();
    }
  });

  it('validates every message against the envelope', async () => {
    const t = await setupTable();
    const socket = await openSocket(t.app, t.gm.client);
    const errorCode = async () => {
      const event = await socket.next((e) => e.type === 'error');
      return event.type === 'error' ? event.payload : undefined;
    };

    socket.sendRaw('not json');
    expect(await errorCode()).toMatchObject({ code: 'invalid_message', replyTo: null });

    socket.sendRaw(JSON.stringify({ v: 2, id: 'x1', type: 'subscribe' }));
    expect(await errorCode()).toMatchObject({
      code: 'unsupported_version',
      replyTo: 'x1',
      supportedVersions: [1],
    });

    socket.sendRaw(JSON.stringify({ v: 1, id: 'x2', type: 'subscribe', tableId: 'nope' }));
    expect(await errorCode()).toMatchObject({ code: 'invalid_message', replyTo: 'x2' });

    socket.sendRaw(JSON.stringify({ v: 1, id: 'x3', type: 'teleport' }));
    expect(await errorCode()).toMatchObject({ code: 'invalid_message', replyTo: 'x3' });

    socket.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    expect(await errorCode()).toMatchObject({ code: 'invalid_message' });

    const roll = await socket.request({
      type: 'roll.request',
      tableId: t.table.id,
      payload: { formula: '1 +' },
    });
    expect(roll).toMatchObject({ type: 'error', payload: { code: 'invalid_formula' } });
    // Still usable after errors.
    expect((await socket.request({ type: 'presence.ping' })).type).toBe('ack');
  });

  it('only subscribes members', async () => {
    const t = await setupTable();
    const socket = await openSocket(t.app, t.eve.client);
    const res = await socket.request({ type: 'subscribe', tableId: t.table.id });
    expect(res).toMatchObject({ type: 'error', payload: { code: 'not_found' } });
  });
});

describe('entity.changed fan-out (T-0203, T-0204, FR-ENT-07)', () => {
  it('reaches subscribers of the table only', async () => {
    const t = await setupTable();
    const gm = await subscribed(t, t.gm);
    const bob = await subscribed(t, t.bob);
    // Eve runs her own table and listens to it.
    const evesTable = await createTable(t.app, t.eve.client, { name: 'Elsewhere' });
    const eve = await openSocket(t.app, t.eve.client);
    await eve.request({ type: 'subscribe', tableId: evesTable.id });
    // Carol is a member but did not subscribe.
    const carol = await openSocket(t.app, t.carol.client);

    const res = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/actors`, {
      type: 'npc',
      name: 'Goblin',
      ownership: { default: 'observer', users: {} },
    });
    const goblin = res.json<{ actor: ActorView }>().actor;

    const event = await bob.next((e) => e.type === 'entity.changed');
    expect(event).toMatchObject({
      v: 1,
      tableId: t.table.id,
      payload: { kind: 'actor', id: goblin.id, change: 'created', actorId: null },
    });
    await gm.next((e) => e.type === 'entity.changed');
    await Promise.all([eve.flush(), carol.flush()]);
    expect(changesOf(eve)).toEqual([]);
    expect(changesOf(carol)).toEqual([]);
  });

  it('follows actor visibility, including members who just lost it', async () => {
    const t = await setupTable();
    const bob = await subscribed(t, t.bob);
    const carol = await subscribed(t, t.carol);
    const dave = await subscribed(t, t.dave);

    const created = await t.call(t.bob.client, 'POST', `/tables/${t.table.id}/actors`, {
      type: 'character',
      name: 'Bob the Brave',
    });
    const hero = created.json<{ actor: ActorView }>().actor;
    const url = `/actors/${hero.id}`;
    await t.call(t.gm.client, 'PATCH', url, {
      ownership: { default: 'observer', users: { [t.bob.userId]: 'owner' } },
    });
    await t.call(t.bob.client, 'PATCH', url, { name: 'Bob the Bold' });
    // Hidden again: Carol and Dave hear it once more, then nothing.
    await t.call(t.gm.client, 'PATCH', url, {
      ownership: { default: 'none', users: { [t.bob.userId]: 'owner' } },
    });
    await t.call(t.bob.client, 'DELETE', url);
    await t.call(t.bob.client, 'POST', `${url}/restore`);
    await t.call(t.bob.client, 'POST', `${url}/duplicate`);

    await Promise.all([bob.flush(), carol.flush(), dave.flush()]);
    expect(changesOf(bob)).toEqual([
      'actor:created',
      'actor:updated',
      'actor:updated',
      'actor:updated',
      'actor:deleted',
      'actor:restored',
      'actor:created',
    ]);
    const shared = ['actor:updated', 'actor:updated', 'actor:updated'];
    expect(changesOf(carol)).toEqual(shared);
    expect(changesOf(dave)).toEqual(shared);
  });

  it('sends library items to everyone and owned items to who sees the actor', async () => {
    const t = await setupTable();
    const bob = await subscribed(t, t.bob);
    const carol = await subscribed(t, t.carol);

    const sword = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/items`, {
      type: 'weapon',
      name: 'Sword',
    });
    const swordId = sword.json<{ item: ItemView }>().item.id;
    await t.call(t.gm.client, 'PATCH', `/items/${swordId}`, { name: 'Long sword' });
    await t.call(t.gm.client, 'DELETE', `/items/${swordId}`);
    await t.call(t.gm.client, 'POST', `/items/${swordId}/restore`);

    const hero = (
      await t.call(t.bob.client, 'POST', `/tables/${t.table.id}/actors`, {
        type: 'character',
        name: 'Bob the Brave',
      })
    ).json<{ actor: ActorView }>().actor;
    const copy = await t.call(t.bob.client, 'POST', `/actors/${hero.id}/items`, {
      itemId: swordId,
    });
    const owned = copy.json<{ item: ItemView }>().item;
    await t.call(t.bob.client, 'PATCH', `/items/${owned.id}`, { name: 'Lucky sword' });
    await t.call(t.bob.client, 'DELETE', `/items/${owned.id}`);
    await t.call(t.bob.client, 'POST', `/items/${owned.id}/restore`);

    await Promise.all([bob.flush(), carol.flush()]);
    const library = ['item:created', 'item:updated', 'item:deleted', 'item:restored'];
    expect(changesOf(carol)).toEqual(library);
    expect(changesOf(bob)).toEqual([...library, 'actor:created', ...library]);
    const ownedEvent = bob.ofType('entity.changed').at(-1);
    expect(ownedEvent?.payload).toEqual({
      kind: 'item',
      id: owned.id,
      change: 'restored',
      actorId: hero.id,
    });
  });

  it('stops sending to removed members and unsubscribed sockets', async () => {
    const t = await setupTable();
    const bob = await subscribed(t, t.bob);
    const carol = await subscribed(t, t.carol);
    await carol.request({ type: 'unsubscribe', tableId: t.table.id });
    const removed = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/tables/${t.table.id}/members/${t.bob.userId}`,
      headers: authHeaders(t.gm.client),
    });
    expect(removed.statusCode).toBe(204);

    await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/items`, {
      type: 'weapon',
      name: 'Axe',
    });
    await Promise.all([bob.flush(), carol.flush()]);
    expect(changesOf(bob)).toEqual([]);
    expect(changesOf(carol)).toEqual([]);
    expect(t.db.select().from(members).all()).toHaveLength(3);
  });
});

describe('heartbeat', () => {
  it('keeps answering sockets and drops silent ones', async () => {
    const t = await setupTable();
    const socket = await openSocket(t.app, t.gm.client);
    t.app.events.sweep();
    // The client pongs before the first ack reaches it; the second ack follows the pong.
    await socket.flush();
    await socket.flush();
    t.app.events.sweep();
    expect(t.app.events.size).toBe(1);

    // Two sweeps without a pong in between: the socket missed its ping.
    t.app.events.sweep();
    t.app.events.sweep();
    expect(t.app.events.size).toBe(0);
    await socket.closed;
  });

  it('closes sockets whose session ended', async () => {
    const t = await setupTable();
    const swept = await openSocket(t.app, t.gm.client);
    const active = await openSocket(t.app, t.bob.client);
    for (const client of [t.gm.client, t.bob.client]) {
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: authHeaders(client),
      });
    }

    t.app.events.sweep();
    expect(await swept.closed).toBe(SESSION_ENDED);
    // A message on a dead session closes the socket at once.
    active.sendRaw(JSON.stringify({ v: 1, type: 'presence.ping' }));
    expect(await active.closed).toBe(SESSION_ENDED);
    expect(t.app.events.size).toBe(0);
  });

  it('closes every socket on shutdown', async () => {
    const t = await setupTable();
    const socket = await openSocket(t.app, t.gm.client);
    await t.app.close();
    expect(await socket.closed).toBe(1001);
  });
});
