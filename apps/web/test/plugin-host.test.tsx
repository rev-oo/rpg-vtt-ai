import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { ChatMessage } from '@vtt/shared/api';
import { createMemoryStore } from '@vtt/sheet-renderer';

import { setCsrfToken } from '../src/api/client.js';
import type { LiveSheet } from '../src/collab/use-live-sheet.js';
import { clearLoadedSystems, sharedFunctions, systemTranslator } from '../src/plugin-host/load.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';

/**
 * The sheet's live documents. The Yjs store and the socket are tested on their own
 * (`collab.test.ts`, e2e); here the route gets a ready sheet over a memory store.
 */
const collab = vi.hoisted(() => ({
  sheet: null as LiveSheet | null,
  opened: [] as { actorId: string; secret: boolean }[],
}));
vi.mock('../src/collab/use-live-sheet.js', () => ({
  useLiveSheet: (actorId: string, _layout: unknown, { secret }: { secret: boolean }) => {
    collab.opened.push({ actorId, secret });
    return collab.sheet;
  },
}));

const liveData = (overrides: Partial<Extract<LiveSheet, { status: 'ready' }>> = {}) => {
  const sheet: Extract<LiveSheet, { status: 'ready' }> = {
    status: 'ready',
    store: {
      ...createMemoryStore({ str: 13, secret: 'hidden lair' }),
      richText: () => undefined,
      destroy: () => undefined,
    },
    readOnly: false,
    issues: [],
    awareness: undefined,
    ...overrides,
  };
  collab.sheet = sheet;
  return sheet;
};

afterEach(() => {
  collab.sheet = null;
  collab.opened = [];
  closeEventsClient();
  clearLoadedSystems();
  vi.unstubAllGlobals();
  setCsrfToken(null);
  document.head.querySelectorAll('link[data-plugin-style]').forEach((link) => {
    link.remove();
  });
});

/** The definition of `TABLE`'s system, as `GET /systems/:id` sends it. */
const DEFINITION: PluginDefinition = {
  manifest: {
    id: 'tiny-d20',
    name: 'Tiny d20',
    version: '1.0.0',
    kind: 'system',
    coreApi: '^0.1.0',
    hasCode: false,
    locales: ['en'],
    defaultLocale: 'en',
  },
  actorTypes: {
    npc: {
      label: 'type.npc',
      controlledBy: 'gm',
      sheet: 'npc',
      schema: {
        type: 'object',
        properties: {
          str: { type: 'integer', default: 12 },
          secret: { type: 'string', default: 'hidden lair', 'x-layer': 'secret' },
        },
      },
      derived: { strMod: 'floor((@str - 10) / 2)' },
    },
  },
  itemTypes: {},
  sheets: {
    npc: {
      layout: {
        type: 'column',
        children: [
          { type: 'field', path: 'str', label: 'field.str', input: 'number' },
          { type: 'field', path: 'secret', label: 'Lair' },
          { type: 'rollButton', roll: 'attack', label: 'roll.attack' },
        ],
      },
    },
  },
  rolls: { attack: { label: 'roll.attack', formula: '1d20 + @derived.strMod', card: 'attack' } },
  dice: {},
  cards: {
    attack: {
      title: 'card.attack',
      rows: [{ label: 'card.total', value: '@total' }],
      outcome: true,
    },
  },
  settings: {},
  lang: {
    en: {
      'field.str': 'Strength',
      'roll.attack': 'Attack',
      'card.attack': 'Attack roll',
      'card.total': 'Total',
      'outcome.hit': 'Hit',
    },
  },
  styles: ['styles/sheet.css'],
};

const SYSTEM = {
  system: {
    id: 'tiny-d20',
    name: 'Tiny d20',
    version: '1.0.0',
    definition: DEFINITION,
    styles: ['/plugins/tiny-d20/styles/sheet.css'],
    client: null,
    shared: null as string | null,
  },
};

const CARD_MESSAGE: ChatMessage = {
  id: 'm1',
  tableId: TABLE.id,
  senderId: 'u1',
  speaker: { name: 'Goblin King', actorId: HERO.id, imageUrl: null },
  audience: 'public',
  recipientIds: [],
  kind: 'card',
  text: 'Attack: 1d20 + 1 = 15 (Hit)',
  rolls: [{ expression: '1d20 + @derived.strMod', resolved: '1d20 + 1', total: 15, dice: [] }],
  card: {
    system: 'tiny-d20',
    recipe: 'attack',
    label: 'roll.attack',
    outcome: { index: 0, label: 'outcome.hit' },
    card: {
      name: 'attack',
      title: 'card.attack',
      outcome: true,
      rows: [{ label: 'card.total', value: '15' }],
    },
  },
  createdAt: '2026-10-20T12:00:00.000Z',
  editedAt: null,
};

function openTable(
  path: string,
  { role = 'gm', systemAvailable = true, system = SYSTEM, messages = [CARD_MESSAGE] } = {},
) {
  fakeWebSocket();
  if (!collab.sheet) liveData();
  const api = fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: { ...TABLE, role, systemAvailable } } },
    'GET /tables/t1/members': { body: { members: MEMBERS } },
    'GET /tables/t1/actors': {
      body: { nextCursor: null, actors: [{ ...HERO, system: { str: 13 } }] },
    },
    'GET /tables/t1/actors?trash=live&limit=50': { body: { nextCursor: null, actors: [HERO] } },
    'GET /tables/t1/types': { body: TYPES },
    'GET /tables/t1/messages': { body: { messages, nextCursor: null } },
    'GET /systems/tiny-d20': { body: system },
    'POST /tables/t1/rolls': { status: 201, body: { message: CARD_MESSAGE } },
    'GET /actors/a1/history': {
      body: {
        snapshots: [
          { id: 's2', layer: 'secret', createdAt: '2026-10-20T12:05:00.000Z' },
          { id: 's1', layer: 'main', createdAt: '2026-10-20T12:00:00.000Z' },
        ],
      },
    },
    'POST /actors/a1/history/s1/restore': { status: 204 },
  });
  renderApp(path);
  return api;
}

const log = () => screen.findByRole('log', { name: 'Messages' });

describe('plugin host (T-0409)', () => {
  it('opens an actor sheet from the list and edits its live data (T-0506)', async () => {
    const sheet = liveData();
    openTable('/tables/t1');
    await userEvent.click(await screen.findByRole('link', { name: 'Open sheet: Goblin King' }));
    const strength = await screen.findByLabelText('Strength');
    expect(strength).toHaveValue('13');
    expect(strength).not.toHaveAttribute('readonly');
    await userEvent.clear(strength);
    await userEvent.type(strength, '15');
    await userEvent.tab();
    expect(sheet.store.getSnapshot()).toMatchObject({ str: 15 });
    // GMs open the secret layer and see it (FR-SHEET-04).
    expect(screen.getByLabelText('Lair')).toHaveValue('hidden lair');
    expect(collab.opened.at(-1)).toEqual({ actorId: 'a1', secret: true });
    expect(document.head.querySelector('link[data-plugin-style]')).toHaveAttribute(
      'href',
      '/plugins/tiny-d20/styles/sheet.css',
    );
  });

  it('rolls a recipe for the owner and reports it', async () => {
    const { calls } = openTable('/tables/t1/actors/a1');
    await userEvent.click(await screen.findByRole('button', { name: 'Attack' }));
    expect(await screen.findByText('Rolled. The result is in the chat.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      recipe: { name: 'attack', args: {} },
      actorId: 'a1',
    });
  });

  it('lists the sheet history and restores a snapshot (T-0806)', async () => {
    const { calls } = openTable('/tables/t1/actors/a1');
    await userEvent.click(await screen.findByRole('button', { name: 'History' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sheet history' });
    const restores = await within(dialog).findAllByRole('button', { name: /^Restore / });
    expect(restores).toHaveLength(2);
    expect(within(dialog).getByText('GM data')).toBeInTheDocument();
    await userEvent.click(restores[1] ?? dialog);
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      /^Restored the sheet as it was at /,
    );
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/s1/restore'))).toBe(true);
  });

  it('hides secret fields and roll buttons from spectators', async () => {
    openTable('/tables/t1/actors/a1', { role: 'spectator' });
    expect(await screen.findByLabelText('Strength')).toBeInTheDocument();
    expect(screen.queryByLabelText('Lair')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attack' })).toBeDisabled();
    expect(collab.opened.at(-1)).toEqual({ actorId: 'a1', secret: false });
  });

  it('follows the server: read-only documents, repairs and connecting (FR-SHEET-03, 09)', async () => {
    liveData({ readOnly: true, issues: [{ path: ['str'], reason: 'maximum' }] });
    openTable('/tables/t1/actors/a1');
    expect(await screen.findByLabelText('Strength')).toHaveAttribute('readonly');
    expect(screen.getByText(/were reset to their default \(1\)/)).toBeInTheDocument();
  });

  it('waits for the documents before showing the sheet', async () => {
    collab.sheet = { status: 'connecting' };
    openTable('/tables/t1/actors/a1');
    expect(await screen.findByText('Connecting to the sheet…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Strength')).not.toBeInTheDocument();
  });

  it('draws recipe cards in the chat with the plugin texts (FR-CHAT-06)', async () => {
    openTable('/tables/t1');
    const card = await within(await log()).findByText('Attack roll');
    const message = card.closest('[data-plugin]');
    expect(message).toHaveAttribute('data-plugin', 'tiny-d20');
    expect(message).toHaveTextContent('Total15');
    expect(message).toHaveTextContent('Hit');
  });

  it('keeps the table read-only and cards as text while the system is unavailable', async () => {
    const { calls } = openTable('/tables/t1', { systemAvailable: false });
    expect(await screen.findByText(/this table is read-only/)).toBeInTheDocument();
    expect(await within(await log()).findByText('Attack: 1d20 + 1 = 15 (Hit)')).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some((c) => c.path === '/tables/t1/messages')).toBe(true);
    });
    expect(calls.some((c) => c.path.startsWith('/systems/'))).toBe(false);
  });

  it('translates plugin texts with fallbacks (specs §8.3)', () => {
    const translate = systemTranslator(
      { ...DEFINITION, lang: { en: { a: 'A' }, 'pt-BR': { a: 'Á', b: 'B' } } },
      'pt-BR',
    );
    expect([translate('a'), translate('b'), translate('Plain text')]).toEqual([
      'Á',
      'B',
      'Plain text',
    ]);
    expect(systemTranslator(DEFINITION, 'fr')('card.total')).toBe('Total');
  });

  it('works out derived values with the plugin’s shared functions (T-0809)', async () => {
    const npc = DEFINITION.actorTypes.npc;
    if (!npc) throw new Error('fixture');
    const definition: PluginDefinition = {
      ...DEFINITION,
      actorTypes: { npc: { ...npc, derived: { power: 'twice(@str)' } } },
      sheets: {
        npc: { layout: { type: 'derived', key: 'power', label: 'Power' } },
      },
    };
    openTable('/tables/t1/actors/a1', {
      system: {
        // Served from the project root, as the server serves plugin files.
        system: { ...SYSTEM.system, definition, shared: '/test/fixtures/shared.js' },
      },
    });
    // The live sheet holds str 13 (see liveData).
    expect(await screen.findByText('26')).toBeInTheDocument();
  });

  it('checks the default export of code/shared.js', () => {
    const twice = (x: unknown) => Number(x) * 2;
    expect(sharedFunctions({ default: { functions: { twice } } })).toEqual({ twice });
    expect(sharedFunctions({ default: {} })).toEqual({});
    expect(() => sharedFunctions({ default: { functions: { twice: 2 } } })).toThrow('defineShared');
    expect(() => sharedFunctions({})).toThrow('defineShared');
  });

  it('shows the text plugin code posts with its rolls (ADR-047)', async () => {
    const roll = { expression: '1d1 + 2', resolved: '1d1 + 2', total: 3, dice: [] };
    openTable('/tables/t1', {
      messages: [
        {
          ...CARD_MESSAGE,
          id: 'm2',
          kind: 'roll',
          card: null,
          text: 'Ayla strikes',
          rolls: [roll],
        },
        { ...CARD_MESSAGE, id: 'm3', kind: 'roll', card: null, text: '1d1 + 2', rolls: [roll] },
      ],
    });
    const messages = await log();
    expect(await within(messages).findByText('Ayla strikes')).toBeInTheDocument();
    // A typed roll's text is its formula, shown once by the roll itself.
    expect(within(messages).getAllByText('1d1 + 2')).toHaveLength(2);
  });
});
