import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { PackSummary } from '@vtt/shared/api';

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

describe('compendium', () => {
  it('imports a pack and says what was already there', async () => {
    let pack = PACK;
    fakeWebSocket();
    const { calls } = fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables/t1': { body: { table: TABLE } },
      'GET /tables/t1/members': { body: { members: MEMBERS } },
      'GET /tables/t1/actors': { body: { actors: [HERO] } },
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
      'GET /tables/t1/packs': () => ({ body: { packs: [pack] } }),
      'POST /tables/t1/packs/bestiary/import': () => {
        pack = { ...PACK, imported: 4 };
        return { body: { created: 3, skipped: 1 } };
      },
    });
    renderApp('/tables/t1/settings');
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
