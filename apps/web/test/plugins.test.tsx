import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setCsrfToken } from '../src/api/client.js';

import { fakeApi, SESSION, USER, type FakeResponse } from './support/fake-api.js';
import { renderApp } from './support/render.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const ADMIN_SESSION = { ...SESSION, user: { ...USER, isAdmin: true } };

const plugin = (overrides: Record<string, unknown> = {}) => {
  const base = {
    id: 'tiny-d20',
    name: 'Tiny d20',
    version: '1.0.0',
    description: 'A tiny d20 system.',
    coreApi: '^0.1.0',
    hasCode: false,
    codeEntries: [],
    enabled: false,
    status: 'ready',
    issues: [],
    scannedAt: '2026-10-21T00:00:00.000Z',
    ...overrides,
  };
  return { ...base, available: base.enabled && base.status === 'ready' };
};

const BROKEN = plugin({
  id: 'broken',
  name: 'Broken',
  status: 'invalid',
  issues: [
    {
      severity: 'error',
      code: 'missing_key',
      file: 'sheets/main.json',
      path: ['layout', 'children', 0, 'label'],
      params: { key: 'label' },
    },
    {
      severity: 'warning',
      code: 'css_stripped',
      file: 'styles/sheet.css',
      path: [],
      params: { rule: '@import', line: 1 },
    },
  ],
});

const CODED = plugin({
  id: 'coded',
  name: 'Coded',
  hasCode: true,
  codeEntries: ['code/server.js', 'code/client.js'],
});

function adminApi(extra: Record<string, FakeResponse | ((body: unknown) => FakeResponse)> = {}) {
  return fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: ADMIN_SESSION },
    'GET /plugins': { body: { plugins: [plugin(), BROKEN, CODED] } },
    ...extra,
  });
}

const card = (name: string) => {
  const heading = screen.getByRole('heading', { name });
  const item = heading.closest('li');
  if (!item) throw new Error(`no card for ${name}`);
  return within(item);
};

describe('plugin admin page (T-0406, FR-ADMIN-02)', () => {
  it('is only for admins', async () => {
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables': { body: { tables: [] } },
    });
    renderApp('/admin/plugins');
    await screen.findByRole('heading', { name: 'Your tables' });
    expect(screen.queryByRole('link', { name: 'Plugins' })).not.toBeInTheDocument();
  });

  it('lists plugins with their status and validation issues', async () => {
    adminApi();
    renderApp('/admin/plugins');
    await screen.findByRole('heading', { name: 'Plugins', level: 1 });
    expect(screen.getByRole('link', { name: 'Plugins' })).toHaveAttribute('href', '/admin/plugins');

    expect(card('Tiny d20').getByText('Ready')).toBeInTheDocument();
    expect(card('Tiny d20').getByText('Core API ^0.1.0')).toBeInTheDocument();

    const broken = card('Broken');
    expect(broken.getByText('Invalid')).toBeInTheDocument();
    expect(broken.getByRole('button', { name: 'Enable' })).toBeDisabled();
    expect(broken.getByText('1 errors, 1 warnings')).toBeInTheDocument();
    expect(broken.getByText('sheets/main.json $.layout.children[0].label')).toBeInTheDocument();
    expect(broken.getByText('“label” is required.')).toBeInTheDocument();
    expect(
      broken.getByText(
        '@import (line 1) was removed: plugin styles cannot reach outside their sheets.',
      ),
    ).toBeInTheDocument();

    expect(card('Coded').getByText('Includes code')).toBeInTheDocument();
  });

  it('enables and disables a plugin without code', async () => {
    let enabled = false;
    const { calls } = adminApi({
      'GET /plugins': () => ({ body: { plugins: [plugin({ enabled })] } }),
      'POST /plugins/tiny-d20/enable': () => {
        enabled = true;
        return { body: { plugin: plugin({ enabled }) } };
      },
      'POST /plugins/tiny-d20/disable': () => {
        enabled = false;
        return { body: { plugin: plugin({ enabled }) } };
      },
    });
    renderApp('/admin/plugins');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Enable' }));
    await screen.findByRole('button', { name: 'Disable' });
    expect(card('Tiny d20').getByText('Enabled')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/plugins/tiny-d20/enable')?.body).toEqual({});

    await user.click(screen.getByRole('button', { name: 'Disable' }));
    await screen.findByRole('button', { name: 'Enable' });
    expect(card('Tiny d20').getByText('Disabled')).toBeInTheDocument();
  });

  it('asks before enabling a plugin with code', async () => {
    const { calls } = adminApi({
      'POST /plugins/coded/enable': { body: { plugin: { ...CODED, enabled: true } } },
    });
    renderApp('/admin/plugins');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Coded' });
    await user.click(card('Coded').getByRole('button', { name: 'Enable' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Enable Coded?' }));
    expect(dialog.getByText('code/server.js')).toBeInTheDocument();
    expect(dialog.getByText('code/client.js')).toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(calls.some((c) => c.path === '/plugins/coded/enable')).toBe(false);

    await user.click(card('Coded').getByRole('button', { name: 'Enable' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable with code' }),
    );
    await vi.waitFor(() => {
      expect(calls.find((c) => c.path === '/plugins/coded/enable')?.body).toEqual({
        acknowledgeCode: true,
      });
    });
  });

  it('rescans and reports failures', async () => {
    const { calls } = adminApi({
      'POST /plugins/rescan': { body: { plugins: [plugin()] } },
      'POST /plugins/tiny-d20/enable': {
        status: 409,
        body: { error: { code: 'plugin_not_ready', message: 'Plugin is not ready.' } },
      },
    });
    renderApp('/admin/plugins');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Rescan' }));
    expect(await screen.findByText('Plugin folders scanned.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/plugins/rescan')).toBe(true);

    await user.click(card('Tiny d20').getByRole('button', { name: 'Enable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Plugin is not ready.');
  });

  it('shows an empty state', async () => {
    adminApi({ 'GET /plugins': { body: { plugins: [] } } });
    renderApp('/admin/plugins');
    expect(await screen.findByText(/No plugins found/)).toBeInTheDocument();
  });
});
