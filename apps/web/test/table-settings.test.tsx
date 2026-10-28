import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { TableView } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';
import { clearLoadedSystems } from '../src/plugin-host/load.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';
import { openPanel } from './support/workspace.js';

// The table settings panel: archiving (T-0807) and the system version (T-0813).

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
  lang: { en: {} },
  styles: [],
};

/** The settings panel with its system; `table` answers the table as it is now. */
async function openSettings(
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
    ...handlers,
  });
  renderApp('/tables/t1');
  await openPanel('Settings');
  return api;
}

describe('archiving (T-0807)', () => {
  it('archives the table, marks it read-only and unarchives it', async () => {
    let table: TableView = TABLE;
    const answer = (archivedAt: string | null) => () => {
      table = { ...TABLE, archivedAt };
      return { body: { table } };
    };
    const { calls } = await openSettings(
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
    const { calls } = await openSettings(
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
    expect(await screen.findByText('This table plays Tiny d20 0.9.0.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upgrade to 1.0.0' }));
    expect(await screen.findByText('This table plays Tiny d20 1.0.0.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Upgrade to/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/is installed; this table plays/)).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/tables/t1/upgrade-system',
    ]);
  });

  it('offers nothing when the table plays the installed version', async () => {
    await openSettings({});
    expect(await screen.findByText('This table plays Tiny d20 1.0.0.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Upgrade to/ })).not.toBeInTheDocument();
  });
});
