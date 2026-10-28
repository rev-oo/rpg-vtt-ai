import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setCsrfToken } from '../src/api/client.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { findAlert } from './support/alerts.js';
import { fakeApi, SESSION, TABLE, USER, type FakeResponse } from './support/fake-api.js';
import { fakeWebSocket, serverEvent } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { BOB, HERO, MEMBERS, TYPES } from './support/table-fixtures.js';

afterEach(() => {
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const actor = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  ...HERO,
  id,
  name,
  ...extra,
});
const BOBS_HERO = actor('a2', 'Bob the Brave', {
  type: 'character',
  access: 'observer',
  ownership: { default: 'observer', users: { u2: 'owner' } },
});
const SWORD = {
  id: 'i1',
  tableId: TABLE.id,
  actorId: null,
  sourceId: null,
  type: 'weapon',
  name: 'Sword',
  imageUrl: null,
  system: {},
  dataVersion: '1.0.0',
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
  deletedAt: null,
  access: 'owner',
};

type Handlers = Parameters<typeof fakeApi>[0];

/** Opens a table tab as the GM (or another role) with the given lists. */
function openTable(
  path: string,
  { role = 'gm', handlers = {} }: { role?: string; handlers?: Handlers } = {},
) {
  const sockets = fakeWebSocket();
  const actors = { body: { nextCursor: null, actors: [HERO, BOBS_HERO] } };
  const api = fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: { ...TABLE, role } } },
    'GET /tables/t1/members': {
      body: { members: MEMBERS.map((m) => (m.userId === USER.id ? { ...m, role } : m)) },
    },
    'GET /tables/t1/actors': actors,
    'GET /tables/t1/actors?trash=live&limit=50': actors,
    'GET /tables/t1/types': { body: TYPES },
    'GET /tables/t1/messages': { body: { messages: [], nextCursor: null } },
    'GET /tables/t1/items?trash=live&limit=50': { body: { nextCursor: null, items: [SWORD] } },
    ...handlers,
  });
  renderApp(path);
  return { ...api, sockets };
}

const actorList = () => screen.getByRole('list', { name: 'Actors' });
const rowOf = (name: string) =>
  within(actorList())
    .getAllByRole('listitem')
    .find((row) => within(row).queryByRole('heading', { name }));
/** Waits for the actor list, then returns a row. */
const findRow = async (name: string) => {
  await screen.findByRole('heading', { name });
  return row(name);
};
const row = (name: string) => {
  const found = rowOf(name);
  if (!found) throw new Error(`no row ${name}`);
  return within(found);
};

describe('actor list (FR-ENT-01..04)', () => {
  it("lists actors with the caller's access and actions", async () => {
    openTable('/tables/t1');
    expect(await screen.findByRole('heading', { name: 'Goblin King' })).toBeInTheDocument();
    expect(row('Goblin King').getByText('You can edit')).toBeInTheDocument();
    expect(row('Bob the Brave').getByText('You can view')).toBeInTheDocument();
    // The GM may duplicate and set ownership of both, but delete only what they can edit.
    expect(row('Goblin King').getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(row('Bob the Brave').queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(row('Bob the Brave').getByRole('button', { name: 'Ownership' })).toBeInTheDocument();
  });

  it('filters by search, type and trash, kept with the panel (ADR-059)', async () => {
    const { calls } = openTable('/tables/t1', {
      handlers: {
        'GET /tables/t1/actors?search=gob&trash=live&limit=50': {
          body: { nextCursor: null, actors: [HERO] },
        },
        'GET /tables/t1/actors?search=gob&type=npc&trash=live&limit=50': {
          body: { nextCursor: null, actors: [HERO] },
        },
        'GET /tables/t1/actors?search=gob&type=npc&trash=restorable&limit=50': {
          body: { nextCursor: null, actors: [] },
        },
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Search actors'), 'gob');
    await waitFor(() => {
      expect(rowOf('Bob the Brave')).toBeUndefined();
    });
    await user.selectOptions(screen.getByLabelText('Type'), 'npc');
    await user.click(screen.getByLabelText('Show trash'));
    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument();
    expect(calls.map((c) => c.path)).toContain(
      '/tables/t1/actors?search=gob&type=npc&trash=restorable&limit=50',
    );
    const saved: unknown = JSON.parse(localStorage.getItem(`vtt:dock:${USER.id}:t1:desktop`) ?? '');
    expect(saved).toMatchObject({
      panels: { actors: { params: { filters: { search: 'gob', type: 'npc', trash: true } } } },
    });
  });

  it('restores from the trash', async () => {
    const { calls } = openTable('/tables/t1', {
      handlers: {
        'GET /tables/t1/actors?trash=restorable&limit=50': {
          body: { nextCursor: null, actors: [{ ...HERO, deletedAt: '2026-10-19T00:00:00.000Z' }] },
        },
        'POST /actors/a1/restore': { body: { actor: HERO } },
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Show trash'));
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Goblin King was restored.')).toBeVisible();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/actors/a1/restore')).toBe(true);
  });

  it('duplicates and deletes, then reloads the list', async () => {
    let list: FakeResponse = { body: { nextCursor: null, actors: [HERO] } };
    const { calls } = openTable('/tables/t1', {
      handlers: {
        'GET /tables/t1/actors?trash=live&limit=50': () => list,
        'POST /actors/a1/duplicate': () => {
          list = { body: { nextCursor: null, actors: [HERO, actor('a3', 'Goblin King (copy)')] } };
          return { status: 201, body: { actor: actor('a3', 'Goblin King (copy)') } };
        },
        'DELETE /actors/a3': () => {
          list = { body: { nextCursor: null, actors: [HERO] } };
          return { status: 204 };
        },
      },
    });
    const user = userEvent.setup();
    await user.click((await findRow('Goblin King')).getByRole('button', { name: 'Duplicate' }));
    expect(await screen.findByRole('heading', { name: 'Goblin King (copy)' })).toBeVisible();

    await user.click(row('Goblin King (copy)').getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText(
        'Goblin King (copy) was moved to the trash. You can restore it for 30 days.',
      ),
    ).toBeVisible();
    // The status shows as soon as the request succeeds; the list follows when it reloads.
    await waitFor(() => {
      expect(rowOf('Goblin King (copy)')).toBeUndefined();
    });
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /actors/a1/duplicate',
      'DELETE /actors/a3',
    ]);
  });

  it('offers players only the types they may create, and validates the form', async () => {
    const created = actor('a9', 'Hero', { type: 'character' });
    const { calls } = openTable('/tables/t1', {
      role: 'player',
      handlers: { 'POST /tables/t1/actors': { status: 201, body: { actor: created } } },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New actor' }));
    const dialog = screen.getByRole('dialog', { name: 'New actor' });
    const type = within(dialog).getByLabelText('Type');
    expect(
      within(type)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['character']);

    await user.click(within(dialog).getByRole('button', { name: 'Create actor' }));
    expect(await within(dialog).findByText('Required.')).toBeVisible();
    await user.type(within(dialog).getByLabelText('Image URL'), 'javascript:alert(1)');
    expect(
      within(dialog).getByText('Must be a web address starting with http:// or https://.'),
    ).toBeVisible();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await user.clear(within(dialog).getByLabelText('Image URL'));
    await user.type(within(dialog).getByLabelText('Name'), ' Hero ');
    await user.click(within(dialog).getByRole('button', { name: 'Create actor' }));
    expect(await screen.findByText('Hero was created.')).toBeVisible();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Hero',
      type: 'character',
      imageUrl: null,
    });
    // Players set no ownership.
    expect(screen.queryByRole('button', { name: 'Ownership' })).toBeNull();
  });

  it('lets the GM allow players to create any type', async () => {
    fakeWebSocket();
    openTable('/tables/t1', {
      role: 'player',
      handlers: {
        'GET /tables/t1': {
          body: { table: { ...TABLE, role: 'player', playersMayCreateAnyActorType: true } },
        },
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New actor' }));
    const type = within(screen.getByRole('dialog')).getByLabelText('Type');
    expect(within(type).getAllByRole('option')).toHaveLength(2);
  });

  it('hides creation from spectators', async () => {
    openTable('/tables/t1', { role: 'spectator' });
    await screen.findByRole('heading', { name: 'Goblin King' });
    expect(screen.queryByRole('button', { name: 'New actor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull();
  });

  it('edits ownership per member (FR-ENT-02, 03)', async () => {
    const { calls } = openTable('/tables/t1', {
      handlers: {
        'PATCH /actors/a1': (body) => ({ body: { actor: { ...HERO, ...(body as object) } } }),
      },
    });
    const user = userEvent.setup();
    await user.click((await findRow('Goblin King')).getByRole('button', { name: 'Ownership' }));
    const dialog = screen.getByRole('dialog', { name: 'Ownership of Goblin King' });
    // The GM is an implicit owner and is not listed.
    expect(within(dialog).queryByLabelText('Alice')).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText('Everyone else'), 'Can view');
    await user.selectOptions(within(dialog).getByLabelText('Bob'), 'Owner (can edit)');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Ownership of Goblin King was saved.')).toBeVisible();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      ownership: { default: 'observer', users: { [BOB.userId]: 'owner' } },
    });
  });

  it("shows an actor's own items on demand (FR-ENT-05)", async () => {
    openTable('/tables/t1', {
      handlers: {
        'GET /actors/a1/items': {
          body: { nextCursor: null, items: [{ ...SWORD, id: 'i9', actorId: 'a1' }] },
        },
        'GET /actors/a2/items': { body: { nextCursor: null, items: [] } },
      },
    });
    const user = userEvent.setup();
    await user.click((await findRow('Goblin King')).getByText('Items'));
    expect(await row('Goblin King').findByText('Sword')).toBeVisible();
    await user.click(row('Bob the Brave').getByText('Items'));
    expect(await row('Bob the Brave').findByText('No items yet.')).toBeVisible();
  });

  it('reloads when another member changes an entity (FR-ENT-07)', async () => {
    let list: FakeResponse = { body: { nextCursor: null, actors: [HERO] } };
    const { sockets } = openTable('/tables/t1', {
      handlers: { 'GET /tables/t1/actors?trash=live&limit=50': () => list },
    });
    await screen.findByRole('heading', { name: 'Goblin King' });
    await waitFor(() => {
      expect(sockets.length).toBeGreaterThan(0);
    });
    const socket = sockets.at(-1);
    socket?.open();

    list = { body: { nextCursor: null, actors: [HERO, BOBS_HERO] } };
    socket?.receive(
      serverEvent({
        type: 'entity.changed',
        tableId: 't1',
        payload: { kind: 'actor', id: 'a2', change: 'created', actorId: null },
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Bob the Brave' })).toBeVisible();
  });
});

describe('item library (FR-ENT-05, 06)', () => {
  it('lets the GM create items', async () => {
    const { calls } = openTable('/tables/t1/items', {
      handlers: {
        'POST /tables/t1/items': {
          status: 201,
          body: { item: { ...SWORD, id: 'i2', name: 'Potion' } },
        },
      },
    });
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Sword' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'New item' }));
    const dialog = screen.getByRole('dialog', { name: 'New item' });
    await user.type(within(dialog).getByLabelText('Name'), 'Potion');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'consumable');
    await user.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await screen.findByText('Potion was created.')).toBeVisible();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Potion',
      type: 'consumable',
      imageUrl: null,
    });
  });

  it('lets players copy items into actors they own, but not manage the library', async () => {
    const { calls } = openTable('/tables/t1/items', {
      role: 'player',
      handlers: {
        'GET /tables/t1/actors': {
          body: {
            nextCursor: null,
            actors: [
              { ...HERO, access: 'observer' },
              { ...BOBS_HERO, access: 'owner' },
            ],
          },
        },
        'POST /actors/a2/items': {
          status: 201,
          body: { item: { ...SWORD, id: 'i5', actorId: 'a2' } },
        },
      },
    });
    const user = userEvent.setup();
    const give = await screen.findByLabelText('Give Sword to');
    expect(
      within(give)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Bob the Brave']);
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Give' }));
    expect(await screen.findByText('Bob the Brave received a copy of Sword.')).toBeVisible();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ itemId: 'i1' });
  });

  it('deletes and restores library items', async () => {
    const { calls } = openTable('/tables/t1/items', {
      handlers: {
        'GET /tables/t1/items?trash=restorable&limit=50': {
          body: { nextCursor: null, items: [SWORD] },
        },
        'POST /items/i1/restore': { body: { item: SWORD } },
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Show trash'));
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Sword was restored.')).toBeVisible();
    expect(calls.some((c) => c.path === '/items/i1/restore')).toBe(true);
  });

  it('shows failures inline', async () => {
    openTable('/tables/t1/items', {
      handlers: {
        'DELETE /items/i1': { status: 403, body: { error: { code: 'forbidden', message: 'No.' } } },
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await findAlert()).toHaveTextContent('No.');
  });
});

describe('list pages (T-0812)', () => {
  it('loads the pages after the first until the list ends', async () => {
    const page = (cursor: string | null, ...names: string[]) => ({
      body: { nextCursor: cursor, actors: names.map((name) => actor(`id-${name}`, name)) },
    });
    openTable('/tables/t1', {
      handlers: {
        'GET /tables/t1/actors?trash=live&limit=50': page('c1', 'Ant', 'Bat'),
        'GET /tables/t1/actors?trash=live&limit=50&cursor=c1': page('c2', 'Cat'),
        'GET /tables/t1/actors?trash=live&limit=50&cursor=c2': page(null, 'Dog'),
      },
    });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Bat' });
    expect(rowOf('Cat')).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('heading', { name: 'Cat' });
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('heading', { name: 'Dog' });
    expect(within(actorList()).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('starts over from the first page when the list reloads', async () => {
    let first: FakeResponse = { body: { nextCursor: 'c1', actors: [actor('x1', 'Ant')] } };
    const { sockets } = openTable('/tables/t1', {
      handlers: {
        'GET /tables/t1/actors?trash=live&limit=50': () => first,
        'GET /tables/t1/actors?trash=live&limit=50&cursor=c1': {
          body: { nextCursor: null, actors: [actor('x2', 'Bat')] },
        },
      },
    });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Ant' });
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('heading', { name: 'Bat' });

    await waitFor(() => {
      expect(sockets.length).toBeGreaterThan(0);
    });
    const socket = sockets.at(-1);
    socket?.open();

    first = { body: { nextCursor: null, actors: [actor('x1', 'Ant'), actor('x3', 'Eel')] } };
    socket?.receive(
      serverEvent({
        type: 'entity.changed',
        tableId: 't1',
        payload: { kind: 'actor', id: 'x3', change: 'created', actorId: null },
      }),
    );
    await screen.findByRole('heading', { name: 'Eel' });
    expect(rowOf('Bat')).toBeUndefined();
  });
});
