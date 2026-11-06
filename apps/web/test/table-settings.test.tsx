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

// The table settings panel: archiving (T-0807), the system version (T-0813), and modules and
// settings by scope (T-1601).

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
    'GET /tables/t1/modules': { body: { modules: [] } },
    'GET /modules': { body: { modules: [] } },
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
          return { body: { table, migration: { migrated: 3, failedCount: 0, failed: [] } } };
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

  it('reports what it could not migrate, and migrates it again (T-1501)', async () => {
    let table: TableView = { ...TABLE, systemVersion: '0.9.0', installedVersion: '1.0.0' };
    let attempt = 0;
    const failed = [
      {
        kind: 'actor',
        id: 'a1',
        name: 'Broken',
        reason: 'step',
        version: '1.0.0',
        step: 1,
      },
      {
        kind: 'item',
        id: 'i1',
        name: 'Odd sword',
        reason: 'invalid',
        issues: [{ path: ['damage', 'dice'], reason: 'type' }],
      },
    ];
    const { calls } = await openSettings(
      {
        'POST /tables/t1/upgrade-system': () => {
          attempt += 1;
          const left = attempt === 1 ? failed : [];
          table = { ...table, systemVersion: '1.0.0', outdatedEntities: left.length };
          const migration = {
            migrated: attempt === 1 ? 4 : 2,
            failedCount: left.length,
            failed: left,
          };
          return { body: { table, migration } };
        },
      },
      () => table,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Upgrade to 1.0.0' }));
    expect(await screen.findByText('Actors and items migrated: 4.')).toBeInTheDocument();
    expect(
      screen.getByText('Could not migrate: 2. They keep their data as it was.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/step 2 of the 1\.0\.0 migration could not run/)).toBeInTheDocument();
    expect(screen.getByText(/the result does not fit: damage\.dice/)).toBeInTheDocument();
    expect(
      await screen.findByText(/^Actors and items still on data from an older version: 2\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Migrate again' }));
    expect(await screen.findByText('Actors and items migrated: 2.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Migrate again' })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/^Could not migrate/)).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it('offers nothing when the table plays the installed version', async () => {
    await openSettings({});
    expect(await screen.findByText('This table plays Tiny d20 1.0.0.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Upgrade to/ })).not.toBeInTheDocument();
  });
});

const MODULE_DEFINITION: PluginDefinition = {
  ...DEFINITION,
  manifest: { ...DEFINITION.manifest, id: 'glow', name: 'Glow', kind: 'module', hasCode: true },
  settings: {
    bright: { type: 'boolean', default: true, label: 'setting.bright' },
    colour: { type: 'string', default: 'red', label: 'Colour', scope: 'user' },
    quality: { type: 'string', default: 'high', label: 'Quality', scope: 'instance' },
  },
  lang: { en: { 'setting.bright': 'Bright glow' } },
};

const GLOW = {
  id: 'glow',
  name: 'Glow',
  version: '1.0.0',
  definition: MODULE_DEFINITION,
  styles: [],
  client: '/plugins/glow/code/client.js',
  settings: { bright: true, colour: 'red', quality: 'high' },
};

describe('modules and settings by scope (T-1601)', () => {
  it('lets the GM choose modules and set their table settings', async () => {
    let table: TableView = TABLE;
    const { calls } = await openSettings(
      {
        'GET /modules': {
          body: {
            modules: [{ id: 'glow', name: 'Glow', version: '1.0.0', description: 'Shiny.' }],
          },
        },
        'GET /tables/t1/modules': () => ({
          body: { modules: table.modules.includes('glow') ? [GLOW] : [] },
        }),
        'PATCH /tables/t1': (body) => {
          table = { ...table, ...(body as Partial<TableView>) };
          return { body: { table } };
        },
      },
      () => table,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('checkbox', { name: /Glow/ }));
    await user.click(screen.getByRole('button', { name: 'Save modules' }));
    // Its table settings only: the user and instance ones are set elsewhere.
    const bright = await screen.findByRole('checkbox', { name: 'Bright glow' });
    expect(screen.queryByLabelText('Quality')).not.toBeInTheDocument();
    await user.click(bright);
    await user.click(screen.getByRole('button', { name: 'Save modules' }));

    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
        { modules: ['glow'], moduleSettings: {} },
        { modules: ['glow'], moduleSettings: { glow: { bright: false } } },
      ]);
    });
    // The GM's own settings of the module are there too.
    expect(await screen.findByRole('region', { name: 'My settings of Glow' })).toBeInTheDocument();
  });

  it('shows players only their own settings, and saves them for themselves', async () => {
    const { calls } = await openSettings(
      {
        'GET /tables/t1/modules': { body: { modules: [GLOW] } },
        'GET /me/plugins/glow/settings': {
          body: {
            definitions: { colour: MODULE_DEFINITION.settings.colour },
            lang: MODULE_DEFINITION.lang,
            defaultLocale: 'en',
            values: {},
          },
        },
        'PATCH /me/plugins/glow/settings': (body) => ({
          body: {
            definitions: { colour: MODULE_DEFINITION.settings.colour },
            lang: MODULE_DEFINITION.lang,
            defaultLocale: 'en',
            values: (body as { values: Record<string, unknown> }).values,
          },
        }),
      },
      () => ({ ...TABLE, role: 'player', modules: ['glow'] }),
    );
    const user = userEvent.setup();

    const colour = await screen.findByLabelText('Colour');
    expect(colour).toHaveValue('red');
    expect(screen.queryByRole('button', { name: 'Save modules' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive table' })).not.toBeInTheDocument();
    await user.clear(colour);
    await user.type(colour, 'blue');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('The settings were saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: '/me/plugins/glow/settings',
      body: { values: { colour: 'blue' } },
    });
  });
});
