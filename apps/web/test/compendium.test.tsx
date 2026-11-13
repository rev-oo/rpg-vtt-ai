import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { TableRole } from '@vtt/shared';
import type { CompendiumEntry } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';
import { clearLoadedSystems } from '../src/plugin-host/load.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';
import { openPanel } from './support/workspace.js';

// T-1202 (FR-PLUGIN-09, ADR-060): the compendium panel lists pack entries, previews them and
// copies them into the table or onto the caller's actors.

afterEach(() => {
  clearLoadedSystems();
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const DEFINITION: PluginDefinition = {
  manifest: {
    id: 'tiny-d20',
    name: 'Tiny d20',
    version: '1.0.0',
    kind: 'system',
    coreApi: '^1.0.0',
    hasCode: false,
    locales: ['en'],
  },
  actorTypes: {
    npc: {
      label: 'type.npc',
      controlledBy: 'gm',
      sheet: 'npc',
      schema: { type: 'object', properties: { str: { type: 'integer', default: 10 } } },
    },
  },
  itemTypes: {
    weapon: {
      label: 'type.weapon',
      sheet: 'weapon',
      schema: { type: 'object', properties: { damage: { type: 'string', default: '1d4' } } },
    },
  },
  sheets: {
    npc: { layout: { type: 'field', path: 'str', label: 'Strength', input: 'number' } },
    weapon: { layout: { type: 'field', path: 'damage', label: 'Damage' } },
  },
  rolls: {},
  dice: {},
  cards: {},
  settings: {},
  lang: { en: { 'pack.bestiary': 'Bestiary', 'type.npc': 'Creature', 'type.weapon': 'Weapon' } },
  styles: [],
};

const OGRE: CompendiumEntry = {
  ref: 'tiny-d20:bestiary:ogre',
  pack: 'bestiary',
  kind: 'actor',
  type: 'npc',
  name: 'Ogre',
  system: { str: 19 },
  inTable: false,
};
const SWORD: CompendiumEntry = {
  ref: 'tiny-d20:bestiary:shortsword',
  pack: 'bestiary',
  kind: 'item',
  type: 'weapon',
  name: 'Shortsword',
  system: { damage: '1d6' },
  inTable: true,
};

const BESTIARY = {
  name: 'bestiary',
  label: 'pack.bestiary',
  attribution: { text: 'From the Tiny SRD.', url: null },
};

const page = (...entries: CompendiumEntry[]) => ({
  body: {
    packs: [BESTIARY],
    entries,
    nextCursor: null,
  },
});

/** The table with its compendium panel open. */
async function openCompendium(role: TableRole, handlers: Parameters<typeof fakeApi>[0] = {}) {
  fakeWebSocket();
  const actors = { body: { nextCursor: null, actors: [HERO] } };
  const api = fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: { ...TABLE, role } } },
    'GET /tables/t1/members': { body: { members: MEMBERS } },
    'GET /tables/t1/actors': actors,
    'GET /tables/t1/actors?trash=live&limit=50': actors,
    'GET /tables/t1/types': { body: TYPES },
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
    'GET /tables/t1/compendium?limit=50': page(OGRE, SWORD),
    'GET /tables/t1/compendium/entries/tiny-d20%3Abestiary%3Aogre': {
      body: { entry: OGRE, pack: BESTIARY },
    },
    ...handlers,
  });
  renderApp('/tables/t1');
  await openPanel('Compendium');
  return api;
}

const entries = () => screen.findByRole('list', { name: 'Compendium entries' });
const row = async (name: string) =>
  within(await entries())
    .getAllByRole('listitem')
    .find((item) => within(item).queryByRole('heading', { name }) !== null) ?? null;

describe('compendium browser', () => {
  it('lists entries with their pack and whether the table has them, and opens a sheet', async () => {
    await openCompendium('gm');
    const user = userEvent.setup();
    expect(await within(await entries()).findByRole('heading', { name: 'Ogre' })).toBeVisible();
    const sword = await row('Shortsword');
    expect(sword).toHaveTextContent('Bestiary');
    expect(sword).toHaveTextContent('In the table');
    expect(await row('Ogre')).not.toHaveTextContent('In the table');
    // Types show by the system's label, not their id (T-1620).
    expect(await row('Ogre')).toHaveTextContent('Type: Creature');
    expect(sword).toHaveTextContent('Type: Weapon');

    // An entry opens as a read-only sheet in a panel of its own (T-1620).
    await user.click(screen.getByRole('button', { name: 'Open compendium entry: Ogre' }));
    const sheet = await screen.findByRole('tabpanel', { name: 'Ogre' });
    expect(await within(sheet).findByLabelText('Strength')).toHaveValue('19');
    expect(within(sheet).getByLabelText('Strength')).toHaveAttribute('readonly');
    expect(sheet).toHaveTextContent('Creature · Bestiary · compendium, read-only');
    // The pack's credit shows beside the entry it credits (T-1614).
    expect(within(sheet).getByText('From the Tiny SRD.')).toBeVisible();
  });

  it('lets the GM copy an entry into the table', async () => {
    const { calls } = await openCompendium('gm', {
      'POST /tables/t1/compendium/copy': { status: 201, body: { actors: [], items: [] } },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Copy Ogre to the table' }));
    expect(await screen.findByText('Ogre was copied to the table.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      refs: ['tiny-d20:bestiary:ogre'],
    });
  });

  it('lets a player copy items onto actors they own, and nothing into the table', async () => {
    const { calls } = await openCompendium('player', {
      'POST /tables/t1/compendium/copy': { status: 201, body: { actors: [], items: [] } },
    });
    const user = userEvent.setup();
    await within(await entries()).findByRole('heading', { name: 'Ogre' });
    expect(screen.queryByRole('button', { name: /to the table$/ })).toBeNull();
    expect(screen.queryByLabelText('Actor to copy Ogre onto')).toBeNull();

    const onto = screen.getByLabelText('Actor to copy Shortsword onto');
    expect(onto).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Copy Shortsword onto the chosen actor' }),
    ).toBeDisabled();
    await user.selectOptions(onto, 'a1');
    await user.click(screen.getByRole('button', { name: 'Copy Shortsword onto the chosen actor' }));
    expect(await screen.findByText('Shortsword was copied onto Goblin King.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      refs: ['tiny-d20:bestiary:shortsword'],
      actorId: 'a1',
    });
  });

  it('filters by name and type', async () => {
    const { calls } = await openCompendium('gm', {
      'GET /tables/t1/compendium?search=og&limit=50': page(OGRE),
      'GET /tables/t1/compendium?kind=item&type=weapon&limit=50': page(SWORD),
    });
    const user = userEvent.setup();
    await within(await entries()).findByRole('heading', { name: 'Shortsword' });

    await user.type(screen.getByLabelText('Search the compendium'), 'og');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Shortsword' })).toBeNull();
    });
    await user.clear(screen.getByLabelText('Search the compendium'));
    expect(screen.getByRole('option', { name: 'Creature' })).toHaveValue('actor:npc');
    await user.selectOptions(screen.getByLabelText('Type'), 'item:weapon');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Ogre' })).toBeNull();
    });
    expect(calls.map((c) => c.path)).toContain(
      '/tables/t1/compendium?kind=item&type=weapon&limit=50',
    );
  });
});
