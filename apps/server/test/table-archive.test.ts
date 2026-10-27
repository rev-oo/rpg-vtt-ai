import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { documentName } from '@vtt/shared';
import type { ChatMessage, TableView } from '@vtt/shared/api';

import { openCollab } from './support/collab.js';
import { openSocket } from './support/socket.js';
import { setupTable, type TableSetup } from './support/table.js';

// T-0807 (FR-TABLE-06, ADR-054): an archived table is read-only everywhere until unarchived.

const archive = (t: TableSetup, client = t.gm.client, archived = true) =>
  t.call(client, 'POST', `/tables/${t.table.id}/${archived ? 'archive' : 'unarchive'}`);

/** A table with an actor, an item, a message and an invite to work on. */
async function populated() {
  const t = await setupTable();
  const actor = await t.call(t.bob.client, 'POST', `/tables/${t.table.id}/actors`, {
    type: 'character',
    name: 'Ayla',
  });
  const actorId = actor.json<{ actor: { id: string } }>().actor.id;
  const message = await t.call(t.bob.client, 'POST', `/tables/${t.table.id}/messages`, {
    text: 'hello',
  });
  const messageId = message.json<{ message: ChatMessage }>().message.id;
  const invite = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/invites`, {
    role: 'player',
  });
  const { token } = invite.json<{ token: string }>();
  return { t, actorId, messageId, token };
}

type Populated = Awaited<ReturnType<typeof populated>>;

/** Every write path of a table, each answering its status code. */
function writes({ t, actorId, messageId, token }: Populated) {
  const id = t.table.id;
  return {
    'PATCH table': () => t.call(t.gm.client, 'PATCH', `/tables/${id}`, { name: 'Renamed' }),
    'create actor': () =>
      t.call(t.bob.client, 'POST', `/tables/${id}/actors`, { type: 'character', name: 'B' }),
    'edit actor': () => t.call(t.bob.client, 'PATCH', `/actors/${actorId}`, { name: 'Ayla II' }),
    'create item': () =>
      t.call(t.gm.client, 'POST', `/tables/${id}/items`, { type: 'weapon', name: 'Axe' }),
    'create journal entry': () =>
      t.call(t.gm.client, 'POST', `/tables/${id}/journal`, { title: 'Notes' }),
    'send chat': () => t.call(t.bob.client, 'POST', `/tables/${id}/messages`, { text: 'hi' }),
    'edit chat': () => t.call(t.bob.client, 'PATCH', `/messages/${messageId}`, { text: 'hey' }),
    roll: () => t.call(t.bob.client, 'POST', `/tables/${id}/rolls`, { formula: '1d6' }),
    command: () => t.call(t.bob.client, 'POST', `/tables/${id}/commands`, { name: 'nope' }),
    'start combat': () => t.call(t.gm.client, 'POST', `/tables/${id}/encounter`),
    'create invite': () => t.call(t.gm.client, 'POST', `/tables/${id}/invites`, { role: 'player' }),
    'accept invite': () => t.call(t.eve.client, 'POST', `/invites/${token}/accept`),
    'change role': () =>
      t.call(t.gm.client, 'PATCH', `/tables/${id}/members/${t.carol.userId}`, {
        role: 'spectator',
      }),
  };
}

async function statuses(table: Populated) {
  const result: Record<string, number> = {};
  for (const [name, write] of Object.entries(writes(table)))
    result[name] = (await write()).statusCode;
  return result;
}

describe('archiving a table (T-0807)', () => {
  it('lets GMs and assistants archive and unarchive, and marks the table', async () => {
    const t = await setupTable();
    expect((await archive(t, t.bob.client)).statusCode).toBe(403);
    const res = await archive(t);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ table: TableView }>().table.archivedAt).not.toBeNull();

    const listed = (await t.call(t.bob.client, 'GET', '/tables')).json<{ tables: TableView[] }>();
    expect(listed.tables.find((table) => table.id === t.table.id)?.archivedAt).not.toBeNull();

    const back = await archive(t, t.gm.client, false);
    expect(back.json<{ table: TableView }>().table.archivedAt).toBeNull();
  });

  it('rejects every write while archived and allows them again after', async () => {
    const table = await populated();
    const { t } = table;
    await archive(t);

    const rejected = await statuses(table);
    for (const [name, status] of Object.entries(rejected)) {
      expect(status, name).toBe(409);
    }
    // Reading still works, and the delete of a message waits too.
    expect((await t.call(t.bob.client, 'GET', `/tables/${t.table.id}/messages`)).statusCode).toBe(
      200,
    );
    const deleted = await t.call(t.gm.client, 'DELETE', `/messages/${table.messageId}`);
    expect(deleted.json<{ error: { code: string } }>().error.code).toBe('table_archived');

    await archive(t, t.gm.client, false);
    const allowed = await statuses(table);
    for (const [name, status] of Object.entries(allowed)) {
      expect(status, name).not.toBe(409);
      // The unknown command is refused for itself, not for the archive.
      if (name !== 'command') expect(status, name).toBeLessThan(300);
    }
  });

  it('refuses chat over the events socket', async () => {
    const { t } = await populated();
    const socket = await openSocket(t.app, t.bob.client);
    await archive(t);
    const answer = await socket.request({
      type: 'chat.send',
      tableId: t.table.id,
      payload: { text: 'still here?' },
    });
    expect(answer).toMatchObject({ type: 'error', payload: { code: 'table_archived' } });
    socket.ws.close();
  });

  it('turns open documents read-only, and writable again', async () => {
    const { t, actorId } = await populated();
    const name = documentName({ kind: 'actor', id: actorId, layer: 'main' });
    const bob = await (await openCollab(t.app, t.bob.client)).open(name);
    const setHp = (hp: number) => (doc: Y.Doc) => {
      doc.getMap('data').set('hp', hp);
    };

    await archive(t);
    expect(await bob.next()).toEqual({ type: 'access', readOnly: true });
    expect(await bob.change(setHp(1))).toBe(false);
    // Opened while archived, a document is read-only from the start.
    const late = await (await openCollab(t.app, t.gm.client)).open(name);
    expect(late.auth).toEqual({ scope: 'readonly' });

    await archive(t, t.gm.client, false);
    expect(await bob.next()).toEqual({ type: 'access', readOnly: false });
    expect(await bob.change(setHp(2))).toBe(true);
  });
});
