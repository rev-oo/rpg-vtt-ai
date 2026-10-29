import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { ItemView } from '@vtt/shared/api';
import type * as Renderer from '@vtt/sheet-renderer';
import { createMemoryStore, type SheetStore } from '@vtt/sheet-renderer';

import { setCsrfToken } from '../src/api/client.js';
import type { LiveSheet } from '../src/collab/use-live-sheet.js';
import { clearLoadedSystems } from '../src/plugin-host/load.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS } from './support/table-fixtures.js';
import { openSheet } from './support/workspace.js';

// T-1206 (FR-SHEET-12, ADR-063): actor sheets list and edit the actor's items.

/** The live documents: the actor's, and one memory store per item. */
const collab = vi.hoisted(() => ({
  sheet: null as LiveSheet | null,
  items: new Map<string, SheetStore>(),
  itemsReadOnly: false,
}));
vi.mock('../src/collab/use-live-sheet.js', () => ({ useLiveSheet: () => collab.sheet }));
vi.mock('../src/collab/use-live-items.js', async () => {
  const { useEffect, useReducer } = await vi.importActual<typeof React>('react');
  const renderer = await vi.importActual<typeof Renderer>('@vtt/sheet-renderer');
  return {
    // Like the real hook, every edit of an item gives a new map.
    useLiveItems: (held: readonly ItemView[]) => {
      const [, bump] = useReducer((count: number) => count + 1, 0);
      const stores = held.map((item) => {
        const store = collab.items.get(item.id) ?? renderer.createMemoryStore(item.system);
        collab.items.set(item.id, store);
        return [item.id, store] as const;
      });
      useEffect(() => {
        const offs = stores.map(([, store]) => store.subscribe(bump));
        return () => {
          for (const off of offs) off();
        };
      });
      return new Map(
        stores.map(([id, store]) => [
          id,
          { store, ready: true, readOnly: collab.itemsReadOnly, denied: false },
        ]),
      );
    },
  };
});

afterEach(() => {
  collab.sheet = null;
  collab.items = new Map();
  collab.itemsReadOnly = false;
  closeEventsClient();
  clearLoadedSystems();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const DEFINITION: PluginDefinition = {
  manifest: {
    id: 'tiny-d20',
    name: 'Tiny d20',
    version: '1.0.0',
    kind: 'system',
    coreApi: '^0.1.0',
    hasCode: false,
    locales: ['en'],
  },
  actorTypes: {
    npc: {
      label: 'NPC',
      controlledBy: 'gm',
      sheet: 'npc',
      schema: { type: 'object', properties: {} },
      derived: { ac: '10 + @items.acBonus' },
    },
  },
  itemTypes: {
    armor: {
      label: 'Armor',
      sheet: 'item',
      schema: {
        type: 'object',
        properties: {
          equipped: { type: 'boolean', default: false },
          acBonus: { type: 'integer', default: 2 },
        },
      },
      contributes: { acBonus: { formula: '@equipped ? @acBonus : 0' } },
    },
    weapon: {
      label: 'Weapon',
      sheet: 'item',
      schema: { type: 'object', properties: { damage: { type: 'string', default: '1d6' } } },
    },
  },
  sheets: {
    npc: {
      layout: {
        type: 'column',
        children: [
          { type: 'derived', key: 'ac', label: 'AC' },
          {
            type: 'items',
            itemTypes: ['armor'],
            addLabel: 'Add armor',
            item: {
              type: 'row',
              children: [
                { type: 'field', path: 'equipped', label: 'Equipped', input: 'checkbox' },
                { type: 'rollButton', roll: 'brace', label: 'Brace' },
              ],
            },
          },
        ],
      },
    },
    item: { layout: { type: 'column', children: [] } },
  },
  rolls: { brace: { formula: '1d20 + @item.acBonus', item: ['armor'] } },
  dice: {},
  cards: {},
  settings: {},
  lang: { en: {} },
  styles: [],
};

const ROLLED = {
  id: 'm1',
  tableId: TABLE.id,
  senderId: 'u1',
  speaker: { name: 'Goblin King', actorId: HERO.id, imageUrl: null },
  audience: 'public',
  recipientIds: [],
  kind: 'roll',
  text: '1d20 + 2',
  rolls: [{ expression: '1d20 + @item.acBonus', resolved: '1d20 + 2', total: 12, dice: [] }],
  card: null,
  createdAt: '2026-10-20T12:00:00.000Z',
  editedAt: null,
};

const item = (id: string, type: string, name: string, actorId: string | null): ItemView => ({
  id,
  tableId: TABLE.id,
  actorId,
  sourceId: null,
  type,
  name,
  imageUrl: null,
  system: {},
  dataVersion: TABLE.systemVersion,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
  deletedAt: null,
  access: actorId === null ? 'observer' : 'owner',
});
const MAIL = item('i1', 'armor', 'Mail', HERO.id);

function openTable({ access = 'owner' }: { access?: 'owner' | 'observer' } = {}) {
  fakeWebSocket();
  collab.sheet = {
    status: 'ready',
    store: { ...createMemoryStore({}), richText: () => undefined, destroy: () => undefined },
    readOnly: access !== 'owner',
    issues: [],
    awareness: undefined,
  };
  const hero = { ...HERO, access };
  const actors = { body: { nextCursor: null, actors: [hero] } };
  const library = [item('l1', 'armor', 'Plate', null), item('l2', 'weapon', 'Sword', null)];
  const api = fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: { ...TABLE, role: access === 'owner' ? 'gm' : 'player' } } },
    'GET /tables/t1/members': { body: { members: MEMBERS } },
    'GET /tables/t1/actors': actors,
    'GET /tables/t1/actors?trash=live&limit=50': actors,
    'GET /tables/t1/items': { body: { nextCursor: null, items: library } },
    'GET /actors/a1/items': {
      body: { nextCursor: null, items: [{ ...MAIL, access }, item('i2', 'weapon', 'Axe', 'a1')] },
    },
    'POST /actors/a1/items': { status: 201, body: { item: item('i3', 'armor', 'Plate', 'a1') } },
    'DELETE /items/i1': { status: 204 },
    'POST /tables/t1/rolls': { status: 201, body: { message: ROLLED } },
    'POST /tables/t1/compendium/copy': {
      body: { actors: [], items: [item('i4', 'armor', 'Scale', 'a1')] },
    },
    'GET /tables/t1/types': {
      body: { actorTypes: [{ type: 'npc', controlledBy: 'gm' }], itemTypes: ['armor', 'weapon'] },
    },
    'GET /tables/t1/messages': { body: { messages: [], nextCursor: null } },
    'GET /tables/t1/encounter': { body: { encounter: null } },
    'GET /systems/tiny-d20': {
      body: {
        system: {
          id: 'tiny-d20',
          name: 'Tiny d20',
          version: '1.0.0',
          definition: DEFINITION,
          styles: [],
          client: null,
          shared: null,
        },
      },
    },
  });
  renderApp('/tables/t1');
  return api;
}

const items = () => screen.findByRole('list', { name: 'Items of Goblin King' });

describe('items on actor sheets (T-1206)', () => {
  it("lists the actor's items of the node's types; equipping one changes AC", async () => {
    openTable();
    await openSheet('Goblin King');
    const list = await items();
    // The weapon is not one of the node's types.
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.getAttribute('aria-label')),
    ).toEqual(['Mail']);
    // The core names each row; the plugin's row lays out only the fields.
    expect(within(within(list).getByRole('listitem')).getByText('Mail')).toBeVisible();
    expect(screen.getByLabelText('AC')).toHaveTextContent('10');
    await userEvent.click(within(list).getByLabelText('Equipped'));
    expect(collab.items.get('i1')?.getSnapshot()).toEqual({ equipped: true });
    await waitFor(() => {
      expect(screen.getByLabelText('AC')).toHaveTextContent('12');
    });
  });

  it('adds from the library, removes, and takes drops', async () => {
    const api = openTable();
    await openSheet('Goblin King');
    await items();
    const choice = await screen.findByRole('combobox', { name: 'Item from the library' });
    expect(
      within(choice)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Plate']);
    await userEvent.click(screen.getByRole('button', { name: 'Add armor' }));
    expect(await screen.findByText('Added Plate.')).toBeVisible();
    expect(api.calls).toContainEqual(
      expect.objectContaining({ method: 'POST', path: '/actors/a1/items', body: { itemId: 'l1' } }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove Mail' }));
    expect(await screen.findByText('Mail is in the trash.')).toBeVisible();
    expect(api.calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', path: '/items/i1' }),
    );

    const node = (await items()).closest('.vtt-items');
    if (!node) throw new Error('The items node is missing');
    const ref = 'tiny-d20:gear:scale';
    fireEvent.drop(node, {
      dataTransfer: {
        types: ['application/x-vtt-compendium-item'],
        getData: (type: string) => (type === 'application/x-vtt-compendium-item' ? ref : ''),
      },
    });
    expect(await screen.findByText('Added Scale.')).toBeVisible();
    expect(api.calls).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/tables/t1/compendium/copy',
        body: { refs: [ref], actorId: 'a1' },
      }),
    );
  });

  it("rolls from an item's row with that item (T-1207)", async () => {
    const api = openTable();
    await openSheet('Goblin King');
    await userEvent.click(within(await items()).getByRole('button', { name: 'Brace' }));
    expect(await screen.findByText('Rolled. The result is in the chat.')).toBeVisible();
    expect(api.calls).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/tables/t1/rolls',
        body: { recipe: { name: 'brace', args: {}, itemId: 'i1' }, actorId: 'a1' },
      }),
    );
  });

  it('shows observers the items read-only', async () => {
    collab.itemsReadOnly = true;
    openTable({ access: 'observer' });
    await openSheet('Goblin King');
    const list = await items();
    expect(within(list).getByLabelText('Equipped')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove Mail' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add armor' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'Open item: Mail' })).toBeVisible();
  });
});
