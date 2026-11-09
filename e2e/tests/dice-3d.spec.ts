import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, patch, post, signIn } from './support/api.js';
import { installPlugin, packPlugin } from './support/plugins.js';

// T-1604: the dice-3d module, packed from plugins/ like an author would, throws dice for each
// roll over the table page and lands them on the server's results. The chat shows the result
// at once, while the dice still roll; the viewer's Overlays switch hides them.

const plugin = fileURLToPath(new URL('../../plugins/dice-3d', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-dice-3d-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

interface Rolled {
  rolls: { dice: { die: string; results: { value: number }[] }[] }[];
}

/** What the dice should show on top for a roll: a d100 as its tens and units dice. */
function tops(message: Rolled): string {
  return message.rolls
    .flatMap((roll) => roll.dice)
    .flatMap(({ die, results }) =>
      results.flatMap(({ value }) => {
        if (die !== 'd100') return [String(value)];
        const rest = value % 100;
        return [String(Math.floor(rest / 10) * 10).padStart(2, '0'), String(rest % 10)];
      }),
    )
    .join(' ');
}

test('3D dice land on the results the server rolled, and the viewer can hide them', async ({
  browser,
  browserName,
}) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(gm, packPlugin(plugin, path.join(temp, 'dice-3d.vttplugin')));
  await post(gm, '/plugins/dice-3d/enable', { acknowledgeCode: true });
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Dice Tower',
    systemId: 'e2e-system',
  });
  await patch(gm, `/tables/${table.id}`, { modules: ['dice-3d'] });

  const page = await gm.context.newPage();
  await page.goto(`/tables/${table.id}`);
  await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
  const frame = page.frameLocator('iframe[title="3D dice: dice"]');
  const dice = frame.locator('.dice-3d');
  await expect(dice).toHaveAttribute('data-state', 'idle');
  const log = page.getByRole('log', { name: 'Messages' });
  const type = async (current: Page, text: string): Promise<void> => {
    const input = current.getByLabel('Message', { exact: true });
    await input.fill(text);
    await input.press('Enter');
    await expect(input).toHaveValue('');
  };

  await test.step('a roll is in the chat at once, while its dice still roll', async () => {
    await type(page, '/r 2d20 + 1d100 + 1d6');
    await expect(log.getByRole('list', { name: 'Dice of 2d20' })).toBeVisible();
    // Throws take a few seconds; the chat did not wait for them.
    expect(await dice.getAttribute('data-state')).toBe('rolling');
    if (browserName === 'chromium') {
      await expect(dice).toHaveAttribute('data-drawing', 'true');
      await expect(frame.locator('canvas')).toBeVisible();
    }
  });

  await test.step("the dice land on the server's results, then leave", async () => {
    const response = await gm.context.request.get(`/api/v1/tables/${table.id}/messages`);
    const { messages } = (await response.json()) as { messages: Rolled[] };
    const rolled = messages.filter((message) => message.rolls.length > 0);
    expect(rolled).toHaveLength(1);
    const [roll] = rolled;
    if (!roll) throw new Error('the roll is not in the history');
    await expect(dice).toHaveAttribute('data-state', 'resting', { timeout: 10_000 });
    await expect(dice).toHaveAttribute('data-shown', tops(roll));
    await expect(dice).toHaveAttribute('data-state', 'idle', { timeout: 10_000 });
  });

  await test.step('the Overlays switch hides the dice', async () => {
    await page.getByRole('button', { name: 'Overlays' }).click();
    await expect(page.locator('iframe[title="3D dice: dice"]')).toHaveCount(0);
    await type(page, '/r 3d8');
    await expect(log.getByRole('list', { name: 'Dice of 3d8' })).toBeVisible();
    await expect(page.locator('iframe[title="3D dice: dice"]')).toHaveCount(0);
    // Turned back on, the overlay is back and waits for the next roll.
    await page.getByRole('button', { name: 'Overlays' }).click();
    await expect(dice).toHaveAttribute('data-state', 'idle');
  });

  await gm.context.close();
});
