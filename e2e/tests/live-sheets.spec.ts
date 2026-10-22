import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, patch, post, signIn } from './support/api.js';
import { installPlugin, packPlugin } from './support/plugins.js';

const reference = fileURLToPath(new URL('../../plugins/', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-live-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function openSheet(page: Page, tableId: string, actorId: string) {
  await page.goto(`/tables/${tableId}/actors/${actorId}`);
  const sheet = page.locator('[data-plugin="tiny-d20"]');
  await expect(sheet).toBeVisible();
  return sheet;
}

// T-0506: two browsers edit one sheet and see each other's changes within 500 ms; an
// observer follows read-only (FR-SHEET-01, 03, 08).
test('two browsers edit one live sheet', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(
    gm,
    packPlugin(path.join(reference, 'tiny-d20'), path.join(temp, 'tiny-d20.vttplugin')),
  );
  await post(gm, '/plugins/tiny-d20/enable', { acknowledgeCode: true });
  const owner = await createPlayer(browser, gm, 'lena', 'Lena');
  const watcher = await createPlayer(browser, gm, 'omar', 'Omar');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Live Table',
    systemId: 'tiny-d20',
  });
  for (const player of [owner, watcher]) {
    const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
      role: 'player',
    });
    await post(player, `/invites/${token}/accept`);
  }
  const { actor } = await post<{ actor: { id: string } }>(owner, `/tables/${table.id}/actors`, {
    type: 'character',
    name: 'Ayla',
  });
  await patch(gm, `/actors/${actor.id}`, {
    ownership: { default: 'observer', users: { [owner.userId]: 'owner' } },
  });

  const errors: string[] = [];
  const pageOf = async (who: typeof gm) => {
    const page = await who.context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    return page;
  };
  const ownerSheet = await openSheet(await pageOf(owner), table.id, actor.id);
  const gmSheet = await openSheet(await pageOf(gm), table.id, actor.id);
  const watcherSheet = await openSheet(await pageOf(watcher), table.id, actor.id);

  await test.step('changes reach the other browsers within 500 ms', async () => {
    await ownerSheet.getByLabel('Strength').fill('14');
    await expect(gmSheet.getByLabel('Strength')).toHaveValue('14', { timeout: 500 });
    await expect(watcherSheet.getByLabel('Strength')).toHaveValue('14', { timeout: 500 });
    // Derived values follow on every copy (FR-SHEET-05).
    await expect(gmSheet.getByRole('status', { name: 'Str mod' })).toHaveText('+2');

    await gmSheet.getByLabel('Dexterity').fill('12');
    await expect(ownerSheet.getByLabel('Dexterity')).toHaveValue('12', { timeout: 500 });
  });

  await test.step('counter steps from two browsers add up (FR-SHEET-08)', async () => {
    const hp = (sheet: typeof gmSheet) =>
      sheet.getByRole('textbox', { name: 'Hit points', exact: true });
    await expect(hp(ownerSheet)).toHaveValue('10');
    const minus = (sheet: typeof gmSheet) =>
      sheet.getByRole('button', { name: 'Decrease Hit points' }).click();
    await Promise.all([minus(ownerSheet), minus(gmSheet), minus(ownerSheet)]);
    for (const sheet of [ownerSheet, gmSheet, watcherSheet])
      await expect(hp(sheet)).toHaveValue('7');
  });

  await test.step('an observer reads along but cannot edit (FR-SHEET-03)', async () => {
    await expect(watcherSheet.getByLabel('Strength')).toHaveAttribute('readonly');
    await expect(watcherSheet.getByRole('button', { name: 'Decrease Hit points' })).toBeDisabled();
  });

  await test.step('others see who is in a field within 1 s (FR-SHEET-02, T-0507)', async () => {
    const field = (sheet: typeof gmSheet) => sheet.locator('[data-field="dex"]');
    await ownerSheet.getByLabel('Dexterity').focus();
    await expect(field(gmSheet).locator('[data-presence]')).toHaveText('Lena', { timeout: 1000 });
    await expect(field(watcherSheet).locator('[data-presence]')).toHaveText('Lena', {
      timeout: 1000,
    });
    await expect(field(gmSheet)).toHaveCSS('outline-style', 'solid');
    // Nobody sees themselves.
    await expect(field(ownerSheet).locator('[data-presence]')).toHaveCount(0);

    await ownerSheet.getByLabel('Strength').focus();
    await expect(field(gmSheet).locator('[data-presence]')).toHaveCount(0, { timeout: 1000 });
    await expect(gmSheet.locator('[data-field="str"] [data-presence]')).toHaveText('Lena');
  });

  await test.step('the data survives a reload', async () => {
    const page = await pageOf(owner);
    const again = await openSheet(page, table.id, actor.id);
    await expect(again.getByLabel('Strength')).toHaveValue('14');
    await expect(again.getByRole('textbox', { name: 'Hit points', exact: true })).toHaveValue('7');
  });

  expect(errors).toEqual([]);
  for (const who of [gm, owner, watcher]) await who.context.close();
});
