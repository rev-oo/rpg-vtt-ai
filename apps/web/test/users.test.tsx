import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminUser } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';

import { fakeApi, SESSION, USER, type FakeResponse } from './support/fake-api.js';
import { renderApp } from './support/render.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const ADMIN_SESSION = { ...SESSION, user: { ...USER, isAdmin: true } };

const adminUser = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  ...USER,
  isAdmin: true,
  disabled: false,
  createdAt: '2026-10-01T12:00:00.000Z',
  ...overrides,
});
const ME = adminUser();
const LENA = adminUser({
  id: 'u2',
  username: 'lena',
  displayName: 'Lena',
  isAdmin: false,
  mustChangePassword: true,
});

function usersApi(
  users: () => AdminUser[],
  extra: Record<string, FakeResponse | ((body: unknown) => FakeResponse)> = {},
) {
  return fakeApi({
    'GET /setup/status': { body: { needsSetup: false } },
    'GET /me': { body: ADMIN_SESSION },
    'GET /users': () => ({ body: { users: users() } }),
    ...extra,
  });
}

const card = (name: string) => {
  const heading = screen.getByRole('heading', { name });
  const item = heading.closest('li');
  if (!item) throw new Error(`no card for ${name}`);
  return within(item);
};

describe('users page (T-1619, FR-AUTH-02)', () => {
  it('is only for admins', async () => {
    fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'GET /me': { body: SESSION },
      'GET /tables': { body: { tables: [] } },
    });
    renderApp('/admin/users');
    await screen.findByRole('heading', { name: 'Your tables' });
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('lists users with their state; the admin changes their own account elsewhere', async () => {
    usersApi(() => [
      ME,
      LENA,
      adminUser({
        id: 'u3',
        username: 'omar',
        displayName: 'Omar',
        isAdmin: false,
        disabled: true,
      }),
    ]);
    renderApp('/admin/users');
    await screen.findByRole('heading', { name: 'Users', level: 1 });
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/admin/users');

    expect(card('Alice').getByText('You')).toBeInTheDocument();
    expect(card('Alice').getByText('Admin')).toBeInTheDocument();
    expect(card('Alice').queryByRole('button')).toBeNull();
    expect(card('Alice').getByRole('link')).toHaveAttribute('href', '/account');

    expect(card('Lena').getByText('@lena')).toBeInTheDocument();
    expect(card('Lena').getByText('Has not chosen a password yet')).toBeInTheDocument();
    expect(card('Lena').getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    expect(card('Omar').getByText('Disabled')).toBeInTheDocument();
    expect(card('Omar').getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('creates a user and shows their one-time password once', async () => {
    let users = [ME];
    const { calls } = usersApi(() => users, {
      'POST /users': () => {
        users = [ME, LENA];
        return { status: 201, body: { user: LENA, oneTimePassword: 'otp-abc-123' } };
      },
    });
    renderApp('/admin/users');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = screen.getByRole('dialog', { name: 'New user' });
    await user.type(within(dialog).getByLabelText('Username'), 'lena');
    await user.type(within(dialog).getByLabelText('Display name'), 'Lena');
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    await screen.findByRole('heading', { name: 'Lena can now sign in' });
    expect(screen.getByLabelText('One-time password')).toHaveValue('otp-abc-123');
    expect(screen.getByText(/username, lena,/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      username: 'lena',
      displayName: 'Lena',
      isAdmin: false,
    });
    await screen.findByRole('heading', { name: 'Lena' });

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('One-time password')).toBeNull();
  });

  it('says when the username is taken', async () => {
    usersApi(() => [ME], {
      'POST /users': {
        status: 409,
        body: { error: { code: 'username_taken', message: 'That username is already taken.' } },
      },
    });
    renderApp('/admin/users');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = screen.getByRole('dialog', { name: 'New user' });
    await user.type(within(dialog).getByLabelText('Username'), 'alice');
    await user.type(within(dialog).getByLabelText('Display name'), 'Alice 2');
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That username is already taken.',
    );
  });

  it('resets a password after asking, and shows the new one', async () => {
    const { calls } = usersApi(() => [ME, LENA], {
      'PATCH /users/u2': { body: { user: LENA, oneTimePassword: 'otp-new-456' } },
    });
    renderApp('/admin/users');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Lena' });
    await user.click(card('Lena').getByRole('button', { name: 'Reset password' }));
    const dialog = screen.getByRole('dialog', { name: 'Reset the password of Lena?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reset password' }));

    await screen.findByRole('heading', { name: 'New password for Lena' });
    expect(screen.getByLabelText('One-time password')).toHaveValue('otp-new-456');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ resetPassword: true });
  });

  it('disables, enables and makes a user admin at once', async () => {
    let lena = LENA;
    const { calls } = usersApi(() => [ME, lena], {
      'PATCH /users/u2': (body) => {
        if (typeof body === 'object' && body !== null) lena = { ...lena, ...body };
        return { body: { user: lena } };
      },
    });
    renderApp('/admin/users');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Lena' });

    await user.click(card('Lena').getByRole('button', { name: 'Disable' }));
    await screen.findByText('Lena is disabled and has been signed out.');
    expect(await card('Lena').findByText('Disabled')).toBeInTheDocument();

    await user.click(card('Lena').getByRole('button', { name: 'Enable' }));
    await screen.findByText('Lena can sign in again.');
    await card('Lena').findByRole('button', { name: 'Disable' });

    await user.click(card('Lena').getByRole('button', { name: 'Make admin' }));
    await screen.findByText('Lena is now an administrator.');
    expect(await card('Lena').findByRole('button', { name: 'Remove admin' })).toBeInTheDocument();

    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
      { disabled: true },
      { disabled: false },
      { isAdmin: true },
    ]);
  });

  it('deletes a user after asking', async () => {
    let users = [ME, LENA];
    usersApi(() => users, {
      'DELETE /users/u2': () => {
        users = [ME];
        return { status: 204 };
      },
    });
    renderApp('/admin/users');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Lena' });
    await user.click(card('Lena').getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Lena?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await screen.findByText('Lena was deleted.');
    expect(screen.queryByRole('heading', { name: 'Lena' })).toBeNull();
  });
});
