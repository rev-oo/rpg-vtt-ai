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

const actors = (page: Page) => page.getByRole('list', { name: 'Actors' });
const messages = (page: Page) => page.getByRole('log', { name: 'Messages' });
const sheet = (page: Page) => page.locator('[data-plugin="tiny-d20"]').getByLabel('Strength');

// T-1201 (FR-TABLE-08, ADR-059): the table fills the page, with panels around the open sheet.
test('the table workspace keeps its layout per table', async ({ browser }) => {
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
  await post(gm, `/tables/${table.id}/actors`, { type: 'character', name: 'Wren' });

  const page = await gm.context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/tables/${table.id}`);
  const panels = page.getByRole('group', { name: 'Panels' });
  const browseHandle = page.getByRole('separator', { name: 'Resize the lists' });

  await test.step('a sheet opens on the stage, beside the lists and the chat', async () => {
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Open sheet: Wren' }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(actors(page).getByRole('heading', { name: 'Wren' })).toBeVisible();
    await expect(messages(page)).toBeVisible();
  });

  await test.step('panels collapse and resize, by pointer and keyboard', async () => {
    await panels.getByRole('button', { name: 'Chat' }).click();
    await expect(messages(page)).toBeHidden();
    await expect(sheet(page)).toBeVisible();

    const box = await browseHandle.boundingBox();
    if (!box) throw new Error('the resize handle is not shown');
    const start = Number(await browseHandle.getAttribute('aria-valuenow'));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(browseHandle).toHaveAttribute('aria-valuenow', String(start + 100));

    await browseHandle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(browseHandle).toHaveAttribute('aria-valuenow', String(start + 84));
    const panel = await page.getByRole('complementary', { name: 'Lists' }).boundingBox();
    expect(panel?.width).toBe(start + 84);
  });

  await test.step('a reload finds the same layout', async () => {
    const width = await browseHandle.getAttribute('aria-valuenow');
    await page.reload();
    await expect(sheet(page)).toBeVisible();
    await expect(panels.getByRole('button', { name: 'Chat' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(messages(page)).toBeHidden();
    await expect(browseHandle).toHaveAttribute('aria-valuenow', width ?? '');
    await panels.getByRole('button', { name: 'Lists' }).click();
    await expect(actors(page)).toBeHidden();
    await expect(browseHandle).toBeHidden();
  });

  await test.step('on a phone each panel fills the screen', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/tables/${table.id}`);
    const bar = page.getByRole('navigation', { name: 'Table views' });
    // The desktop layout's collapsed panels do not hide them on a phone.
    await expect(bar.getByRole('button', { name: 'Lists' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(actors(page)).toBeVisible();
    await bar.getByRole('button', { name: 'Chat' }).click();
    await expect(messages(page)).toBeVisible();
    await expect(actors(page)).toBeHidden();
    await bar.getByRole('button', { name: 'Lists' }).click();
    await page.getByRole('link', { name: 'Open sheet: Wren' }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Sheet' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(actors(page)).toBeHidden();
  });

  expect(errors).toEqual([]);
  await gm.context.close();
});
