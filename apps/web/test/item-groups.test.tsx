import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ItemType, PluginDefinition } from '@vtt/plugin-schema';
import type { CompendiumEntry } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';
import { groupItems } from '../src/features/entities/item-groups.js';
import { clearLoadedSystems } from '../src/plugin-host/load.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS } from './support/table-fixtures.js';
import { openPanel } from './support/workspace.js';

// T-1203 (FR-PLUGIN-11, ADR-061): item lists show items under their types' groups.

afterEach(() => {
  clearLoadedSystems();
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const schema = { type: 'object', properties: {} } as const;
const ITEM_TYPES: Record<string, ItemType> = {
  spell: { label: 'Spell', group: 'group.spells', order: 2, sheet: 'item', schema },
  weapon: { label: 'Weapon', group: 'group.gear', order: 1, sheet: 'item', schema },
  tool: { label: 'Tool', group: 'group.gear', sheet: 'item', schema },
  potion: { label: 'Potion', labelPlural: 'Potions', order: 3, sheet: 'item', schema },
};
const LANG = { 'group.spells': 'Spells', 'group.gear': 'Gear', 'type.npc': 'NPC' };
const translate = (text: string) => (text in LANG ? LANG[text as keyof typeof LANG] : text);

describe('groupItems', () => {
  const rows = ['spell', 'potion', 'weapon', 'mystery', 'tool', 'spell'].map((type, i) => ({
    id: `r${String(i)}`,
    type,
  }));
  const titles = (groups: ReturnType<typeof groupItems<(typeof rows)[number]>>) =>
    groups.map((group) => [group.title, group.rows.map((row) => row.id)]);

  it('orders groups by their lowest type order, then title; unknown types come last', () => {
    expect(titles(groupItems(rows, (row) => row.type, ITEM_TYPES, translate))).toEqual([
      // tool has order 0, below weapon's 1, so Gear comes first.
      ['Gear', ['r2', 'r4']],
      ['Spells', ['r0', 'r5']],
      ['Potions', ['r1']],
      ['Other', ['r3']],
    ]);
  });

  it('keeps one list when the system declares no group', () => {
    const plain = { weapon: { label: 'Weapon', sheet: 'item', schema } };
    expect(titles(groupItems(rows, (row) => row.type, plain, translate))).toEqual([
      [null, rows.map((row) => row.id)],
    ]);
    expect(titles(groupItems(rows, (row) => row.type, undefined, translate))).toEqual([
      [null, rows.map((row) => row.id)],
    ]);
  });
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
    npc: { label: 'type.npc', controlledBy: 'gm', sheet: 'item', schema },
  },
  itemTypes: ITEM_TYPES,
  sheets: { item: { layout: { type: 'column', children: [] } } },
  rolls: {},
  dice: {},
  cards: {},
  settings: {},
  lang: { en: LANG },
  styles: [],
};

const item = (id: string, type: string, name: string, actorId: string | null = null) => ({
  id,
  tableId: TABLE.id,
  actorId,
  sourceId: null,
  type,
  name,
  imageUrl: null,
  system: {},
  dataVersion: '1.0.0',
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
  deletedAt: null,
  access: 'owner',
});
const entry = (
  id: string,
  kind: 'actor' | 'item',
  type: string,
  name: string,
): CompendiumEntry => ({
  ref: `tiny-d20:bestiary:${id}`,
  pack: 'bestiary',
  kind,
  type,
  name,
  system: {},
  inTable: false,
});

function openTable() {
  fakeWebSocket();
  const actors = { body: { nextCursor: null, actors: [HERO] } };
  const library = [item('i1', 'spell', 'Spark'), item('i2', 'weapon', 'Sword')];
  return fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: TABLE } },
    'GET /tables/t1/members': { body: { members: MEMBERS } },
    'GET /tables/t1/actors': actors,
    'GET /tables/t1/actors?trash=live&limit=50': actors,
    'GET /tables/t1/items?trash=live&limit=50': { body: { nextCursor: null, items: library } },
    'GET /actors/a1/items': {
      body: {
        nextCursor: null,
        items: [item('i3', 'potion', 'Tonic', 'a1'), item('i4', 'spell', 'Mend', 'a1')],
      },
    },
    'GET /tables/t1/types': {
      body: {
        actorTypes: [{ type: 'npc', controlledBy: 'gm' }],
        itemTypes: Object.keys(ITEM_TYPES),
      },
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
    'GET /tables/t1/compendium?limit=50': {
      body: {
        packs: [{ name: 'bestiary', label: 'Bestiary' }],
        entries: [
          entry('spark', 'item', 'spell', 'Spark'),
          entry('ogre', 'actor', 'npc', 'Ogre'),
          entry('club', 'item', 'weapon', 'Club'),
        ],
        nextCursor: null,
      },
    },
  });
}

/** The names under each group heading of a grouped list. */
function groupsOf(name: string) {
  const list = screen.getByRole('group', { name });
  return within(list)
    .getAllByRole('list')
    .map((group) => [
      group.getAttribute('aria-label'),
      within(group)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('h4')?.textContent ?? row.textContent),
    ]);
}

describe('grouped item lists (T-1203)', () => {
  it('groups the items panel', async () => {
    openTable();
    renderApp('/tables/t1');
    await openPanel('Items');
    expect(await screen.findByRole('heading', { name: 'Spells' })).toBeVisible();
    expect(groupsOf('Items')).toEqual([
      ['Gear', ['Sword']],
      ['Spells', ['Spark']],
    ]);
  });

  it("groups an actor's items", async () => {
    openTable();
    renderApp('/tables/t1');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Items', { selector: 'summary' }));
    expect(await screen.findByRole('heading', { name: 'Potions' })).toBeVisible();
    expect(groupsOf('Items of Goblin King')).toEqual([
      ['Spells', ['Mend (spell)']],
      ['Potions', ['Tonic (potion)']],
    ]);
  });

  it('groups the compendium, actors first', async () => {
    openTable();
    renderApp('/tables/t1');
    await openPanel('Compendium');
    expect(await screen.findByRole('heading', { name: 'Spells' })).toBeVisible();
    expect(groupsOf('Compendium entries')).toEqual([
      ['Actors', ['Ogre']],
      ['Gear', ['Club']],
      ['Spells', ['Spark']],
    ]);
  });
});
