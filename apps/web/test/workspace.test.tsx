import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setCsrfToken } from '../src/api/client.js';
import { layoutKey } from '../src/features/workspace/layout.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi, SESSION, TABLE, USER } from './support/fake-api.js';
import { fakeWebSocket } from './support/fake-socket.js';
import { renderApp } from './support/render.js';
import { HERO, MEMBERS, TYPES } from './support/table-fixtures.js';

afterEach(() => {
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

/** Opens the table's workspace as its GM, with one actor and empty lists. */
function openTable(path: string) {
  fakeWebSocket();
  const actors = { body: { nextCursor: null, actors: [HERO] } };
  const api = fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: SESSION },
    'GET /tables/t1': { body: { table: { ...TABLE, role: 'gm' } } },
    'GET /tables/t1/members': { body: { members: MEMBERS } },
    'GET /tables/t1/invites': { body: { invites: [] } },
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

const panel = (name: string) => screen.findByRole('tabpanel', { name });
const location = () => screen.getByTestId('location').textContent;
const tabs = () => [...document.querySelectorAll('.dv-tab')].map((tab) => tab.textContent);
const panelsMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Panels' }));
  return within(screen.getByRole('list', { name: 'Panels' }));
};

describe('table workspace (FR-TABLE-08, ADR-059)', () => {
  it('opens full page, outside the app header, with every panel', async () => {
    openTable('/tables/t1');
    expect(await screen.findByRole('heading', { name: 'Goblin King' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    for (const name of ['Actors', 'Table', 'Combat', 'Chat']) {
      expect(await panel(name)).toBeInTheDocument();
    }
    expect(tabs()).toEqual([
      'Actors',
      'Items',
      'Journal',
      'Compendium',
      'Table',
      'Combat',
      'Chat',
      'Dice',
    ]);
  });

  it('has no other table URLs: they lead home', async () => {
    openTable('/tables/t1/actors/a1');
    await waitFor(() => {
      expect(location()).toBe('/');
    });
  });

  it('opens documents in place, leaving the URL on the table', async () => {
    openTable('/tables/t1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open sheet: Goblin King' }));
    expect(tabs()).toContain('Goblin King');
    await user.click((await panelsMenu(user)).getByRole('button', { name: 'Members' }));
    expect(await panel('Members')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close Members' }));
    expect(screen.queryByRole('tabpanel', { name: 'Members' })).toBeNull();
    expect(location()).toBe('/tables/t1');
  });

  it('closes panels, reopens them from the menu and keeps the layout', async () => {
    openTable('/tables/t1');
    const user = userEvent.setup();
    await panel('Chat');
    await user.click(screen.getByRole('button', { name: 'Close Chat' }));
    expect(screen.queryByRole('tabpanel', { name: 'Chat' })).toBeNull();
    const menu = await panelsMenu(user);
    expect(menu.getByRole('button', { name: /^Chat/ })).not.toHaveTextContent('open');
    expect(menu.getByRole('button', { name: /^Combat/ })).toHaveTextContent('open');
    await user.keyboard('{Escape}');

    // Another visit to the table finds it as it was left.
    cleanup();
    openTable('/tables/t1');
    await panel('Combat');
    expect(tabs()).not.toContain('Chat');
    await user.click((await panelsMenu(user)).getByRole('button', { name: /^Chat/ }));
    expect(await panel('Chat')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close Combat' }));
    await user.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(await panel('Combat')).toBeInTheDocument();
  });

  it('starts from the default layout when the stored one is broken', async () => {
    localStorage.setItem(layoutKey(USER.id, TABLE.id, false), '{"grid": 1}');
    openTable('/tables/t1');
    expect(await panel('Chat')).toBeInTheDocument();
    expect(tabs()).toContain('Actors');
  });

  it('shows one panel at a time on a phone, with its own layout', async () => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false,
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    openTable('/tables/t1');
    expect(await panel('Table')).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'Chat' })).toBeNull();
    expect(tabs()).toEqual([
      'Table',
      'Actors',
      'Items',
      'Journal',
      'Compendium',
      'Chat',
      'Combat',
      'Dice',
    ]);
    await userEvent.setup().click(screen.getByText('Chat', { selector: '.dv-tab *' }));
    expect(await panel('Chat')).toBeInTheDocument();
    await waitFor(() => {
      expect(localStorage.getItem(layoutKey(USER.id, TABLE.id, true))).not.toBeNull();
    });
    expect(localStorage.getItem(layoutKey(USER.id, TABLE.id, false))).toBeNull();
  });
});
