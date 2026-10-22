import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { ADMIN, signIn } from './support/api.js';

const fixtures = fileURLToPath(new URL('../fixtures/plugins/', import.meta.url));
// The data directory scripts/start-server.mjs runs the server on.
const pluginsDir = fileURLToPath(new URL('../.data/plugins/', import.meta.url));
const lateDir = path.join(pluginsDir, 'e2e-late');

test.afterAll(async () => {
  await rm(lateDir, { recursive: true, force: true });
});

// T-0406: the plugin admin page (FR-ADMIN-02).
test('admins list, enable, disable and rescan plugins', async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  const page = await admin.context.newPage();
  await page.goto('/');
  await page.getByRole('link', { name: 'Plugins' }).click();
  await expect(page.getByRole('heading', { name: 'Plugins', level: 1 })).toBeVisible();
  const card = (name: string) =>
    page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });

  await test.step('see validation errors', async () => {
    const broken = card('E2E Broken');
    await expect(broken.getByText('Invalid', { exact: true })).toBeVisible();
    await expect(broken.getByRole('button', { name: 'Enable' })).toBeDisabled();
    await expect(broken.getByText('types/actors/hero.json $.sheet')).toBeVisible();
    await expect(broken.getByText('There is no sheet named “missing”.')).toBeVisible();
  });

  await test.step('enable and disable a plugin', async () => {
    const spare = card('E2E Spare');
    await expect(spare.getByText('Ready', { exact: true })).toBeVisible();
    await spare.getByRole('button', { name: 'Enable' }).click();
    await expect(spare.getByText('Enabled', { exact: true })).toBeVisible();

    // An enabled system can be picked for a new table.
    await page.getByRole('link', { name: 'Tables' }).click();
    await page.getByRole('button', { name: 'New table' }).click();
    const dialog = page.getByRole('dialog', { name: 'New table' });
    await expect(
      dialog.getByLabel('Game system').getByRole('option', { name: /E2E Spare/ }),
    ).toHaveCount(1);
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: 'Plugins' }).click();
    await card('E2E Spare').getByRole('button', { name: 'Disable' }).click();
    await expect(card('E2E Spare').getByText('Disabled', { exact: true })).toBeVisible();
  });

  await test.step('rescan finds a new plugin folder', async () => {
    await expect(card('E2E Late')).toHaveCount(0);
    await cp(path.join(fixtures, 'e2e-spare'), lateDir, { recursive: true });
    const manifest = path.join(lateDir, 'plugin.json');
    const json = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>;
    await writeFile(manifest, JSON.stringify({ ...json, id: 'e2e-late', name: 'E2E Late' }));

    await page.getByRole('button', { name: 'Rescan' }).click();
    await expect(page.getByText('Plugin folders scanned.')).toBeVisible();
    await expect(card('E2E Late').getByText('Ready', { exact: true })).toBeVisible();
  });

  await admin.context.close();
});
