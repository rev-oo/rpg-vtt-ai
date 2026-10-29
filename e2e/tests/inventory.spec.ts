import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn } from './support/api.js';
import { installPlugin, packPlugin } from './support/plugins.js';

const fixture = fileURLToPath(new URL('../fixtures/inventory/e2e-inventory', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-inventory-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function openSheet(page: Page, tableId: string, name: string) {
  await page.goto(`/tables/${tableId}`);
  await page.getByRole('button', { name: `Open sheet: ${name}` }).click();
  const sheet = page.locator('[data-plugin="e2e-inventory"]');
  await expect(sheet).toBeVisible();
  return sheet;
}

// T-1206 (FR-SHEET-12, ADR-063): a player adds armour to their sheet and equips it; AC
// follows at once, on the GM's open copy too.
test('a player equips armour and attacks with a weapon', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(gm, packPlugin(fixture, path.join(temp, 'e2e-inventory.vttplugin')));
  await post(gm, '/plugins/e2e-inventory/enable', { acknowledgeCode: true });
  const player = await createPlayer(browser, gm, 'theo', 'Theo');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Inventory Table',
    systemId: 'e2e-inventory',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);
  await post(player, `/tables/${table.id}/actors`, { type: 'hero', name: 'Kael' });
  await post(gm, `/tables/${table.id}/items`, { type: 'armor', name: 'Chain mail' });
  await post(gm, `/tables/${table.id}/items`, { type: 'weapon', name: 'Longsword' });

  const errors: string[] = [];
  const pageOf = async (who: typeof gm) => {
    const page = await who.context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    return page;
  };
  const playerPage = await pageOf(player);
  const playerSheet = await openSheet(playerPage, table.id, 'Kael');
  const gmSheet = await openSheet(await pageOf(gm), table.id, 'Kael');
  const ac = (sheet: typeof gmSheet) => sheet.getByRole('status', { name: 'AC' });
  await expect(ac(playerSheet)).toHaveText('10');

  await test.step('the player adds armour from the library', async () => {
    await expect(playerSheet.getByText('No items here yet.')).toHaveCount(2);
    await playerSheet.getByRole('button', { name: 'Add armor' }).click();
    await expect(playerSheet.getByRole('listitem', { name: 'Chain mail' })).toBeVisible();
    await expect(gmSheet.getByRole('listitem', { name: 'Chain mail' })).toBeVisible();
  });

  await test.step('equipping it raises AC on both sheets', async () => {
    await playerSheet.getByLabel('Equipped').check();
    await expect(ac(playerSheet)).toHaveText('12');
    await expect(ac(gmSheet)).toHaveText('12', { timeout: 1000 });
    await expect(gmSheet.getByLabel('Equipped')).toBeChecked();

    await gmSheet.getByLabel('Bonus').fill('5');
    await expect(ac(playerSheet)).toHaveText('15', { timeout: 1000 });
  });

  // T-1207: a roll made with the item, from its row.
  await test.step("an attack from the weapon's row shows the weapon's damage", async () => {
    await playerSheet.getByRole('button', { name: 'Add weapon' }).click();
    const row = playerSheet.getByRole('listitem', { name: 'Longsword' });
    await row.getByLabel('Damage').fill('1d8');
    await row.getByLabel('Damage').blur();
    await row.getByRole('button', { name: 'Attack' }).click();
    const log = playerPage.getByRole('log', { name: 'Messages' });
    await expect(log).toContainText('Longsword');
    await expect(log).toContainText('1d8');
  });

  expect(errors).toEqual([]);
});
