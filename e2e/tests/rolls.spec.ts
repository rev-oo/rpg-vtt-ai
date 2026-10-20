import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn, type SignedIn } from './support/api.js';

// T-0305: dice typed in chat are rolled by the server (FR-CHAT-03, 08); secret rolls reach
// only the roller and the GM (FR-CHAT-05), live and in history. `1d1` keeps totals known.
test('public and secret rolls between a GM and two players', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const erin = await createPlayer(browser, gm, 'erin', 'Erin');
  const finn = await createPlayer(browser, gm, 'finn', 'Finn');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Dice Table',
    systemId: 'e2e-system',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  for (const player of [erin, finn]) await post(player, `/invites/${token}/accept`);

  const open = async (who: SignedIn): Promise<Page> => {
    const page = await who.context.newPage();
    await page.goto(`/tables/${table.id}`);
    await expect(page.getByRole('heading', { name: 'Dice Table' })).toBeVisible();
    await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
    return page;
  };
  const [gmPage, erinPage, finnPage] = await Promise.all([open(gm), open(erin), open(finn)]);
  const log = (page: Page) => page.getByRole('log', { name: 'Messages' });
  const type = async (page: Page, text: string) => {
    const input = page.getByLabel('Message', { exact: true });
    await input.fill(text);
    await input.press('Enter');
    await expect(input).toHaveValue('');
  };

  await test.step('a public roll shows its dice and total to everyone', async () => {
    await type(erinPage, '/r 3d1 + 39');
    for (const page of [gmPage, erinPage, finnPage]) {
      await expect(log(page).getByLabel('Total 42', { exact: true })).toBeVisible();
      await expect(log(page).getByRole('list', { name: 'Dice of 3d1' })).toBeVisible();
    }
  });

  await test.step('secret rolls reach only the roller and the GM', async () => {
    await type(erinPage, '/gmr 1d1 + 99');
    await type(gmPage, '/gmr 1d1 + 199');
    await expect(log(gmPage).getByLabel('Total 100', { exact: true })).toBeVisible();
    await expect(log(gmPage).getByLabel('Total 200', { exact: true })).toBeVisible();
    await expect(log(erinPage).getByLabel('Total 100', { exact: true })).toBeVisible();

    // A later public roll arrives after anything sent before it.
    await type(gmPage, '/r 1d1');
    for (const page of [erinPage, finnPage])
      await expect(log(page).getByLabel('Total 1', { exact: true })).toBeVisible();
    await expect(log(finnPage)).not.toContainText('1d1 + 99');
    await expect(log(finnPage)).not.toContainText('1d1 + 199');
    await expect(log(erinPage)).not.toContainText('1d1 + 199');
  });

  await test.step('history applies the same audiences', async () => {
    await finnPage.reload();
    await expect(log(finnPage).getByLabel('Total 42', { exact: true })).toBeVisible();
    await expect(log(finnPage)).not.toContainText('+ 99');
    await expect(log(finnPage)).not.toContainText('+ 199');
    await gmPage.reload();
    await expect(log(gmPage).getByLabel('Total 100', { exact: true })).toBeVisible();
  });

  await test.step('an invalid formula explains itself', async () => {
    const input = erinPage.getByLabel('Message', { exact: true });
    await input.fill('/r 1d20 + str');
    await input.press('Enter');
    await expect(erinPage.getByRole('alert')).toContainText('Unknown name "str"');
    await expect(input).toHaveValue('/r 1d20 + str');
  });

  for (const who of [gm, erin, finn]) await who.context.close();
});
