import { expect, test, type Locator, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn } from './support/api.js';
import { showPanel } from './support/workspace.js';

// T-1402 (FR-MAP-01, 02; ADR-067): the GM makes a scene with an uploaded background and shows
// it; the map pans and zooms by mouse, keyboard and buttons, on desktop and on a phone.

/** A 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The canvas wrapper writes its view to these attributes after each frame it draws. */
const view = async (map: Locator) => ({
  zoom: Number(await map.getAttribute('data-zoom')),
  x: Number(await map.getAttribute('data-x')),
  y: Number(await map.getAttribute('data-y')),
});

/** Waits for a drawn frame, then returns the view; fails if WebGL is missing. */
async function drawn(page: Page, name: string): Promise<Locator> {
  const map = page.getByRole('application', { name });
  await expect(map).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('This browser cannot draw maps')).toHaveCount(0);
  await expect(map).toHaveAttribute('data-zoom', /\d/);
  return map;
}

test('a scene is made, shown and explored on desktop and phone', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const nora = await createPlayer(browser, gm, 'mapnora', 'Map Nora');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Map Table',
    systemId: 'e2e-system',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(nora, `/invites/${token}/accept`);
  const uploaded = await gm.context.request.post(
    `/api/v1/tables/${table.id}/assets?name=cave.png`,
    { data: PNG, headers: { 'x-csrf-token': gm.csrf, 'content-type': 'image/png' } },
  );
  expect(uploaded.ok(), await uploaded.text()).toBe(true);

  const gmPage = await gm.context.newPage();
  await gmPage.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  gmPage.on('pageerror', (error) => errors.push(error.message));
  await gmPage.goto(`/tables/${table.id}`);
  const mapPanel = gmPage.getByRole('tabpanel', { name: 'Map', exact: true });

  await test.step('the GM makes a scene with the uploaded background', async () => {
    await expect(mapPanel.getByText('This table has no scenes yet.')).toBeVisible();
    await mapPanel.getByRole('button', { name: 'Open Scenes' }).click();
    await gmPage.getByRole('button', { name: 'New scene' }).click();
    const dialog = gmPage.getByRole('dialog', { name: 'New scene' });
    await dialog.getByLabel('Name').fill('Cave');
    await dialog.getByRole('button', { name: 'Choose background' }).click();
    await gmPage.getByRole('button', { name: 'Use cave.png' }).click();
    await expect(dialog.getByLabel('Background image URL')).toHaveValue(/\/api\/v1\/assets\//);
    await dialog.getByRole('button', { name: 'Create' }).click();
    const scenes = gmPage.getByRole('list', { name: 'Scenes' });
    await expect(scenes.getByRole('listitem', { name: 'Cave' })).toBeVisible();
    await scenes.getByRole('button', { name: 'Show Cave to players' }).click();
    await expect(scenes.getByText('Shown to players')).toBeVisible();
  });

  await test.step('the map draws it and pans and zooms on desktop', async () => {
    await gmPage.getByRole('tab', { name: 'Map', exact: true }).click();
    await expect(mapPanel.getByRole('status')).toHaveText('Players see this scene.');
    const map = await drawn(gmPage, 'Cave');
    await expect(map).toHaveAttribute('data-background', 'shown');
    const start = await view(map);

    await mapPanel.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => (await view(map)).zoom).toBeGreaterThan(start.zoom);

    await map.focus();
    const before = await view(map);
    await gmPage.keyboard.press('ArrowRight');
    await expect.poll(async () => (await view(map)).x).toBeGreaterThan(before.x);

    const box = await map.boundingBox();
    if (!box) throw new Error('the map is not shown');
    const dragged = await view(map);
    await gmPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await gmPage.mouse.down();
    await gmPage.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, {
      steps: 8,
    });
    await gmPage.mouse.up();
    // Dragging right shows what lay to the left.
    await expect.poll(async () => (await view(map)).x).toBeLessThan(dragged.x);

    const wheeled = await view(map);
    await gmPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await gmPage.mouse.wheel(0, -400);
    await expect.poll(async () => (await view(map)).zoom).toBeGreaterThan(wheeled.zoom);

    // 0 shows the whole scene again.
    await map.focus();
    await gmPage.keyboard.press('0');
    await expect.poll(async () => (await view(map)).zoom).toBeLessThan(wheeled.zoom);
  });

  await test.step('a player on a phone sees the shown scene and zooms it', async () => {
    const page = await nora.context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/tables/${table.id}`);
    await expect(page.getByRole('tab', { name: 'Map', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const map = await drawn(page, 'Cave');
    await expect(map).toHaveAttribute('data-background', 'shown');
    // Players neither choose the scene nor manage scenes.
    await expect(page.getByLabel('Scene', { exact: true })).toHaveCount(0);
    const start = await view(map);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => (await view(map)).zoom).toBeGreaterThan(start.zoom);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(async () => (await view(map)).zoom).toBeLessThan(start.zoom);
    await page.getByRole('button', { name: 'Panels' }).click();
    await expect(
      page.getByRole('list', { name: 'Panels' }).getByRole('button', { name: /^Scenes/ }),
    ).toHaveCount(0);
  });

  await test.step('hiding the scene empties the player map', async () => {
    const page = nora.context.pages().at(-1);
    if (!page) throw new Error('the player page is gone');
    await showPanel(gmPage, 'Scenes');
    await gmPage.getByRole('button', { name: 'Stop showing Cave' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('No scene is shown yet.')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
