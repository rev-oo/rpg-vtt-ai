import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setCsrfToken } from '../src/api/client.js';

import { fakeApi, SESSION, TABLE, UNAUTHENTICATED, USER } from './support/fake-api.js';
import { renderApp } from './support/render.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const location = () => screen.getByTestId('location').textContent;

describe('first-run setup (FR-AUTH-01)', () => {
  it('sends a fresh instance to setup and signs the admin in', async () => {
    const { calls } = fakeApi({
      'GET /setup/status': { body: { needsSetup: true } },
      'POST /setup/admin': { status: 201, body: { ...SESSION, user: { ...USER, isAdmin: true } } },
      'GET /tables': { body: { tables: [] } },
    });
    renderApp('/');

    await screen.findByRole('heading', { name: 'Set up your instance' });
    expect(location()).toBe('/setup');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Display name'), 'Alice');
    await user.type(screen.getByLabelText('Password'), 'long-password');
    await user.click(screen.getByRole('button', { name: 'Create administrator' }));

    await screen.findByRole('heading', { name: 'Your tables' });
    expect(calls.find((c) => c.path === '/setup/admin')?.body).toEqual({
      username: 'alice',
      displayName: 'Alice',
      password: 'long-password',
    });
    expect(screen.getByText('Signed in as Alice')).toBeInTheDocument();
  });

  it('validates fields in the browser before calling the API', async () => {
    const { calls } = fakeApi({ 'GET /setup/status': { body: { needsSetup: true } } });
    renderApp('/setup');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'al');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create administrator' }));

    expect(await screen.findByText('Must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('Required.')).toBeInTheDocument();
    expect(screen.getByText('Not a valid username.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.path === '/setup/admin')).toBe(false);
  });

  it('hides setup once the instance has users', async () => {
    fakeApi({ 'GET /setup/status': { body: { needsSetup: false } }, 'GET /me': UNAUTHENTICATED });
    renderApp('/setup');
    await screen.findByRole('heading', { name: 'Log in' });
  });
});

describe('login', () => {
  it('redirects to login and back to the requested page afterwards', async () => {
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': UNAUTHENTICATED,
      'POST /auth/login': { body: SESSION },
    });
    renderApp('/account');

    await screen.findByRole('heading', { name: 'Log in' });
    expect(location()).toBe('/login?next=%2Faccount');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await screen.findByRole('heading', { name: 'Account' });
    expect(location()).toBe('/account');
  });

  it('shows the error for wrong credentials', async () => {
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': UNAUTHENTICATED,
      'POST /auth/login': {
        status: 401,
        body: { error: { code: 'invalid_credentials', message: 'Wrong username or password.' } },
      },
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
  });

  it('logs out and returns to login', async () => {
    const { calls } = fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables': { body: { tables: [] } },
      'POST /auth/logout': { status: 204 },
    });
    renderApp('/');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Log out' }));

    await screen.findByRole('heading', { name: 'Log in' });
    expect(calls.find((c) => c.path === '/auth/logout')?.headers.get('x-csrf-token')).toBe(
      'csrf-123',
    );
  });

  it('shows a retry when the server is unreachable', async () => {
    fakeApi({ 'GET /setup/status': { status: 503, body: {} } });
    renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('account (FR-AUTH-05)', () => {
  it('forces a password change for one-time passwords, then lets the user continue', async () => {
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: { ...SESSION, user: { ...USER, mustChangePassword: true } } },
      'POST /me/password': { status: 204 },
      'GET /tables': { body: { tables: [] } },
    });
    renderApp('/');

    await screen.findByText('Choose a new password before you continue.');
    expect(location()).toBe('/account');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Current password'), 'one-time-pass');
    await user.type(screen.getByLabelText('New password'), 'brand-new-pass');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await screen.findByText('Password changed. Other devices have been signed out.');
    await user.click(screen.getByRole('link', { name: 'Tables' }));
    await screen.findByRole('heading', { name: 'Your tables' });
  });

  it('saves the display name', async () => {
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'PATCH /me': (body) => ({ body: { user: { ...USER, ...(body as object) } } }),
    });
    renderApp('/account');
    const user = userEvent.setup();
    const field = await screen.findByLabelText('Display name');
    await user.clear(field);
    await user.type(field, 'Al');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Profile saved.');
    expect(screen.getByText('Signed in as Al')).toBeInTheDocument();
  });
});

describe('tables (FR-TABLE-01)', () => {
  it('lists tables with the role', async () => {
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables': { body: { tables: [TABLE] } },
    });
    renderApp('/');
    const card = (await screen.findByRole('heading', { name: 'Crimson Throne' })).closest('li');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('GM')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('Tiny d20 1.0.0')).toBeInTheDocument();
  });

  it('creates a table from the dialog and refreshes the list', async () => {
    let tables: unknown[] = [];
    const { calls } = fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables': () => ({ body: { tables } }),
      'GET /systems': {
        body: { systems: [{ id: 'tiny-d20', name: 'Tiny d20', version: '1.0.0' }] },
      },
      'POST /tables': () => {
        tables = [TABLE];
        return { status: 201, body: { table: TABLE } };
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    await screen.findByText(/not part of any table/);
    await user.click(screen.getByRole('button', { name: 'New table' }));

    const dialog = await screen.findByRole('dialog', { name: 'New table' });
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Game system')).toHaveValue('tiny-d20');
    });
    await user.type(within(dialog).getByLabelText('Name'), 'Crimson Throne');
    await user.click(within(dialog).getByRole('button', { name: 'Create table' }));

    await screen.findByRole('heading', { name: 'Crimson Throne' });
    expect(calls.find((c) => c.method === 'POST' && c.path === '/tables')?.body).toEqual({
      name: 'Crimson Throne',
      description: '',
      systemId: 'tiny-d20',
      settings: {},
    });
  });

  it('requires a table name', async () => {
    const { calls } = fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables': { body: { tables: [] } },
      'GET /systems': {
        body: { systems: [{ id: 'tiny-d20', name: 'Tiny d20', version: '1.0.0' }] },
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New table' }));
    const dialog = await screen.findByRole('dialog', { name: 'New table' });
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Game system')).toHaveValue('tiny-d20');
    });
    await user.click(within(dialog).getByRole('button', { name: 'Create table' }));

    expect(await within(dialog).findByText('Required.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('explains when no system is enabled', async () => {
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables': { body: { tables: [] } },
      'GET /systems': { body: { systems: [] } },
    });
    renderApp('/');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'New table' }));
    expect(await screen.findByText(/No game system is enabled yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create table' })).toBeDisabled();
  });
});
