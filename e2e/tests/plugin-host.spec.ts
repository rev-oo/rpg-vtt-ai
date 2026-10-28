import { expect, test } from '@playwright/test';

import { ADMIN, post, signIn } from './support/api.js';

// T-0409: a system with client code runs in the app. Its sheet shows a custom node through the
// SDK hooks, its roll button posts a recipe roll, and the chat shows the plugin's own card.
// Disabling the system leaves the table read-only and the card as plain text (FR-PLUGIN-03).
// T-0809: its derived `mod` calls a shared function, worked out alike in the browser and on the
// server, and a handler recipe runs its server code (ADR-047).
test('a system plugin with client code renders sheets and cards', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await post(gm, '/plugins/e2e-code/enable', { acknowledgeCode: true });
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Code Table',
    systemId: 'e2e-code',
  });
  await post(gm, `/tables/${table.id}/actors`, { type: 'hero', name: 'Ayla' });

  const page = await gm.context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/tables/${table.id}`);
  await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
  const log = page.getByRole('log', { name: 'Messages' });

  // The sheet opens as its own panel, beside the actor list (ADR-059).
  const sheet = page.getByRole('tabpanel', { name: 'Ayla' });
  await test.step('the sheet renders the plugin layout and its custom node', async () => {
    await page.getByRole('button', { name: 'Open sheet: Ayla' }).click();
    await expect(sheet.getByRole('heading', { name: 'Ayla' })).toBeVisible();
    await expect(page.getByLabel('Might')).toHaveValue('4');
    // `mod` is `half(@might)`, from code/shared.js.
    const banner = page.getByText('Vitals: Ayla has 7 HP, mod 2');
    await expect(banner).toBeVisible();
    // The plugin's stylesheet applies inside its scope only (ADR-021).
    await expect(banner).toHaveCSS('font-weight', '700');
  });

  await test.step('a roll button posts a card the plugin draws', async () => {
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(sheet.getByRole('status')).toHaveText('Rolled. The result is in the chat.');
    await expect(log.getByText('Might check rolled 3: Success')).toBeVisible();
    await expect(log.getByLabel('Total 3', { exact: true })).toBeVisible();
  });

  await test.step('a handler recipe rolls and posts through server code', async () => {
    await page.getByRole('button', { name: 'Strike' }).click();
    await expect(sheet.getByRole('status')).toHaveText('Rolled. The result is in the chat.');
    await expect(log.getByText('Ayla strikes')).toBeVisible();
    await expect(log.getByLabel('Total 3', { exact: true })).toHaveCount(2);
  });

  await test.step('a disabled system leaves the table read-only', async () => {
    await post(gm, '/plugins/e2e-code/disable');
    await page.goto(`/tables/${table.id}`);
    await expect(
      page.getByText(/“E2E Code” is not available, so this table is read-only/),
    ).toBeVisible();
    await expect(log.getByText('Might check rolled 3')).toHaveCount(0);
    await expect(log).toContainText('= 3 (Success)');
  });

  expect(errors).toEqual([]);
  await gm.context.close();
});
