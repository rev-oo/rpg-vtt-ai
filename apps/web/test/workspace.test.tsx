import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setCsrfToken } from '../src/api/client.js';
import {
  DEFAULT_LAYOUT,
  layoutKey,
  PANEL_MAX,
  PANEL_MIN,
  readLayout,
} from '../src/features/workspace/layout-store.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE, USER } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';

afterEach(() => {
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
  localStorage.clear();
});

const KEY = layoutKey(USER.id, TABLE.id);

/** Opens the table's workspace with one actor, no items and no journal entries. */
function openTable(path: string) {
  fakeWebSocket();
  const actors = { body: { nextCursor: null, actors: [HERO] } };
  const api = fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: { ...TABLE, role: 'gm' } } },
    'GET /tables/t1/members': { body: { members: MEMBERS } },
    'GET /tables/t1/actors': actors,
    'GET /tables/t1/actors?trash=live&limit=50': actors,
    'GET /tables/t1/types': { body: TYPES },
    'GET /tables/t1/messages': { body: { messages: [], nextCursor: null } },
    'GET /tables/t1/items?trash=live&limit=50': { body: { nextCursor: null, items: [] } },
    'GET /tables/t1/journal?trash=live&limit=50': { body: { nextCursor: null, entries: [] } },
  });
  renderApp(path);
  return api;
}

const tab = (name: string) => screen.findByRole('tab', { name });
const panels = () => within(screen.getByRole('group', { name: 'Panels' }));

describe('table workspace (FR-TABLE-08, T-1201)', () => {
  it('opens full page, outside the app header, with the lists and the chat', async () => {
    openTable('/tables/t1');
    expect(await screen.findByRole('heading', { name: 'Goblin King' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Crimson Throne' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Chat' })).toBeInTheDocument();
    expect(await tab('Actors')).toHaveAttribute('aria-selected', 'true');
  });

  it('switches lists and remembers the last one', async () => {
    openTable('/tables/t1');
    const user = userEvent.setup();
    await user.click(await tab('Items'));
    expect(await tab('Items')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByLabelText('Search items')).toBeInTheDocument();
    expect(readLayout(KEY).panel).toBe('items');
  });

  it('takes the list from the URL, over the stored one', async () => {
    localStorage.setItem(KEY, JSON.stringify({ panel: 'items' }));
    openTable('/tables/t1?panel=journal');
    expect(await tab('Journal')).toHaveAttribute('aria-selected', 'true');
  });

  it('redirects the old list pages to the workspace', async () => {
    openTable('/tables/t1/items');
    expect(await tab('Items')).toHaveAttribute('aria-selected', 'true');
  });

  it('collapses and resizes panels, and restores them on the next visit', async () => {
    openTable('/tables/t1');
    const user = userEvent.setup();
    await tab('Actors');
    await user.click(panels().getByRole('button', { name: 'Chat', pressed: true }));
    expect(panels().getByRole('button', { name: 'Chat', pressed: false })).toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize the chat' })).toBeNull();

    const handle = screen.getByRole('separator', { name: 'Resize the lists' });
    handle.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(handle).toHaveAttribute('aria-valuenow', String(DEFAULT_LAYOUT.browseWidth + 32));
    await user.keyboard('{End}');
    expect(handle).toHaveAttribute('aria-valuenow', String(PANEL_MAX));
    await waitFor(() => {
      expect(readLayout(KEY)).toMatchObject({ chatOpen: false, browseWidth: PANEL_MAX });
    });
  });

  it('starts from the stored layout', async () => {
    localStorage.setItem(KEY, JSON.stringify({ browseWidth: PANEL_MIN, chatOpen: false }));
    openTable('/tables/t1');
    expect(await screen.findByRole('separator', { name: 'Resize the lists' })).toHaveAttribute(
      'aria-valuenow',
      String(PANEL_MIN),
    );
    expect(panels().getByRole('button', { name: 'Chat', pressed: false })).toBeInTheDocument();
  });

  it('falls back to defaults on a broken stored layout', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readLayout(KEY)).toEqual(DEFAULT_LAYOUT);
    localStorage.setItem(KEY, JSON.stringify({ browseWidth: 9999, panel: 'maps' }));
    expect(readLayout(KEY)).toEqual(DEFAULT_LAYOUT);
  });
});
