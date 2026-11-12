import { expect, test } from '@playwright/test';

import { ADMIN, post, signIn } from './support/api.js';

// T-1619: an admin adds a player on the users page; the player signs in with the one-time
// password, chooses their own and joins a table (FR-AUTH-02).
test('an admin adds a player who signs in and joins a table', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const admin = await gm.context.newPage();
  let oneTimePassword = '';

  await test.step('the admin creates the user and sees the one-time password once', async () => {
    await admin.goto('/');
    await admin.getByRole('link', { name: 'Users' }).click();
    await expect(admin.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    await admin.getByRole('button', { name: 'New user' }).click();
    const dialog = admin.getByRole('dialog', { name: 'New user' });
    await dialog.getByLabel('Username').fill('nora');
    await dialog.getByLabel('Display name').fill('Nora');
    await dialog.getByRole('button', { name: 'Create user' }).click();

    await expect(admin.getByRole('heading', { name: 'Nora can now sign in' })).toBeVisible();
    oneTimePassword = await admin.getByLabel('One-time password').inputValue();
    expect(oneTimePassword).not.toBe('');
    const card = admin
      .getByRole('listitem')
      .filter({ has: admin.getByRole('heading', { name: 'Nora' }) });
    await expect(card).toContainText('Has not chosen a password yet');
    await admin.getByRole('button', { name: 'Done' }).click();
    await expect(admin.getByLabel('One-time password')).toBeHidden();
  });

  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Nora Table',
    systemId: 'e2e-system',
  });
  const { url } = await post<{ url: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });

  await test.step('the player signs in, chooses a password and joins', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Username').fill('nora');
    await page.getByLabel('Password').fill(oneTimePassword);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Choose a new password before you continue.')).toBeVisible();
    await page.getByLabel('Current password').fill(oneTimePassword);
    await page.getByLabel('New password').fill('nora-password-1');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Choose a new password before you continue.')).toBeHidden();

    await page.goto(url);
    await page.getByRole('button', { name: 'Join the table' }).click();
    await expect(page.getByRole('heading', { name: 'Nora Table' })).toBeVisible();
    await context.close();
  });

  await test.step('a disabled player cannot sign in', async () => {
    await admin.reload();
    const card = admin
      .getByRole('listitem')
      .filter({ has: admin.getByRole('heading', { name: 'Nora' }) });
    await card.getByRole('button', { name: 'Disable' }).click();
    await expect(admin.getByText('Nora is disabled and has been signed out.')).toBeVisible();
    const context = await browser.newContext();
    const res = await context.request.post('/api/v1/auth/login', {
      data: { username: 'nora', password: 'nora-password-1' },
    });
    expect(res.status()).toBe(403);
    await context.close();
  });

  await gm.context.close();
});
