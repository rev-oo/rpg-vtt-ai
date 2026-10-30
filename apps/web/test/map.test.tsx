import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SceneView } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';
import { cellAt, cellCentre, gridSegments, sceneSize } from '../src/features/map/geometry.js';
import {
  clampView,
  fitView,
  PAN_STEP,
  viewForKey,
  zoomLimits,
  ZOOM_STEP,
} from '../src/features/map/view.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE, USER } from './support/fake-api.js';
import { fakeWebSocket, serverEvent, type FakeSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';
import { openPanel } from './support/workspace.js';

// T-1402 (FR-MAP-01, 02; ADR-067): the scene model behind the map canvas, and the panels
// around it. WebGL is not in jsdom, so the canvas itself is replaced by its scene's name.

vi.mock('../src/features/map/MapCanvas.js', () => ({
  default: ({ scene }: { scene: SceneView }) => <p>Canvas: {scene.name}</p>,
}));

afterEach(() => {
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('scene geometry', () => {
  const square = { columns: 30, rows: 20, gridType: 'square', gridSize: 70 } as const;
  const hex = { columns: 10, rows: 8, gridType: 'hex', gridSize: 60 } as const;

  it('sizes square and hex grids', () => {
    expect(sceneSize(square)).toEqual({ width: 2100, height: 1400 });
    const radius = 60 / Math.sqrt(3);
    const size = sceneSize(hex);
    expect(size.width).toBe(10 * 60 + 30);
    expect(size.height).toBeCloseTo(7 * 1.5 * radius + 2 * radius);
    // One row of hexes has no shifted row to make room for.
    expect(sceneSize({ ...hex, rows: 1 }).width).toBe(600);
  });

  it('finds the cell under each cell centre, on both grids', () => {
    for (const grid of [square, hex]) {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: grid.columns - 1 }),
          fc.integer({ min: 0, max: grid.rows - 1 }),
          (column, row) => {
            expect(cellAt(grid, cellCentre(grid, { column, row }))).toEqual({ column, row });
          },
        ),
      );
    }
  });

  it('finds hexes near their edges, and nothing outside the grid', () => {
    const centre = cellCentre(hex, { column: 2, row: 1 });
    // Just inside the right edge of an odd row's hex.
    expect(cellAt(hex, { x: centre.x + 29, y: centre.y })).toEqual({ column: 2, row: 1 });
    expect(cellAt(hex, { x: centre.x + 31, y: centre.y })).toEqual({ column: 3, row: 1 });
    expect(cellAt(square, { x: -1, y: 10 })).toBeNull();
    expect(cellAt(square, { x: 2100, y: 10 })).toBeNull();
    expect(cellAt(hex, { x: 5, y: 5 })).toBeNull();
  });

  it('draws each grid line once', () => {
    expect(gridSegments(square)).toHaveLength(31 + 21);
    const one = { columns: 1, rows: 1, gridType: 'hex', gridSize: 60 } as const;
    expect(gridSegments(one)).toHaveLength(6);
    // Two hexes side by side, or one row above the other, share one edge.
    expect(gridSegments({ ...one, columns: 2 })).toHaveLength(11);
    expect(gridSegments({ ...one, rows: 2 })).toHaveLength(11);
  });
});

describe('map view', () => {
  const scene = { width: 2000, height: 1000 };
  const panel = { width: 800, height: 800 };

  it('fits the whole scene and keeps the zoom in its limits', () => {
    expect(fitView(scene, panel)).toEqual({ x: 1000, y: 500, zoom: 0.4 });
    expect(zoomLimits(scene, panel)).toEqual({ min: 0.2, max: 4 });
    expect(clampView({ x: -50, y: 5000, zoom: 9 }, scene, panel)).toEqual({
      x: 0,
      y: 1000,
      zoom: 4,
    });
    // A scene smaller than the panel may be zoomed until it fills it.
    expect(zoomLimits({ width: 100, height: 100 }, panel)).toEqual({ min: 0.5, max: 8 });
  });

  it('pans and zooms by key, and ignores other keys', () => {
    const view = { x: 1000, y: 500, zoom: 2 };
    expect(viewForKey('ArrowRight', view, scene, panel)).toEqual({
      ...view,
      x: 1000 + PAN_STEP / 2,
    });
    expect(viewForKey('ArrowUp', view, scene, panel)).toEqual({ ...view, y: 500 - PAN_STEP / 2 });
    expect(viewForKey('+', view, scene, panel)?.zoom).toBe(2 * ZOOM_STEP);
    expect(viewForKey('-', view, scene, panel)?.zoom).toBe(2 / ZOOM_STEP);
    expect(viewForKey('0', view, scene, panel)).toEqual(fitView(scene, panel));
    expect(viewForKey('a', view, scene, panel)).toBeNull();
  });
});

const scene = (id: string, name: string, active = false): SceneView => ({
  id,
  tableId: 't1',
  name,
  backgroundUrl: null,
  columns: 30,
  rows: 20,
  gridType: 'square',
  gridSize: 70,
  active,
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
});

function openTable(role: string, scenes: () => SceneView[], handlers = {}) {
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
    'GET /tables/t1/scenes': () => ({ body: { scenes: scenes() } }),
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

const panel = (name: string) => screen.findByRole('tabpanel', { name });
const sceneList = () => screen.findByRole('list', { name: 'Scenes' });

describe('map and scenes panels (FR-MAP-01, 02)', () => {
  it('shows players the active scene, and refetches on scene.updated', async () => {
    let scenes: SceneView[] = [];
    const { sockets } = openTable('player', () => scenes);
    const map = await panel('Map');
    expect(await within(map).findByText('No scene is shown yet.')).toBeInTheDocument();
    // Players neither manage scenes nor pick one to look at.
    await userEvent.click(screen.getByRole('button', { name: 'Panels' }));
    const menu = screen.getByRole('list', { name: 'Panels' });
    expect(within(menu).queryByRole('button', { name: /^Scenes/ })).toBeNull();
    await userEvent.keyboard('{Escape}');

    const socket = await connected(sockets);
    scenes = [scene('s1', 'Cave', true)];
    socket.receive(serverEvent({ type: 'scene.updated', tableId: 't1', payload: {} }));
    expect(await within(map).findByText('Canvas: Cave')).toBeInTheDocument();
    expect(within(map).queryByLabelText('Scene')).toBeNull();
  });

  it('lets the GM make a scene and show it to players', async () => {
    let scenes: SceneView[] = [];
    const { calls, sockets } = openTable('gm', () => scenes, {
      'POST /tables/t1/scenes': (body: unknown) => {
        scenes = [{ ...scene('s1', 'Cave'), ...(body as Partial<SceneView>) }];
        return { status: 201, body: { scene: scenes[0] } };
      },
      'POST /tables/t1/scenes/active': () => {
        scenes = scenes.map((s) => ({ ...s, active: true }));
        return { body: { scenes } };
      },
    });
    const user = userEvent.setup();
    const map = await panel('Map');
    expect(await within(map).findByText('This table has no scenes yet.')).toBeInTheDocument();
    await user.click(within(map).getByRole('button', { name: 'Open Scenes' }));
    await panel('Scenes');

    await user.click(screen.getByRole('button', { name: 'New scene' }));
    const dialog = screen.getByRole('dialog', { name: 'New scene' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Cave');
    await user.clear(within(dialog).getByLabelText(/^Columns/));
    await user.type(within(dialog).getByLabelText(/^Columns/), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await user.clear(within(dialog).getByLabelText(/^Columns/));
    await user.type(within(dialog).getByLabelText(/^Columns/), '12');
    await user.selectOptions(within(dialog).getByLabelText('Grid'), 'Hex');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Cave',
        backgroundUrl: null,
        columns: 12,
        rows: 20,
        gridType: 'hex',
        gridSize: 70,
      });
    });
    const list = await sceneList();
    expect(await within(list).findByText('12 × 20 · Hex')).toBeInTheDocument();

    // The map hears of it from the server, and shows it as a preview until players see it.
    const socket = await connected(sockets);
    socket.receive(serverEvent({ type: 'scene.updated', tableId: 't1', payload: {} }));
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    const shown = await panel('Map');
    expect(await within(shown).findByText('Canvas: Cave')).toBeInTheDocument();
    expect(within(shown).getByRole('status')).toHaveTextContent('Preview');
    await user.click(screen.getByRole('tab', { name: 'Scenes' }));
    await user.click(screen.getByRole('button', { name: 'Show Cave to players' }));
    expect(await within(list).findByText('Shown to players')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/tables/t1/scenes/active')?.body).toEqual({
      sceneId: 's1',
    });
  });

  it('orders, edits and deletes scenes', async () => {
    let scenes = [scene('s1', 'Cave', true), scene('s2', 'Town')];
    const { calls } = openTable('gm', () => scenes, {
      'POST /tables/t1/scenes/order': () => {
        scenes = [scenes[1], scenes[0]].filter((s) => s !== undefined);
        return { body: { scenes } };
      },
      'PATCH /scenes/s2': (body: unknown) => {
        scenes = scenes.map((s) => (s.id === 's2' ? { ...s, ...(body as Partial<SceneView>) } : s));
        return { body: { scene: scenes.find((s) => s.id === 's2') } };
      },
      'DELETE /scenes/s1': () => {
        scenes = scenes.filter((s) => s.id !== 's1');
        return { status: 204 };
      },
    });
    const user = userEvent.setup();
    await openPanel('Scenes');
    const list = await sceneList();
    const names = () =>
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('aria-label'));
    await within(list).findByText('Town');
    expect(within(list).getByRole('button', { name: 'Move Cave up' })).toBeDisabled();

    await user.click(within(list).getByRole('button', { name: 'Move Town up' }));
    await waitFor(() => {
      expect(names()).toEqual(['Town', 'Cave']);
    });
    expect(calls.find((c) => c.path === '/tables/t1/scenes/order')?.body).toEqual({
      sceneIds: ['s2', 's1'],
    });

    await user.click(within(list).getByRole('button', { name: 'Edit Town' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Town' });
    await user.clear(within(dialog).getByLabelText(/^Name/));
    await user.type(within(dialog).getByLabelText(/^Name/), 'Old town');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(names()).toEqual(['Old town', 'Cave']);
    });

    await user.click(within(list).getByRole('button', { name: 'Delete Cave' }));
    await user.click(screen.getByRole('button', { name: 'Delete scene' }));
    await waitFor(() => {
      expect(names()).toEqual(['Old town']);
    });
  });
});
