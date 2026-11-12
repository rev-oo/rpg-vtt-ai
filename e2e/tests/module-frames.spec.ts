import { expect, test } from '@playwright/test';

import { ADMIN, createPlayer, patch, post, signIn } from './support/api.js';
import { showPanel } from './support/workspace.js';

// T-1603 (ADR-077): a module's overlay and panel run in sandboxed frames on the table page. The
// panel rolls as the viewer and the overlay shows the result the server decided; neither reaches
// the page or the network, a player's frame cannot take the GM's combat actions, and a secret
// roll never reaches a player's frame. Each user can turn the table's overlays off.
test('a module overlay and panel act as the viewer and see only what the viewer sees', async ({
  browser,
}) => {
  const gm = await signIn(browser, ADMIN);
  const rin = await createPlayer(browser, gm, 'rin', 'Rin');
  await post(gm, '/plugins/e2e-frames/enable', { acknowledgeCode: true });
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Framed Hall',
    systemId: 'e2e-system',
  });
  await patch(gm, `/tables/${table.id}`, { modules: ['e2e-frames'] });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(rin, `/invites/${token}/accept`);

  const page = await rin.context.newPage();
  await page.goto(`/tables/${table.id}`);
  await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
  const overlay = page.frameLocator('iframe[title="E2E Frames: lastRoll"]');
  await expect(overlay.locator('.last-roll')).toHaveText('Last roll: none');

  await showPanel(page, 'Frame tools');
  const panel = page.frameLocator('iframe[title="Frame tools"]');

  await test.step('the panel reaches neither the page nor the network', async () => {
    await expect(panel.locator('.viewer')).toHaveText('role: player');
    await expect(panel.locator('.probe')).toHaveText(
      'page: blocked; storage: blocked; network: blocked',
    );
  });

  await test.step('a roll from the panel is posted as the viewer and shown by the overlay', async () => {
    await panel.getByRole('button', { name: 'Roll d20' }).click();
    await expect(panel.locator('.status')).toHaveText('Roll d20: done');
    // The server rolled it, as Rin; the overlay shows the total it decided.
    const history = await rin.context.request.get(`/api/v1/tables/${table.id}/messages`);
    const { messages } = (await history.json()) as {
      messages: { senderId: string | null; rolls: { total: number }[] }[];
    };
    const rolled = messages.filter((message) => message.rolls.length > 0);
    expect(rolled).toHaveLength(1);
    expect(rolled[0]?.senderId).toBe(rin.userId);
    await expect(overlay.locator('.last-roll')).toHaveText(
      `Last roll: ${String(rolled[0]?.rolls[0]?.total)}`,
    );
  });

  await test.step("a player's frame cannot take the GM's actions", async () => {
    await panel.getByRole('button', { name: 'Start combat' }).click();
    await expect(panel.locator('.status')).toHaveText(/^Start combat: (?!done).+/);
  });

  await test.step("a secret roll never reaches a player's frame", async () => {
    const before = await overlay.locator('.last-roll').textContent();
    await post(gm, `/tables/${table.id}/rolls`, { formula: '1d20+1000', audience: 'gm' });
    await post(gm, `/tables/${table.id}/messages`, { text: 'after the secret roll' });
    await showPanel(page, 'Chat');
    await expect(
      page.getByRole('log', { name: 'Messages' }).getByText('after the secret roll'),
    ).toBeVisible();
    await expect(overlay.locator('.last-roll')).toHaveText(before ?? '');
  });

  await test.step("the frame changes the viewer's own settings", async () => {
    await showPanel(page, 'Frame tools');
    await panel.getByRole('button', { name: 'Rename label' }).click();
    await expect(panel.locator('.status')).toHaveText('Rename label: done');
    await expect(overlay.locator('.last-roll')).toHaveText(/^Mine: \d+$/);
  });

  await test.step('the viewer can turn the overlays off', async () => {
    // The switch is among the member's own settings (T-1620).
    await showPanel(page, 'Settings');
    const overlays = page.getByRole('checkbox', { name: /overlays on this table/ });
    await overlays.uncheck();
    await expect(page.locator('iframe[title="E2E Frames: lastRoll"]')).toHaveCount(0);
    await page.reload();
    await showPanel(page, 'Settings');
    await expect(overlays).not.toBeChecked();
    await expect(page.locator('iframe[title="E2E Frames: lastRoll"]')).toHaveCount(0);
  });

  for (const who of [gm, rin]) await who.context.close();
});
