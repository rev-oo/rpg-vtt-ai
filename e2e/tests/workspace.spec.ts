import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, post, signIn } from './support/api.js';
import { installPlugin, packPlugin } from './support/plugins.js';

const reference = fileURLToPath(new URL('../../plugins/', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-workspace-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const panel = (page: Page, name: string) => page.getByRole('tabpanel', { name, exact: true });
/** The tab strip a tab sits in: tabs in one strip share a group. */
const strip = (page: Page, name: string) =>
  page.getByRole('tablist').filter({ has: tab(page, name) });

// T-1201 (FR-TABLE-08, ADR-059): the table is a dockview workspace, kept per user and table.
test('the table workspace on desktop and phone', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(
    gm,
    packPlugin(path.join(reference, 'tiny-d20'), path.join(temp, 'tiny-d20.vttplugin')),
  );
  await post(gm, '/plugins/tiny-d20/enable', { acknowledgeCode: true });
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Workspace Table',
    systemId: 'tiny-d20',
  });
  for (const name of ['Wren', 'Goblin']) {
    await post(gm, `/tables/${table.id}/actors`, { type: 'character', name });
  }

  const page = await gm.context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/tables/${table.id}`);
  const actors = page.getByRole('list', { name: 'Actors' });
  const log = page.getByRole('log', { name: 'Messages' });

  await test.step('the table fills the page with its panels', async () => {
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await expect(actors.getByRole('heading', { name: 'Wren' })).toBeVisible();
    await expect(panel(page, 'Table')).toBeVisible();
    await expect(log).toBeVisible();
  });

  await test.step('two sheets open side by side; the URL stays on the table', async () => {
    await page.getByRole('button', { name: 'Open sheet: Wren' }).click();
    await expect(panel(page, 'Wren').getByLabel('Strength')).toBeVisible();
    await page.getByRole('button', { name: 'Open sheet: Goblin' }).click();
    await expect(panel(page, 'Goblin').getByLabel('Strength')).toBeVisible();
    const content = await panel(page, 'Goblin').boundingBox();
    if (!content) throw new Error('the Goblin panel is not shown');
    await tab(page, 'Goblin').dragTo(panel(page, 'Goblin'), {
      targetPosition: { x: content.width - 20, y: content.height / 2 },
    });
    await expect(panel(page, 'Wren')).toBeVisible();
    await expect(panel(page, 'Goblin')).toBeVisible();
    await tab(page, 'Wren').click();
    await expect(page).toHaveURL(new RegExp(`/tables/${table.id}$`));
    await expect(actors).toBeVisible();
  });

  await test.step('a closed panel comes back from the Panels menu', async () => {
    await page.getByRole('button', { name: 'Close Chat' }).click();
    await expect(log).toHaveCount(0);
    await page.getByRole('button', { name: 'Panels' }).click();
    await page.getByRole('list', { name: 'Panels' }).getByRole('button', { name: /^Chat/ }).click();
    await expect(log).toBeVisible();
  });

  await test.step('a reload finds the layout, the open sheets and the filters', async () => {
    await tab(page, 'Combat').dragTo(tab(page, 'Actors'));
    await expect(strip(page, 'Actors')).toContainText('Combat');
    await tab(page, 'Actors').click();
    await page.getByLabel('Search actors').fill('Wr');
    await expect(actors.getByRole('heading', { name: 'Goblin' })).toHaveCount(0);

    await page.reload();
    await expect(panel(page, 'Wren').getByLabel('Strength')).toBeVisible();
    await expect(panel(page, 'Goblin').getByLabel('Strength')).toBeVisible();
    await expect(strip(page, 'Actors')).toContainText('Combat');
    await tab(page, 'Actors').click();
    await expect(page.getByLabel('Search actors')).toHaveValue('Wr');
    await expect(actors.getByRole('heading', { name: 'Goblin' })).toHaveCount(0);
  });

  await test.step('the keyboard moves along a tab strip and opens a tab (NFR-10)', async () => {
    await tab(page, 'Actors').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Items')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(tab(page, 'Items')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Search items')).toBeVisible();
  });

  await test.step('Reset layout brings the default back', async () => {
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await expect(strip(page, 'Actors')).not.toContainText('Combat');
    await expect(panel(page, 'Table')).toBeVisible();
  });

  await test.step('a phone shows one panel at a time, with its own layout', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.getByRole('tablist')).toHaveCount(1);
    await expect(panel(page, 'Table')).toBeVisible();
    await expect(log).toBeHidden();
    await tab(page, 'Chat').click();
    await expect(log).toBeVisible();
    await expect(panel(page, 'Table')).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('tablist')).not.toHaveCount(1);
    await expect(actors).toBeVisible();
  });

  expect(errors).toEqual([]);
  await gm.context.close();
});
