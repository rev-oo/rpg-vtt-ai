import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetView } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';
import { openPanel, openSheet } from './support/workspace.js';

// T-1302 (FR-ASSET-02, ADR-065): the Images panel uploads, lists and deletes a table's
// images, and image fields pick from them.

vi.mock('../src/collab/use-live-sheet.js', () => ({ useLiveSheet: () => null }));

afterEach(() => {
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

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
    await userEvent.click(await screen.findByRole('button', { name: 'Choose image' }));
    const picker = screen.getByRole('dialog', { name: 'Choose an image' });
    await userEvent.click(await within(picker).findByRole('button', { name: 'Use cave.png' }));
    expect(api.calls).toContainEqual(
      expect.objectContaining({
        method: 'PATCH',
        path: '/actors/a1',
        body: { imageUrl: CAVE.url },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Choose image' }));
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
