import { expect, test, type Locator, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn } from './support/api.js';
import { openSheet, showPanel } from './support/workspace.js';

// T-1302 (FR-ASSET-02, ADR-065): the GM uploads an image, sets it as an actor's portrait and
// puts it in a journal entry; a player sees both; an image in use cannot be deleted.

/** A 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Waits for the 1×1 image to actually load, not just its element. */
const loaded = (image: Locator) => expect(image).toHaveJSProperty('naturalWidth', 1);

test('an uploaded image becomes a portrait and a journal picture', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const nora = await createPlayer(browser, gm, 'nora', 'Nora');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Asset Table',
    systemId: 'e2e-system',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(nora, `/invites/${token}/accept`);
  await post(gm, `/tables/${table.id}/actors`, {
    type: 'npc',
    name: 'Ogre',
    ownership: { default: 'observer', users: {} },
  });

  const open = async (who: typeof gm): Promise<Page> => {
    const page = await who.context.newPage();
    await page.goto(`/tables/${table.id}`);
    await expect(page.getByRole('heading', { name: 'Asset Table' })).toBeVisible();
    return page;
  };
  const gmPage = await open(gm);

  await test.step('the GM uploads an image in the Images panel', async () => {
    await showPanel(gmPage, 'Images');
    await gmPage
      .getByLabel('Image files')
      .setInputFiles({ name: 'cave.png', mimeType: 'image/png', buffer: PNG });
    await expect(gmPage.getByText('Images uploaded: 1.')).toBeVisible();
    await loaded(
      gmPage
        .getByRole('list', { name: 'Images of the table' })
        .getByRole('listitem')
        .locator('img'),
    );
  });

  await test.step("and sets it as the Ogre's portrait", async () => {
    await showPanel(gmPage, 'Actors');
    await openSheet(gmPage, 'Ogre');
    const sheet = gmPage.getByRole('tabpanel', { name: 'Ogre' });
    await sheet.getByRole('button', { name: 'Choose image' }).click();
    await gmPage
      .getByRole('dialog', { name: 'Choose an image' })
      .getByRole('button', { name: 'Use cave.png' })
      .click();
    await expect(sheet.getByRole('button', { name: 'Change image' })).toBeVisible();
    await loaded(sheet.locator('img[src^="/api/v1/assets/"]').first());
  });

  await test.step('and puts it in a journal entry', async () => {
    await showPanel(gmPage, 'Journal');
    await gmPage.getByRole('button', { name: 'New entry' }).click();
    const dialog = gmPage.getByRole('dialog', { name: 'New entry' });
    await dialog.getByLabel('Title').fill('The Cave');
    await dialog.getByRole('button', { name: 'Create entry' }).click();
    await gmPage.getByRole('button', { name: 'Open: The Cave' }).click();
    const panel = gmPage.getByRole('tabpanel', { name: 'The Cave' });
    await panel.getByRole('textbox', { name: 'The Cave' }).click();
    await gmPage.keyboard.type('Beware the cave.');
    await panel.getByRole('button', { name: 'Image' }).click();
    await gmPage
      .getByRole('dialog', { name: 'Choose an image' })
      .getByRole('button', { name: 'Use cave.png' })
      .click();
    await loaded(panel.getByRole('img', { name: 'cave.png' }));
    await panel.getByRole('button', { name: 'Reveal to players' }).click();
  });

  await test.step('a player sees the portrait and the picture', async () => {
    const noraPage = await open(nora);
    await loaded(
      noraPage
        .getByRole('list', { name: 'Actors' })
        .getByRole('listitem')
        .filter({ hasText: 'Ogre' })
        .locator('img'),
    );
    await showPanel(noraPage, 'Journal');
    await noraPage.getByRole('button', { name: 'Open: The Cave' }).click();
    await loaded(
      noraPage.getByRole('tabpanel', { name: 'The Cave' }).getByRole('img', { name: 'cave.png' }),
    );
    // Players browse the images but neither upload nor delete.
    await showPanel(noraPage, 'Images');
    await expect(noraPage.getByRole('listitem', { name: 'cave.png' })).toBeVisible();
    await expect(noraPage.getByRole('button', { name: 'Upload images' })).toHaveCount(0);
  });

  await test.step('an image in use is not deleted', async () => {
    await showPanel(gmPage, 'Images');
    await gmPage.getByRole('button', { name: 'Delete cave.png' }).click();
    await gmPage
      .getByRole('dialog', { name: 'Delete this image?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(gmPage.getByText('Actor: Ogre')).toBeVisible();
    await expect(gmPage.getByText('Journal entry: The Cave')).toBeVisible();
    await expect(gmPage.getByRole('listitem', { name: 'cave.png' })).toBeVisible();
  });
});
