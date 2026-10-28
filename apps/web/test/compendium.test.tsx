import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { PackSummary, TableView } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';
import { clearLoadedSystems } from '../src/plugin-host/load.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';

// T-0803 (FR-PLUGIN-09): importing a compendium pack from the table settings.

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
    coreApi: '^0.1.0',
    hasCode: false,
    locales: ['en'],
  },
  actorTypes: {},
  itemTypes: {},
  sheets: {},
  rolls: {},
  dice: {},
  cards: {},
  settings: {},
  lang: { en: { 'pack.bestiary': 'Bestiary' } },
  styles: [],
};

const PACK: PackSummary = {
  name: 'bestiary',
  label: 'pack.bestiary',
  actors: 2,
  items: 2,
  imported: 0,
};

/** The settings page with its system and packs; `table` answers the table as it is now. */
function openSettings(
  handlers: Parameters<typeof fakeApi>[0],
  table: () => TableView = () => TABLE,
) {
  fakeWebSocket();
  const api = fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': () => ({ body: { table: table() } }),
    'GET /tables/t1/members': { body: { members: MEMBERS } },
    'GET /tables/t1/actors': { body: { nextCursor: null, actors: [HERO] } },
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
    'GET /tables/t1/packs': { body: { packs: [PACK] } },
    ...handlers,
  });
  renderApp('/tables/t1/settings');
  return api;
}

describe('compendium', () => {
  it('imports a pack and says what was already there', async () => {
    let pack = PACK;
    const { calls } = openSettings({
      'GET /tables/t1/packs': () => ({ body: { packs: [pack] } }),
      'POST /tables/t1/packs/bestiary/import': () => {
        pack = { ...PACK, imported: 4 };
        return { body: { created: 3, skipped: 1 } };
      },
    });
    const user = userEvent.setup();

    expect(await screen.findByText('Bestiary')).toBeInTheDocument();
    expect(screen.getByText('2 actors, 2 items · 0 in this table')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import Bestiary' }));
    expect(await screen.findByText('Imported 3; 1 were already in the table.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import Bestiary' })).toBeDisabled();
    });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('archiving (T-0807)', () => {
  it('archives the table, marks it read-only and unarchives it', async () => {
    let table: TableView = TABLE;
    const answer = (archivedAt: string | null) => () => {
      table = { ...TABLE, archivedAt };
      return { body: { table } };
    };
    const { calls } = openSettings(
      {
        'POST /tables/t1/archive': answer('2026-10-27T12:00:00.000Z'),
        'POST /tables/t1/unarchive': answer(null),
      },
      () => table,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Archive table' }));
    expect(await screen.findByText('This table is archived: it is read-only.')).toBeInTheDocument();
    expect(screen.getByText('The table is archived: the chat is read-only.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unarchive table' }));
    await waitFor(() => {
      expect(
        screen.queryByText('This table is archived: it is read-only.'),
      ).not.toBeInTheDocument();
    });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/tables/t1/archive',
      '/tables/t1/unarchive',
    ]);
  });
});

describe('system version (T-0813)', () => {
  it('upgrades the table to the installed version when the GM asks', async () => {
    let table: TableView = { ...TABLE, systemVersion: '0.9.0', installedVersion: '1.0.0' };
    const { calls } = openSettings(
      {
        'POST /tables/t1/upgrade-system': () => {
          table = { ...table, systemVersion: '1.0.0' };
          return { body: { table } };
        },
      },
      () => table,
    );
    const user = userEvent.setup();

    expect(
      await screen.findByText('Tiny d20 1.0.0 is installed; this table plays 0.9.0.'),
    ).toBeInTheDocument();
    expect(screen.getByText('This table plays Tiny d20 0.9.0.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upgrade to 1.0.0' }));
    expect(await screen.findByText('This table plays Tiny d20 1.0.0.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Upgrade to/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/is installed; this table plays/)).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/tables/t1/upgrade-system',
    ]);
  });

  it('offers nothing when the table plays the installed version', async () => {
    openSettings({});
    expect(await screen.findByText('This table plays Tiny d20 1.0.0.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Upgrade to/ })).not.toBeInTheDocument();
  });
});
