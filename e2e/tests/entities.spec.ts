import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn, type SignedIn } from './support/api.js';

// T-0204 and T-0208: a GM and a player manage actors and items in two browser sessions, and
// each sees the other's changes without reloading (FR-ENT-01..07).
test('actors and items between a GM and a player', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const dana = await createPlayer(browser, gm, 'dana', 'Dana');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Entity Table',
    systemId: 'e2e-system',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(dana, `/invites/${token}/accept`);

  const open = async (who: SignedIn): Promise<Page> => {
    const page = await who.context.newPage();
    await page.goto(`/tables/${table.id}`);
    await expect(page.getByRole('heading', { name: 'Entity Table' })).toBeVisible();
    await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
    return page;
  };
  const [gmPage, danaPage] = await Promise.all([open(gm), open(dana)]);
  const actors = (page: Page) => page.getByRole('list', { name: 'Actors' });
  const row = (page: Page, name: string) =>
    actors(page)
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });

  const create = async (page: Page, kind: 'actor' | 'item', name: string, type?: string) => {
    await page.getByRole('button', { name: `New ${kind}` }).click();
    const dialog = page.getByRole('dialog', { name: `New ${kind}` });
    await dialog.getByLabel('Name').fill(name);
    if (type) await dialog.getByLabel('Type').selectOption(type);
    await dialog.getByRole('button', { name: `Create ${kind}` }).click();
    await expect(dialog).toBeHidden();
  };

  await test.step('a player creates a character; the GM sees it appear (FR-ENT-01, 07)', async () => {
    await danaPage.getByRole('button', { name: 'New actor' }).click();
    const types = danaPage.getByRole('dialog').getByLabel('Type').getByRole('option');
    await expect(types).toHaveText(['character']);
    await danaPage.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await create(danaPage, 'actor', 'Dana the Bold');
    await expect(row(gmPage, 'Dana the Bold')).toBeVisible();
  });

  await test.step('a hidden NPC appears once the GM shares it (FR-ENT-02, 03)', async () => {
    await create(gmPage, 'actor', 'Goblin', 'npc');
    await expect(row(gmPage, 'Goblin')).toBeVisible();

    await row(gmPage, 'Goblin').getByRole('button', { name: 'Ownership' }).click();
    const dialog = gmPage.getByRole('dialog', { name: 'Ownership of Goblin' });
    await dialog.getByLabel('Everyone else').selectOption({ label: 'Can view' });
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(row(danaPage, 'Goblin')).toContainText('You can view');
    await expect(row(danaPage, 'Goblin').getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(row(danaPage, 'Goblin').getByRole('button', { name: 'Duplicate' })).toHaveCount(0);
  });

  await test.step('duplicate, delete and restore (FR-ENT-04)', async () => {
    await row(danaPage, 'Dana the Bold').getByRole('button', { name: 'Duplicate' }).click();
    await expect(row(gmPage, 'Dana the Bold (copy)')).toBeVisible();

    await row(danaPage, 'Dana the Bold (copy)').getByRole('button', { name: 'Delete' }).click();
    await expect(row(gmPage, 'Dana the Bold (copy)')).toHaveCount(0);

    await danaPage.getByLabel('Show trash').check();
    await row(danaPage, 'Dana the Bold (copy)').getByRole('button', { name: 'Restore' }).click();
    await expect(row(gmPage, 'Dana the Bold (copy)')).toBeVisible();
    await danaPage.getByLabel('Show trash').uncheck();
  });

  await test.step('search and type filters (FR-ENT-04)', async () => {
    await gmPage.getByLabel('Search actors').fill('copy');
    await expect(actors(gmPage).getByRole('heading')).toHaveText(['Dana the Bold (copy)']);
    await gmPage.getByLabel('Search actors').fill('');
    await gmPage.getByLabel('Type').selectOption('npc');
    await expect(actors(gmPage).getByRole('heading')).toHaveText(['Goblin']);
    await gmPage.getByLabel('Type').selectOption('');
    await expect(actors(gmPage).getByRole('heading')).toHaveCount(3);
  });

  await test.step('the GM stocks the library; the player copies an item (FR-ENT-05, 06)', async () => {
    for (const page of [gmPage, danaPage]) {
      await page.getByRole('tab', { name: 'Items' }).click();
    }
    await expect(danaPage.getByRole('button', { name: 'New item' })).toHaveCount(0);
    await create(gmPage, 'item', 'Sword', 'weapon');
    const items = danaPage.getByRole('list', { name: 'Items' });
    await expect(items.getByRole('heading', { name: 'Sword' })).toBeVisible();

    await danaPage.getByLabel('Give Sword to').selectOption({ label: 'Dana the Bold' });
    await danaPage.getByRole('button', { name: 'Give' }).click();
    await expect(danaPage.getByText('Dana the Bold received a copy of Sword.')).toBeVisible();

    await danaPage.getByRole('tab', { name: 'Actors' }).click();
    await row(danaPage, 'Dana the Bold').getByText('Items').click();
    await expect(row(danaPage, 'Dana the Bold')).toContainText('Sword (weapon)');
  });

  for (const who of [gm, dana]) await who.context.close();
});

// T-0812: a list longer than one page loads the rest as the user scrolls (§10.1, ADR-057).
test('long lists load more on scroll', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Crowded Table',
    systemId: 'e2e-system',
  });
  const names = Array.from({ length: 120 }, (_, i) => `Goblin ${String(i).padStart(3, '0')}`);
  for (const name of names) {
    await post(gm, `/tables/${table.id}/actors`, { type: 'npc', name });
  }

  const page = await gm.context.newPage();
  await page.goto(`/tables/${table.id}`);
  const rows = page.getByRole('list', { name: 'Actors' }).getByRole('listitem');
  await expect(rows).toHaveCount(50);
  // Scrolling to the end loads each next page, until the list has no more.
  await expect(async () => {
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows).toHaveCount(names.length, { timeout: 1000 });
  }).toPass();
  await expect(rows.last()).toContainText('Goblin 119');
  await expect(page.getByRole('button', { name: 'Load more' })).toBeHidden();
});
