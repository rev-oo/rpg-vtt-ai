import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn } from './support/api.js';
import { installPlugin, packPlugin, setActorData } from './support/plugins.js';

const reference = fileURLToPath(new URL('../../plugins/', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-phone-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

/** Fails when anything makes the page wider than the viewport (FR-SHEET-10). */
async function expectNoHorizontalScroll(page: Page) {
  // A string, as this package has no DOM types; it runs in the page.
  const overflow = await page.evaluate<number>(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// T-0511, T-1201: below 768 px every panel is a full-screen tab of one group (FR-SHEET-10,
// FR-TABLE-08, ADR-059).
test('sheets on a phone', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(
    gm,
    packPlugin(path.join(reference, 'tiny-d20'), path.join(temp, 'tiny-d20.vttplugin')),
  );
  await post(gm, '/plugins/tiny-d20/enable', { acknowledgeCode: true });
  const player = await createPlayer(browser, gm, 'pia', 'Pia');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Phone Table',
    systemId: 'tiny-d20',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);
  const { actor } = await post<{ actor: { id: string } }>(player, `/tables/${table.id}/actors`, {
    type: 'character',
    name: 'Ayla',
  });
  // A long skill name and notes, which must wrap rather than widen the page.
  setActorData(actor.id, {
    skills: { s1: { name: 'Climbing-very-steep-walls', ability: 'str', rank: 4, sort: 'i' } },
    notes: 'A'.repeat(400),
  });

  const page = await player.context.newPage();
  await page.setViewportSize({ width: 360, height: 740 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/tables/${table.id}`);
  const sheet = page.locator('[data-plugin="tiny-d20"]');
  const sheetTab = page.getByRole('tab', { name: 'Ayla' });
  const log = page.getByRole('log', { name: 'Messages' });
  const show = async (panel: string) => {
    await page.getByRole('button', { name: 'Panels' }).click();
    await page.getByRole('list', { name: 'Panels' }).getByRole('button', { name: panel }).click();
  };
  await show('Actors');
  await page.getByRole('button', { name: 'Open sheet: Ayla' }).click();
  await expect(sheet.getByLabel('Strength')).toBeVisible();

  await test.step('the sheet fills the screen', async () => {
    await expect(sheetTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('list', { name: 'Actors' })).toBeHidden();
    await expect(log).toBeHidden();
    await expectNoHorizontalScroll(page);
    for (const tab of ['Skills', 'Notes']) {
      await sheet.getByRole('tab', { name: tab }).click();
      await expectNoHorizontalScroll(page);
    }
  });

  await test.step('the dice panel rolls as the sheet’s actor', async () => {
    await show('Dice');
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: 'Roll a d20' }).click();
    await expect(page.getByText('Rolled. The result is in the chat.')).toBeVisible();
    await page.getByLabel('Formula').fill('2d6 + @str');
    await page.getByRole('button', { name: 'Roll', exact: true }).click();
    await expectNoHorizontalScroll(page);
  });

  await test.step('the chat shows the rolls; the sheet is still live', async () => {
    await show('Chat');
    await expect(log).toBeVisible();
    await expect(log.getByText(/1d20/)).toBeVisible();
    await expect(log.getByText(/2d6 \+ 10/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await sheetTab.click();
    await expect(sheet.getByLabel('Strength')).toBeVisible();
  });

  await test.step('from 768 px the desktop layout returns, as it was left there', async () => {
    await page.setViewportSize({ width: 1024, height: 740 });
    await expect(page.getByRole('list', { name: 'Actors' })).toBeVisible();
    await expect(log).toBeVisible();
    // Phones and desktops keep separate layouts (ADR-059).
    await expect(sheet).toHaveCount(0);
  });

  expect(errors).toEqual([]);
  await gm.context.close();
  await player.context.close();
});
