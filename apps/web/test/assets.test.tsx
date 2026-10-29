import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { AssetView } from '@vtt/shared/api';
import { createMemoryStore, type SheetStore } from '@vtt/sheet-renderer';

import { setCsrfToken } from '../src/api/client.js';
import type { LiveSheet } from '../src/collab/use-live-sheet.js';
import { clearLoadedSystems } from '../src/plugin-host/load.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';
import { openPanel, openSheet } from './support/workspace.js';

// T-1302 (FR-ASSET-02, ADR-065): the Images panel uploads, lists and deletes a table's
// images, and image fields pick from them.

/** The actor's live data, as the sheet's store writes it. */
let store: SheetStore = createMemoryStore({});
const collab = vi.hoisted(() => ({ sheet: null as LiveSheet | null }));
vi.mock('../src/collab/use-live-sheet.js', () => ({ useLiveSheet: () => collab.sheet }));

afterEach(() => {
  collab.sheet = null;
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
  actorTypes: {
    npc: {
      label: 'NPC',
      controlledBy: 'gm',
      sheet: 'npc',
      schema: {
        type: 'object',
        properties: { portrait: { type: 'string', 'x-kind': 'image', default: '' } },
      },
    },
  },
  itemTypes: {},
  sheets: { npc: { layout: { type: 'image', path: 'portrait' } } },
  rolls: {},
  dice: {},
  cards: {},
  settings: {},
  lang: { en: {} },
  styles: [],
};

const asset = (id: string, name: string): AssetView => ({
  id,
  tableId: TABLE.id,
  uploaderId: 'u1',
  name,
  type: 'image/png',
  size: 68,
  url: `/api/v1/assets/${id}`,
  createdAt: '2026-10-29T12:00:00.000Z',
});
const CAVE = asset('11111111-1111-4111-8111-111111111111', 'cave.png');
const MAP = asset('22222222-2222-4222-8222-222222222222', 'map.png');
const TOWN = asset('33333333-3333-4333-8333-333333333333', 'town.gif');

function openTable({ role = 'gm' }: { role?: 'gm' | 'player' } = {}) {
  fakeWebSocket();
  store = createMemoryStore({});
  collab.sheet = {
    status: 'ready',
    store: { ...store, richText: () => undefined, destroy: () => undefined },
    readOnly: role !== 'gm',
    issues: [],
    awareness: undefined,
  };
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
    'GET /tables/t1/assets': { body: { assets: [CAVE] } },
    'POST /tables/t1/assets?name=map.png': { status: 201, body: { asset: MAP } },
    'POST /tables/t1/assets?name=town.gif': { status: 201, body: { asset: TOWN } },
    'DELETE /assets/11111111-1111-4111-8111-111111111111': {
      status: 409,
      body: {
        error: {
          code: 'asset_in_use',
          message: 'The image is still used, so it was not deleted.',
          details: { uses: [{ kind: 'actor', id: 'a1', name: 'Goblin King' }] },
        },
      },
    },
    'DELETE /assets/22222222-2222-4222-8222-222222222222': { status: 204 },
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
    'PATCH /actors/a1': (body) => ({
      body: { actor: { ...HERO, ...(body as object) } },
    }),
  });
  renderApp('/tables/t1');
  return api;
}

const png = (name: string) =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
const gallery = () => screen.findByRole('list', { name: 'Images of the table' });

describe('the Images panel (T-1302)', () => {
  it('uploads by picking or dropping files, and lists them newest first', async () => {
    const api = openTable();
    await openPanel('Images');
    expect(
      within(await gallery())
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['cave.png']);

    await userEvent.upload(screen.getByLabelText('Image files'), png('map.png'));
    expect(await screen.findByText('Images uploaded: 1.')).toBeVisible();
    const sent = api.calls.find((call) => call.method === 'POST');
    expect(sent).toMatchObject({ path: '/tables/t1/assets?name=map.png' });
    expect(sent?.headers.get('content-type')).toBe('image/png');
    expect(
      within(await gallery())
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['map.png', 'cave.png']);

    const zone = (await gallery()).parentElement;
    if (!zone) throw new Error('no drop zone');
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [png('town.gif')] } });
    expect(await screen.findByRole('listitem', { name: 'town.gif' })).toBeVisible();
  });

  it('deletes unused images after asking, and says where a used one is used', async () => {
    const api = openTable();
    await openPanel('Images');
    await userEvent.upload(await screen.findByLabelText('Image files'), png('map.png'));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete map.png' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this image?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Deleted map.png.')).toBeVisible();
    expect(screen.queryByRole('listitem', { name: 'map.png' })).toBeNull();
    expect(api.calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', path: `/assets/${MAP.id}` }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete cave.png' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete this image?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(
      await screen.findByText(
        'cave.png is still used, so it was not deleted. Remove it from these first:',
      ),
    ).toBeVisible();
    expect(screen.getByText('Actor: Goblin King')).toBeVisible();
    expect(screen.getByRole('listitem', { name: 'cave.png' })).toBeVisible();
  });

  it('shows players the images without upload or delete', async () => {
    openTable({ role: 'player' });
    await openPanel('Images');
    expect(await screen.findByRole('listitem', { name: 'cave.png' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Upload images' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete cave.png' })).toBeNull();
  });
});

describe('the image picker (T-1302)', () => {
  it("sets an actor's portrait from the table's images, or from a URL", async () => {
    const api = openTable();
    await openSheet('Goblin King');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Choose image for Goblin King' }),
    );
    const picker = screen.getByRole('dialog', { name: 'Choose an image' });
    await userEvent.click(await within(picker).findByRole('button', { name: 'Use cave.png' }));
    expect(api.calls).toContainEqual(
      expect.objectContaining({
        method: 'PATCH',
        path: '/actors/a1',
        body: { imageUrl: CAVE.url },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Choose image for Goblin King' }));
    const again = screen.getByRole('dialog', { name: 'Choose an image' });
    await userEvent.type(within(again).getByLabelText('Or an image URL'), 'javascript:alert(1)');
    await userEvent.click(within(again).getByRole('button', { name: 'Use URL' }));
    expect(within(again).getByText('Enter an http or https address.')).toBeVisible();
    await userEvent.clear(within(again).getByLabelText('Or an image URL'));
    await userEvent.type(
      within(again).getByLabelText('Or an image URL'),
      'https://example.com/ogre.png',
    );
    await userEvent.click(within(again).getByRole('button', { name: 'Use URL' }));
    expect(api.calls).toContainEqual(
      expect.objectContaining({
        method: 'PATCH',
        path: '/actors/a1',
        body: { imageUrl: 'https://example.com/ogre.png' },
      }),
    );
  });
});

describe("a sheet's image fields (ADR-065)", () => {
  it('pick a picture through the image picker, and remove it', async () => {
    openTable();
    await openSheet('Goblin King');
    const field = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.vtt-sheet [data-field="portrait"]');
      if (!found) throw new Error('no portrait field');
      return found;
    });
    expect(field).toHaveTextContent('Choose image');
    await userEvent.click(field);
    const picker = screen.getByRole('dialog', { name: 'Choose an image' });
    await userEvent.click(await within(picker).findByRole('button', { name: 'Use cave.png' }));
    expect(store.getSnapshot()).toEqual({ portrait: CAVE.url });
    expect(field.querySelector('img')).toHaveAttribute('src', CAVE.url);

    await userEvent.click(field);
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Choose an image' })).getByRole('button', {
        name: 'Remove image',
      }),
    );
    expect(store.getSnapshot()).toEqual({ portrait: '' });
  });
});
