import { fireEvent, screen, within } from '@testing-library/react';
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
    kind: 'system',
    description: 'A tiny d20 system.',
    attribution: null,
    instanceSettings: false,
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
  attribution: { text: 'Uses the Coded Reference, CC-BY-4.0.', url: 'https://example.com/coded' },
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
    expect(broken.getByText('1 error, 1 warning')).toBeInTheDocument();
    // On a narrow card, Enable comes after the badges (T-1620).
    const status = broken.getByText('Invalid');
    expect(
      status.compareDocumentPosition(broken.getByRole('button', { name: 'Enable' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(broken.getByText('sheets/main.json $.layout.children[0].label')).toBeInTheDocument();
    expect(broken.getByText('“label” is required.')).toBeInTheDocument();
    expect(
      broken.getByText(
        '@import (line 1) was removed: plugin styles cannot reach outside their sheets.',
      ),
    ).toBeInTheDocument();

    expect(card('Coded').getByText('Includes code')).toBeInTheDocument();
    // The credit the plugin's content needs, linked to its source (T-1614).
    expect(
      card('Coded').getByRole('link', { name: 'Uses the Coded Reference, CC-BY-4.0.' }),
    ).toHaveAttribute('href', 'https://example.com/coded');
    expect(card('Tiny d20').queryByTestId('plugin-attribution')).toBeNull();
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

  it('lists the code files of a plugin with code (FR-PLUGIN-06, T-0809)', async () => {
    adminApi();
    renderApp('/admin/plugins');
    await screen.findByRole('heading', { name: 'Coded' });
    await userEvent.click(card('Coded').getByText('Code files'));
    expect(card('Coded').getByText('code/server.js')).toBeVisible();
    expect(card('Coded').getByText('code/client.js')).toBeVisible();
    expect(card('Tiny d20').queryByText('Code files')).not.toBeInTheDocument();
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

describe('module plugins and instance settings (T-1601)', () => {
  const SETTINGS = {
    definitions: {
      quality: {
        type: 'string',
        default: 'high',
        enum: ['low', 'high'],
        // Labels by value (T-1611): the stored value stays `low`.
        enumLabels: { low: 'quality.low', high: 'quality.high' },
        label: 'setting.quality',
        scope: 'instance',
      },
      tint: {
        type: 'string',
        default: '#f4efe1',
        format: 'colour',
        label: 'setting.tint',
        scope: 'instance',
      },
    },
    lang: {
      en: {
        'setting.quality': 'Dice quality',
        'setting.tint': 'Dice tint',
        'quality.low': 'Fast',
        'quality.high': 'Pretty',
      },
    },
    defaultLocale: 'en',
  };

  it('marks modules and lets admins set settings for every table', async () => {
    const glow = plugin({ id: 'glow', name: 'Glow', kind: 'module', instanceSettings: true });
    const { calls } = adminApi({
      'GET /plugins': { body: { plugins: [plugin(), glow] } },
      'GET /plugins/glow/settings': { body: { ...SETTINGS, values: {} } },
      'PATCH /plugins/glow/settings': (body) => ({
        body: { ...SETTINGS, values: (body as { values: object }).values },
      }),
    });
    renderApp('/admin/plugins');
    await screen.findByRole('heading', { name: 'Glow' });
    expect(card('Glow').getByText('Module')).toBeInTheDocument();
    expect(card('Tiny d20').getByText('System')).toBeInTheDocument();
    expect(card('Tiny d20').queryByText('Settings for every table')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(card('Glow').getByText('Settings for every table'));
    const quality = await card('Glow').findByLabelText('Dice quality');
    expect(
      within(quality)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Fast', 'Pretty']);
    await user.selectOptions(quality, 'Fast');
    // A colour setting is a colour picker (T-1611).
    const tint = card('Glow').getByLabelText('Dice tint');
    expect(tint).toHaveAttribute('type', 'color');
    expect(tint).toHaveValue('#f4efe1');
    fireEvent.change(tint, { target: { value: '#aa3322' } });
    await user.click(card('Glow').getByRole('button', { name: 'Save settings' }));

    expect(await card('Glow').findByText('The settings were saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: '/plugins/glow/settings',
      body: { values: { quality: 'low', tint: '#aa3322' } },
    });
  });
});

describe('installing plugin archives (T-0410, ADR-026)', () => {
  const archive = () => new File([new Uint8Array([80, 75, 5, 6])], 'tiny-d20.vttplugin');
  const SPARE = plugin({ id: 'spare', name: 'Spare', version: '2.0.0' });

  it('installs an archive and reports it', async () => {
    const { calls } = adminApi({
      'POST /plugins/install': { status: 201, body: { plugin: SPARE } },
    });
    renderApp('/admin/plugins');
    await screen.findByRole('heading', { name: 'Plugins', level: 1 });
    await userEvent.upload(screen.getByLabelText('Plugin archive (.vttplugin)'), archive());
    expect(
      await screen.findByText('Spare 2.0.0 is installed. Enable it to use it.'),
    ).toBeInTheDocument();
    const sent = calls.find((call) => call.method === 'POST');
    expect(sent?.headers.get('content-type')).toBe('application/zip');
  });

  it('asks before replacing an installed plugin', async () => {
    const { calls } = adminApi({
      'POST /plugins/install': {
        status: 409,
        body: { error: { code: 'plugin_exists', message: 'exists' } },
      },
      'POST /plugins/install?replace=true': { body: { plugin: plugin({ version: '1.1.0' }) } },
    });
    renderApp('/admin/plugins');
    await screen.findByRole('heading', { name: 'Plugins', level: 1 });
    await userEvent.upload(screen.getByLabelText('Plugin archive (.vttplugin)'), archive());
    const dialog = await screen.findByRole('dialog', { name: 'Replace the installed plugin?' });
    expect(dialog).toHaveTextContent('tiny-d20.vttplugin');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace' }));
    expect(
      await screen.findByText('Tiny d20 1.1.0 is installed. Enable it to use it.'),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      '/plugins/install',
      '/plugins/install?replace=true',
    ]);
  });

  it('lists the errors of a plugin it could not install', async () => {
    adminApi({
      'POST /plugins/install': {
        status: 422,
        body: {
          error: {
            code: 'invalid_plugin',
            message: 'The plugin in the archive has errors.',
            details: { issues: BROKEN.issues },
          },
        },
      },
    });
    renderApp('/admin/plugins');
    await screen.findByRole('heading', { name: 'Plugins', level: 1 });
    await userEvent.upload(screen.getByLabelText('Plugin archive (.vttplugin)'), archive());
    const alert = await screen.findByText(
      'The plugin in this archive has errors and was not installed.',
    );
    expect(alert).toHaveTextContent('sheets/main.json $.layout.children[0].label');
  });
});
