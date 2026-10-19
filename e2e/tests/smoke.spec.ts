import { expect, test } from '@playwright/test';

const ADMIN = { username: 'admin', displayName: 'Game Admin', password: 'e2e-password-1' };

// T-0111: set up the admin, log in, create a table.
test('first-run setup, login and table creation', async ({ page }) => {
  await page.goto('/');

  await test.step('set up the instance admin (FR-AUTH-01)', async () => {
    await expect(page.getByRole('heading', { name: 'Set up your instance' })).toBeVisible();
    await page.getByLabel('Username').fill(ADMIN.username);
    await page.getByLabel('Display name').fill(ADMIN.displayName);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Create administrator' }).click();
    await expect(page.getByRole('heading', { name: 'Your tables' })).toBeVisible();
    await expect(page.getByText(`Signed in as ${ADMIN.displayName}`)).toBeVisible();
  });

  await test.step('log out and back in (FR-AUTH-03)', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    await page.getByLabel('Username').fill(ADMIN.username);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong username or password.');

    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'Your tables' })).toBeVisible();
  });

  await test.step('create a table (FR-TABLE-01)', async () => {
    await page.getByRole('button', { name: 'New table' }).click();
    const dialog = page.getByRole('dialog', { name: 'New table' });
    await expect(dialog.getByLabel('Game system')).toHaveValue('e2e-system');
    await dialog.getByLabel('Name').fill('Curse of the Crimson Throne');
    await dialog.getByLabel('Description').fill('Thursdays at 8');
    await dialog.getByRole('button', { name: 'Create table' }).click();

    await expect(dialog).toBeHidden();
    const card = page.getByRole('listitem').filter({ hasText: 'Curse of the Crimson Throne' });
    await expect(card).toContainText('GM');
    await expect(card).toContainText('E2E System 1.0.0');
  });

  await test.step('the session survives a reload', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Curse of the Crimson Throne' })).toBeVisible();
  });
});
