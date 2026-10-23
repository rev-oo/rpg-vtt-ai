import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { documentName } from '@vtt/shared';
import type { JournalEntryView } from '@vtt/shared/api';

import type { Client } from './support/app.js';
import { openCollab } from './support/collab.js';
import { openSocket, type TestSocket } from './support/socket.js';
import { setupTable, type TableMember, type TableSetup } from './support/table.js';

async function createEntry(
  t: TableSetup,
  body: Record<string, unknown> = { title: 'The Old Mill' },
): Promise<JournalEntryView> {
  const res = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/journal`, body);
  if (res.statusCode !== 201) throw new Error(`create entry failed: ${res.body}`);
  return res.json<{ entry: JournalEntryView }>().entry;
}

const titles = async (t: TableSetup, client: Client, query = '') =>
  (await t.call(client, 'GET', `/tables/${t.table.id}/journal${query}`))
    .json<{ entries: JournalEntryView[] }>()
    .entries.map((entry) => entry.title);

const bodyOf = (id: string) => documentName({ kind: 'journal', id, layer: 'main' });

async function openBody(t: TableSetup, who: TableMember, id: string) {
  const socket = await openCollab(t.app, who.client);
  return socket.open(bodyOf(id));
}

async function subscribed(t: TableSetup, who: TableMember): Promise<TestSocket> {
  const socket = await openSocket(t.app, who.client);
  await socket.request({ type: 'subscribe', tableId: t.table.id });
  return socket;
}

const changesOf = (socket: TestSocket) =>
  socket
    .ofType('entity.changed')
    .filter((e) => e.payload.kind === 'journal')
    .map((e) => e.payload.change);

describe('journal entries (FR-JOURNAL-01, 02)', () => {
  it('are created by GMs and assistants, hidden until revealed', async () => {
    const t = await setupTable();
    const url = `/tables/${t.table.id}/journal`;
    expect((await t.call(t.bob.client, 'POST', url, { title: 'Mine' })).statusCode).toBe(403);
    expect((await t.call(t.dave.client, 'POST', url, { title: 'Mine' })).statusCode).toBe(403);
    expect((await t.call(t.gm.client, 'POST', url, { title: '  ' })).statusCode).toBe(400);

    const mill = await createEntry(t);
    expect(mill).toMatchObject({
      tableId: t.table.id,
      title: 'The Old Mill',
      hidden: true,
      ownership: { default: 'observer', users: {} },
      deletedAt: null,
      access: 'owner',
    });
    await createEntry(t, { title: 'Ancient history', hidden: false });

    expect(await titles(t, t.gm.client)).toEqual(['Ancient history', 'The Old Mill']);
    expect(await titles(t, t.bob.client)).toEqual(['Ancient history']);
    expect(await titles(t, t.gm.client, '?search=MILL')).toEqual(['The Old Mill']);
    expect((await t.call(t.eve.client, 'GET', url)).statusCode).toBe(404);
  });

  it('follow their ownership: observers read, owners rename, only GMs hide or share', async () => {
    const t = await setupTable();
    const entry = await createEntry(t, {
      title: 'Letters',
      hidden: false,
      ownership: { default: 'observer', users: { [t.bob.userId]: 'owner' } },
    });
    const url = `/journal/${entry.id}`;

    expect((await t.call(t.carol.client, 'GET', url)).json()).toMatchObject({
      entry: { access: 'observer' },
    });
    expect((await t.call(t.carol.client, 'PATCH', url, { title: 'Mine' })).statusCode).toBe(403);

    const renamed = await t.call(t.bob.client, 'PATCH', url, { title: 'Love letters' });
    expect(renamed.json()).toMatchObject({ entry: { title: 'Love letters', access: 'owner' } });
    for (const change of [{ hidden: true }, { ownership: { default: 'owner', users: {} } }]) {
      expect((await t.call(t.bob.client, 'PATCH', url, change)).statusCode).toBe(403);
    }
    expect((await t.call(t.bob.client, 'PATCH', url, {})).statusCode).toBe(400);

    // A GM can keep an entry from one player.
    await t.call(t.gm.client, 'PATCH', url, {
      ownership: { default: 'observer', users: { [t.carol.userId]: 'none' } },
    });
    expect((await t.call(t.carol.client, 'GET', url)).statusCode).toBe(404);
    expect(await titles(t, t.carol.client)).toEqual([]);
    expect((await t.call(t.eve.client, 'GET', url)).statusCode).toBe(404);
  });

  it('go to the trash and come back within the retention window', async () => {
    const t = await setupTable();
    const entry = await createEntry(t, { title: 'Rumours', hidden: false });
    const url = `/journal/${entry.id}`;
    expect((await t.call(t.bob.client, 'DELETE', url)).statusCode).toBe(403);
    expect((await t.call(t.gm.client, 'DELETE', url)).statusCode).toBe(204);
    expect(await titles(t, t.bob.client)).toEqual([]);
    expect((await t.call(t.bob.client, 'GET', url)).statusCode).toBe(404);
    // The trash shows what the caller could restore.
    expect(await titles(t, t.gm.client, '?trash=restorable')).toEqual(['Rumours']);
    expect(await titles(t, t.bob.client, '?trash=restorable')).toEqual([]);

    expect((await t.call(t.gm.client, 'POST', `${url}/restore`)).json()).toMatchObject({
      entry: { deletedAt: null },
    });
    expect((await t.call(t.gm.client, 'POST', `${url}/restore`)).statusCode).toBe(409);

    await t.call(t.gm.client, 'DELETE', url);
    t.advanceDays(31);
    expect((await t.call(t.gm.client, 'POST', `${url}/restore`)).statusCode).toBe(410);
  });
});

describe('hidden entries (FR-JOURNAL-03, T-0601)', () => {
  it('never reach players: not listed, not found, no document', async () => {
    const t = await setupTable();
    const entry = await createEntry(t, { title: 'The twist' });

    for (const player of [t.bob, t.carol, t.dave]) {
      const list = await t.call(player.client, 'GET', `/tables/${t.table.id}/journal`);
      expect(list.body).not.toContain(entry.id);
      expect(list.body).not.toContain('The twist');
      const found = await t.call(player.client, 'GET', `/journal/${entry.id}`);
      expect(found.statusCode).toBe(404);
      expect(found.body).not.toContain('The twist');
      const document = await openBody(t, player, entry.id);
      expect(document.auth).toEqual({ denied: 'Forbidden' });
      expect(document.frames).toHaveLength(1);
    }
    expect((await openBody(t, t.gm, entry.id)).auth).toEqual({ scope: 'read-write' });

    // The GM writes the body (ADR-038) while it is hidden; revealed, players read it.
    const gmBody = await openBody(t, t.gm, entry.id);
    const stored = await gmBody.change((doc) => {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText('It was the butler.')]);
      doc.getXmlFragment('body').insert(0, [paragraph]);
    });
    expect(stored).toBe(true);
    await t.call(t.gm.client, 'PATCH', `/journal/${entry.id}`, { hidden: false });
    expect(await titles(t, t.bob.client)).toEqual(['The twist']);
    const bobBody = await openBody(t, t.bob, entry.id);
    expect(bobBody.auth).toEqual({ scope: 'readonly' });
    expect(bobBody.doc.getXmlFragment('body').toJSON()).toBe(
      '<paragraph>It was the butler.</paragraph>',
    );
  });

  it('close a player’s open document when the GM hides it again (T-0512)', async () => {
    const t = await setupTable();
    const entry = await createEntry(t, { title: 'Map', hidden: false });
    const bob = await openBody(t, t.bob, entry.id);
    expect(bob.auth).toEqual({ scope: 'readonly' });

    await t.call(t.gm.client, 'PATCH', `/journal/${entry.id}`, { hidden: true });
    expect(await bob.closed).toBe('Forbidden');
    expect((await openBody(t, t.bob, entry.id)).auth).toEqual({ denied: 'Forbidden' });
  });

  it('tell players only about entries they can see, and about the hide that removes one', async () => {
    const t = await setupTable();
    const gm = await subscribed(t, t.gm);
    const bob = await subscribed(t, t.bob);

    const entry = await createEntry(t, { title: 'Secret plan' });
    const url = `/journal/${entry.id}`;
    await t.call(t.gm.client, 'PATCH', url, { title: 'Secret plan, part 2' });
    await t.call(t.gm.client, 'PATCH', url, { hidden: false });
    await t.call(t.gm.client, 'PATCH', url, { hidden: true });
    await t.call(t.gm.client, 'DELETE', url);

    await Promise.all([gm.flush(), bob.flush()]);
    expect(changesOf(gm)).toEqual(['created', 'updated', 'updated', 'updated', 'deleted']);
    // The reveal and the hide; nothing while the entry stayed hidden.
    expect(changesOf(bob)).toEqual(['updated', 'updated']);
  });
});
