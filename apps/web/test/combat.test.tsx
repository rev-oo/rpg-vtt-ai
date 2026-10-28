import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { EncounterView } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';
import { clearLoadedSystems } from '../src/plugin-host/load.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE, USER } from './support/fake-api.js';
import { fakeWebSocket, serverEvent, type FakeSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';

// T-0801 (FR-COMBAT-01, 03, 04): the combat tracker beside the chat.

afterEach(() => {
  clearLoadedSystems();
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const ENCOUNTER: EncounterView = {
  id: 'e1',
  round: 1,
  currentId: 'c1',
  combatants: [
    { id: 'c1', actorId: null, name: 'Goblin', initiative: 15, hidden: false },
    { id: 'c2', actorId: HERO.id, name: 'Goblin King', initiative: 12, hidden: true },
  ],
};

/** A system with nothing but an initiative formula. */
const SYSTEM = {
  system: {
    id: 'tiny-d20',
    name: 'Tiny d20',
    version: '1.0.0',
    definition: {
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
      combat: { initiative: '1d20' },
    } satisfies PluginDefinition,
    styles: [],
    client: null,
    shared: null,
  },
};

function openTable(
  role: string,
  encounter: () => EncounterView | null,
  handlers: Parameters<typeof fakeApi>[0] = {},
) {
  const sockets = fakeWebSocket();
  const api = fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: { ...TABLE, role } } },
    'GET /tables/t1/members': {
      body: { members: MEMBERS.map((m) => (m.userId === USER.id ? { ...m, role } : m)) },
    },
    'GET /tables/t1/actors': { body: { nextCursor: null, actors: [HERO] } },
    'GET /tables/t1/actors?trash=live&limit=50': { body: { nextCursor: null, actors: [HERO] } },
    'GET /tables/t1/types': { body: TYPES },
    'GET /tables/t1/messages': { body: { messages: [], nextCursor: null } },
    'GET /tables/t1/encounter': () => ({ body: { encounter: encounter() } }),
    ...handlers,
  });
  renderApp('/tables/t1');
  return { ...api, sockets };
}

async function connected(sockets: FakeSocket[]): Promise<FakeSocket> {
  await waitFor(() => {
    expect(sockets.length).toBeGreaterThan(0);
  });
  const socket = sockets.at(-1);
  if (!socket) throw new Error('no socket');
  socket.open();
  await waitFor(() => {
    expect(socket.sent).toContainEqual({ v: 1, type: 'subscribe', tableId: 't1' });
  });
  return socket;
}

const order = () =>
  within(screen.getByRole('list', { name: 'Turn order' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('combat tracker', () => {
  it('shows players the round and whose turn it is, and refetches on combat.updated', async () => {
    let encounter: EncounterView | null = {
      ...ENCOUNTER,
      combatants: ENCOUNTER.combatants.slice(0, 1),
    };
    const { sockets } = openTable('player', () => encounter);
    const socket = await connected(sockets);

    expect(await screen.findByRole('heading', { name: /Combat/ })).toHaveTextContent('Round 1');
    expect(order()).toEqual(['15Goblin']);
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Goblin');
    expect(screen.queryByRole('button', { name: 'Next turn' })).not.toBeInTheDocument();

    encounter = null;
    socket.receive(serverEvent({ type: 'combat.updated', tableId: 't1', payload: {} }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Combat/ })).not.toBeInTheDocument();
    });
  });

  it('lets the GM add a combatant and pass the turn', async () => {
    const after: EncounterView = { ...ENCOUNTER, currentId: 'c2' };
    const { calls } = openTable('gm', () => ENCOUNTER, {
      'POST /tables/t1/encounter/combatants': { status: 201, body: { encounter: ENCOUNTER } },
      'POST /tables/t1/encounter/turn': { body: { encounter: after } },
    });
    const user = userEvent.setup();

    await screen.findByRole('list', { name: 'Turn order' });
    expect(order()[1]).toContain('Hidden');
    await user.selectOptions(screen.getByLabelText('Actor'), HERO.id);
    await user.click(screen.getByLabelText('Hidden'));
    await user.click(screen.getByRole('button', { name: 'Add combatant' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path === '/tables/t1/encounter/combatants')?.body).toEqual({
        actorId: HERO.id,
        hidden: true,
      });
    });

    await user.click(screen.getByRole('button', { name: 'Next turn' }));
    await waitFor(() => {
      expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Goblin King');
    });
    expect(calls.find((c) => c.path === '/tables/t1/encounter/turn')?.body).toEqual({
      direction: 'next',
    });
  });

  it('rolls initiative when the system has a formula (FR-COMBAT-02)', async () => {
    const unrolled: EncounterView = {
      ...ENCOUNTER,
      round: 0,
      currentId: null,
      combatants: ENCOUNTER.combatants.map((c) => ({ ...c, initiative: null })),
    };
    const { calls } = openTable('gm', () => unrolled, {
      'GET /systems/tiny-d20': { body: SYSTEM },
      'POST /tables/t1/encounter/initiative': { body: { encounter: ENCOUNTER } },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Roll initiative' }));
    await waitFor(() => {
      expect(order()).toEqual([
        expect.stringMatching(/^15Goblin/),
        expect.stringMatching(/^12Goblin King/),
      ]);
    });
    expect(calls.some((c) => c.path === '/tables/t1/encounter/initiative')).toBe(true);
    // Everyone has initiative now.
    expect(screen.queryByRole('button', { name: 'Roll initiative' })).not.toBeInTheDocument();
  });

  it('offers the GM to start an encounter', async () => {
    const { calls } = openTable('gm', () => null, {
      'POST /tables/t1/encounter': {
        status: 201,
        body: { encounter: { id: 'e1', round: 0, currentId: null, combatants: [] } },
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start an encounter' }));
    expect(await screen.findByText('No combatants yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Begin' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/tables/t1/encounter')).toBe(true);
  });
});
