import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, patch, post, signIn, type SignedIn } from './support/api.js';
import { installPlugin, packPlugin } from './support/plugins.js';

// T-1604 (study): the dice-3d module packs and installs like any plugin. A roll shows in the
// chat at once while the dice still roll; every viewer's dice land on the results the server
// decided, then fade; a player who turns the overlays off sees no dice.

const plugin = fileURLToPath(new URL('../../plugins/dice-3d', import.meta.url));

interface Message {
  id: string;
  rolls: { total: number; dice: { die: string; results: { value: number }[] }[] }[];
}

/** What each die shows on top, as the module prints it (see plugins/dice-3d/code/src/dice.ts). */
function shown(message: Message): string {
  const faces: string[] = [];
  const plain = (value: number, sides: number) =>
    sides >= 8 && (value === 6 || value === 9) ? `${String(value)}.` : String(value);
  for (const roll of message.rolls)
    for (const term of roll.dice) {
      const sides = Number(term.die.slice(1));
      for (const { value } of term.results) {
        if (sides === 100) {
          const tens = Math.floor((value % 100) / 10);
          faces.push(tens === 0 ? '00' : `${String(tens)}0`, plain(value % 10, 10));
        } else faces.push(plain(sides === 10 ? value % 10 : value, sides));
      }
    }
  return faces.join(' ');
}

test('3D dice land on the server results for every viewer, and can be turned off', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  // The module's code has its own dependencies (three.js, cannon-es), outside the workspace.
  const install = spawnSync(
    'pnpm',
    ['install', '--ignore-workspace', '--lockfile=false', '--prefer-offline', '--silent'],
    { cwd: path.join(plugin, 'code'), encoding: 'utf8' },
  );
  expect(install.status, install.stderr).toBe(0);
  const temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-dice-'));
  const archive = packPlugin(plugin, path.join(temp, 'dice-3d.vttplugin'));

  const gm = await signIn(browser, ADMIN);
  const tess = await createPlayer(browser, gm, 'tess', 'Tess');
  await installPlugin(gm, archive);
  await rm(temp, { recursive: true, force: true });
  await post(gm, '/plugins/dice-3d/enable', { acknowledgeCode: true });
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Dice Tower',
    systemId: 'e2e-system',
  });
  await patch(gm, `/tables/${table.id}`, { modules: ['dice-3d'] });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(tess, `/invites/${token}/accept`);

  const open = async (who: SignedIn): Promise<Page> => {
    const page = await who.context.newPage();
    await page.goto(`/tables/${table.id}`);
    await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
    return page;
  };
  const [gmPage, tessPage] = await Promise.all([open(gm), open(tess)]);
  const dice = (page: Page) =>
    page.frameLocator('iframe[title="3D dice: dice"]').locator('.dice-3d');
  for (const page of [gmPage, tessPage]) {
    // WebGL works in the sandboxed frame: the stage drew its canvas.
    await expect(dice(page)).toHaveAttribute('data-state', 'idle');
    await expect(dice(page).locator('canvas')).toHaveCount(1);
  }

  await test.step('the chat shows the roll at once, while the dice still roll', async () => {
    const input = gmPage.getByLabel('Message', { exact: true });
    await input.fill('/r 1d20 + 2d6 + 1d4 + 1d8 + 1d10 + 1d12 + 1d100');
    await input.press('Enter');
    await expect(
      gmPage.getByRole('log', { name: 'Messages' }).getByLabel(/^Total \d+$/),
    ).toBeVisible();
    await expect(dice(gmPage)).toHaveAttribute('data-state', 'rolling');
  });

  await test.step("every viewer's dice land on the server's results, then fade", async () => {
    const history = await gm.context.request.get(`/api/v1/tables/${table.id}/messages`);
    const { messages } = (await history.json()) as { messages: Message[] };
    const [rolled] = messages.filter((message) => message.rolls.length > 0);
    if (!rolled) throw new Error('The roll is not in the chat history');
    for (const page of [gmPage, tessPage]) {
      await expect(dice(page)).toHaveAttribute('data-state', 'landed', { timeout: 15_000 });
      await expect(dice(page)).toHaveAttribute('data-message', rolled.id);
      await expect(dice(page)).toHaveAttribute('data-shown', shown(rolled));
    }
    for (const page of [gmPage, tessPage])
      await expect(dice(page)).toHaveAttribute('data-state', 'idle', { timeout: 15_000 });
  });

  await test.step('a player who turns the overlays off sees no dice', async () => {
    await tessPage.getByRole('button', { name: 'Overlays' }).click();
    await expect(tessPage.locator('iframe[title="3D dice: dice"]')).toHaveCount(0);
    const input = gmPage.getByLabel('Message', { exact: true });
    await input.fill('/r 1d20');
    await input.press('Enter');
    await expect(dice(gmPage)).toHaveAttribute('data-state', 'rolling');
    await expect(
      tessPage.getByRole('log', { name: 'Messages' }).getByLabel(/^Total \d+$/),
    ).toHaveCount(2);
    await expect(tessPage.locator('iframe[title="3D dice: dice"]')).toHaveCount(0);
  });

  for (const who of [gm, tess]) await who.context.close();
});
