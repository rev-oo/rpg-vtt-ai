import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn } from './support/api.js';

// T-0207: public, whisper and GM-only messages reach exactly the members allowed to see
// them (FR-CHAT-02), live and in history.
test('chat audiences between a GM and two players', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const bob = await createPlayer(browser, gm, 'bob', 'Bob');
  const carol = await createPlayer(browser, gm, 'carol', 'Carol');

  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Chat Table',
    systemId: 'e2e-system',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  for (const player of [bob, carol]) await post(player, `/invites/${token}/accept`);

  const open = async (who: typeof gm): Promise<Page> => {
    const page = await who.context.newPage();
    await page.goto(`/tables/${table.id}`);
    await expect(page.getByRole('heading', { name: 'Chat Table' })).toBeVisible();
    // Connected and subscribed: nothing sent from now on is missed.
    await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
    return page;
  };
  const [gmPage, bobPage, carolPage] = await Promise.all([open(gm), open(bob), open(carol)]);
  const log = (page: Page) => page.getByRole('log', { name: 'Messages' });

  const send = async (text: string, audience: string, recipients: string[] = []) => {
    await bobPage.getByLabel('Send to').selectOption({ label: audience });
    for (const name of recipients) {
      await bobPage.getByRole('group', { name: 'Recipients' }).getByLabel(name).check();
    }
    await bobPage.getByLabel('Message', { exact: true }).fill(text);
    await bobPage.getByLabel('Message', { exact: true }).press('Enter');
    await expect(log(bobPage)).toContainText(text);
  };

  await test.step('a public message reaches everyone', async () => {
    await send('Hello everyone', 'Everyone');
    for (const page of [gmPage, carolPage]) await expect(log(page)).toContainText('Hello everyone');
  });

  await test.step('a whisper reaches only its recipient', async () => {
    await send('Psst, Carol', 'Whisper', ['Carol']);
    await expect(log(carolPage)).toContainText('Psst, Carol');
    await expect(log(carolPage)).toContainText('Whisper to Carol');
  });

  await test.step('a GM message reaches only the GM', async () => {
    await send('Secret plan', 'GM only');
    await expect(log(gmPage)).toContainText('Secret plan');
  });

  await test.step('nobody else received them', async () => {
    // A later public message arrives after anything sent before it.
    await send('Last call', 'Everyone');
    for (const page of [gmPage, carolPage]) await expect(log(page)).toContainText('Last call');
    await expect(log(gmPage)).not.toContainText('Psst, Carol');
    await expect(log(carolPage)).not.toContainText('Secret plan');
  });

  await test.step('history applies the same audiences', async () => {
    await carolPage.reload();
    await expect(log(carolPage)).toContainText('Last call');
    await expect(log(carolPage)).toContainText('Psst, Carol');
    await expect(log(carolPage)).not.toContainText('Secret plan');
    await gmPage.reload();
    await expect(log(gmPage)).toContainText('Secret plan');
    await expect(log(gmPage)).not.toContainText('Psst, Carol');
  });

  for (const who of [gm, bob, carol]) await who.context.close();
});
