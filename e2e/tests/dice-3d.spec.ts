import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, patch, post, signIn } from './support/api.js';
import { installPlugin, packPlugin } from './support/plugins.js';
import { showPanel } from './support/workspace.js';

// T-1604: the dice-3d module, packed with three.js and cannon-es like any author's plugin, throws
// 3D dice in an overlay for each roll and lands them on the server's results. The chat never
// waits for them, and each member can hide them with the table's Overlays switch.

const plugin = fileURLToPath(new URL('../../plugins/dice-3d/', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-dice-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

const OVERLAY = 'iframe[title="3D dice: dice"]';

test('3D dice land on the rolled results without holding up the chat', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const rin = await createPlayer(browser, gm, 'rin3d', 'Rin');
  await installPlugin(gm, packPlugin(plugin, path.join(temp, 'dice-3d.vttplugin')));
  await post(gm, '/plugins/dice-3d/enable', { acknowledgeCode: true });
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Dice Tower',
    systemId: 'e2e-system',
  });
  await patch(gm, `/tables/${table.id}`, { modules: ['dice-3d'] });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(rin, `/invites/${token}/accept`);

  const open = async (page: Page): Promise<void> => {
    await page.goto(`/tables/${table.id}`);
    await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
  };
  const gmPage = await gm.context.newPage();
  const rinPage = await rin.context.newPage();
  await Promise.all([open(gmPage), open(rinPage)]);
  const dice = (page: Page) => page.frameLocator(OVERLAY).locator('.dice');
  await expect(dice(rinPage)).toHaveAttribute('data-state', 'idle');

  await test.step('a roll shows in the chat at once while the dice are still rolling', async () => {
    await showPanel(gmPage, 'Chat');
    const input = gmPage.getByLabel('Message', { exact: true });
    await input.fill('/r 1d20 + 2d6 + 1d100 + 1d4');
    await input.press('Enter');
    await expect(
      gmPage.getByRole('log', { name: 'Messages' }).getByText('1d20 + 2d6 + 1d100 + 1d4'),
    ).toBeVisible();
    // The chat did not wait: the dice have not landed yet.
    await expect(dice(gmPage)).toHaveAttribute('data-state', 'rolling');
    await expect(dice(gmPage).locator('canvas')).toBeVisible();
  });

  await test.step('the dice land on the results the server rolled', async () => {
    const response = await gm.context.request.get(`/api/v1/tables/${table.id}/messages`);
    const { messages } = (await response.json()) as {
      messages: { rolls: { dice: { die: string; results: { value: number }[] }[] }[] }[];
    };
    const rolled = messages.flatMap((message) => message.rolls);
    expect(rolled).toHaveLength(1);
    const expected = rolled
      .flatMap((roll) => roll.dice)
      .flatMap(({ die, results }) => results.map(({ value }) => `${die}:${String(value)}`))
      .join(' ');
    for (const page of [gmPage, rinPage]) {
      await expect(dice(page)).toHaveAttribute('data-results', expected);
      await expect(dice(page)).toHaveAttribute('data-state', 'settled', { timeout: 15_000 });
    }
    // Then they fade away.
    await expect(dice(gmPage)).toHaveAttribute('data-state', 'idle', { timeout: 15_000 });
  });

  await test.step('each member can hide the dice', async () => {
    await rinPage.getByRole('button', { name: 'Overlays' }).click();
    await expect(rinPage.locator(OVERLAY)).toHaveCount(0);
    await expect(gmPage.locator(OVERLAY)).toHaveCount(1);
  });

  for (const who of [gm, rin]) await who.context.close();
});
