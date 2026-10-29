import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { TableRole } from '@vtt/shared';
import type { ItemView } from '@vtt/shared/api';
import { createMemoryStore } from '@vtt/sheet-renderer';

import { setCsrfToken } from '../src/api/client.js';
import type { LiveSheet } from '../src/collab/use-live-sheet.js';
import { clearLoadedSystems } from '../src/plugin-host/load.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS } from './support/table-fixtures.js';
import { openPanel } from './support/workspace.js';

// T-1204 (FR-ENT-06, ADR-062): items open on a live sheet of their own.

/** The live documents; the Yjs store and the socket are tested on their own. */
const collab = vi.hoisted(() => ({
  sheet: null as LiveSheet | null,
  opened: [] as { kind: string; id: string; secret: boolean }[],
}));
vi.mock('../src/collab/use-live-sheet.js', () => ({
  useLiveSheet: (
    entity: { kind: string; id: string },
    _layout: unknown,
    { secret }: { secret: boolean },
  ) => {
    collab.opened.push({ ...entity, secret });
    return collab.sheet;
  },
}));

afterEach(() => {
  collab.sheet = null;
  collab.opened = [];
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
      label: 'type.npc',
      controlledBy: 'gm',
      sheet: 'weapon',
      schema: { type: 'object', properties: {} },
    },
  },
  itemTypes: {
    weapon: {
      label: 'type.weapon',
      sheet: 'weapon',
      schema: { type: 'object', properties: { damage: { type: 'string', default: '1d6' } } },
    },
  },
  sheets: { weapon: { layout: { type: 'field', path: 'damage', label: 'Damage' } } },
  rolls: {},
  dice: {},
  cards: {},
  settings: {},
  lang: { en: {} },
  styles: [],
};

const item = (overrides: Partial<ItemView> = {}): ItemView => ({
  id: 'i1',
  tableId: TABLE.id,
  actorId: null,
  sourceId: null,
  type: 'weapon',
  name: 'Sword',
  imageUrl: null,
  system: { damage: '1d8' },
  dataVersion: TABLE.systemVersion,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
  deletedAt: null,
  access: 'owner',
  ...overrides,
});

function openTable(role: TableRole, sword: ItemView) {
  fakeWebSocket();
  const store = {
    ...createMemoryStore(sword.system),
    richText: () => undefined,
    destroy: () => undefined,
  };
  collab.sheet = { status: 'ready', store, readOnly: false, issues: [], awareness: undefined };
  const actors = { body: { nextCursor: null, actors: [HERO] } };
  fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: { ...TABLE, role } } },
    'GET /tables/t1/members': { body: { members: MEMBERS } },
    'GET /tables/t1/actors': actors,
    'GET /tables/t1/actors?trash=live&limit=50': actors,
    'GET /tables/t1/items?trash=live&limit=50': { body: { nextCursor: null, items: [sword] } },
    'GET /actors/a1/items': {
      body: { nextCursor: null, items: [item({ id: 'i2', actorId: HERO.id, sourceId: 'i1' })] },
    },
    'GET /items/i1': { body: { item: sword } },
    'GET /items/i2': { body: { item: item({ id: 'i2', actorId: HERO.id, sourceId: 'i1' }) } },
    'GET /tables/t1/types': {
      body: { actorTypes: [{ type: 'npc', controlledBy: 'gm' }], itemTypes: ['weapon'] },
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
  return store;
}

describe('item sheets (T-1204)', () => {
  it('opens a library item from the items panel and edits it live', async () => {
    const store = openTable('gm', item());
    await openPanel('Items');
    await userEvent.click(await screen.findByRole('button', { name: 'Open item: Sword' }));
    const sheet = await screen.findByRole('tabpanel', { name: 'Sword' });
    expect(within(sheet).getByText('In the table’s library')).toBeVisible();
    const damage = await within(sheet).findByLabelText('Damage');
    expect(damage).toHaveValue('1d8');
    await userEvent.clear(damage);
    await userEvent.type(damage, '2d6');
    await userEvent.tab();
    expect(store.getSnapshot()).toMatchObject({ damage: '2d6' });
    expect(collab.opened.at(-1)).toEqual({ kind: 'item', id: 'i1', secret: true });
  });

  it('shows a player the library read-only', async () => {
    openTable('player', item({ access: 'observer' }));
    await openPanel('Items');
    await userEvent.click(await screen.findByRole('button', { name: 'Open item: Sword' }));
    const sheet = await screen.findByRole('tabpanel', { name: 'Sword' });
    expect(await within(sheet).findByLabelText('Damage')).toHaveAttribute('readonly');
    expect(collab.opened.at(-1)).toEqual({ kind: 'item', id: 'i1', secret: false });
  });

  it("opens an actor's item from the actor list", async () => {
    openTable('gm', item());
    await userEvent.click(await screen.findByText('Items', { selector: 'summary' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open item: Sword' }));
    const sheet = await screen.findByRole('tabpanel', { name: 'Sword' });
    expect(await within(sheet).findByText('Held by Goblin King')).toBeVisible();
    expect(collab.opened.at(-1)).toMatchObject({ kind: 'item', id: 'i2' });
  });
});
