import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, patch, post, signIn } from './support/api.js';
import { installPlugin, packPlugin } from './support/plugins.js';
import { showPanel } from './support/workspace.js';

// T-1604: the dice-3d module, packed from plugins/ like an author would, throws dice for each
// roll over the table page and lands them on the server's results. The chat shows the result
// at once, while the dice still roll; the viewer's Overlays switch hides them.

const plugin = fileURLToPath(new URL('../../plugins/dice-3d', import.meta.url));
const tinyPool = fileURLToPath(new URL('../../plugins/tiny-pool', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-dice-3d-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

interface Rolled {
  rolls: { dice: { die: string; results: { value: number; label?: string }[] }[] }[];
}

/**
 * What the dice should show on top for a roll: a d100 as its tens and units dice, a custom
 * die as its face's label.
 */
function tops(message: Rolled): string {
  return message.rolls
    .flatMap((roll) => roll.dice)
    .flatMap(({ die, results }) =>
      results.flatMap(({ value, label }) => {
        if (label !== undefined) return [label];
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
  // Each frame loads the frame page once.
  let frames = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/plugin-frame.html') frames += 1;
  });
  await page.goto(`/tables/${table.id}`);
  await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
  const frame = page.frameLocator('iframe[title="3D dice: dice"]');
  const dice = frame.locator('.dice-3d');
  await expect(dice).toHaveAttribute('data-state', 'idle');
  // The manifest declares the overlay, so the module's code runs only in it: no probe (T-1612).
  expect(frames).toBe(1);
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

  /** The one roll in a table's history. */
  const lastRoll = async (tableId: string): Promise<Rolled> => {
    const response = await gm.context.request.get(`/api/v1/tables/${tableId}/messages`);
    const { messages } = (await response.json()) as { messages: Rolled[] };
    const [roll] = messages.filter((message) => message.rolls.length > 0);
    if (!roll) throw new Error('the roll is not in the history');
    return roll;
  };

  await test.step("a system's custom die is thrown with its own faces (T-1612)", async () => {
    await installPlugin(gm, packPlugin(tinyPool, path.join(temp, 'tiny-pool.vttplugin')));
    await post(gm, '/plugins/tiny-pool/enable', { acknowledgeCode: true });
    const { table: pool } = await post<{ table: { id: string } }>(gm, '/tables', {
      name: 'Fate Table',
      systemId: 'tiny-pool',
    });
    await patch(gm, `/tables/${pool.id}`, { modules: ['dice-3d'] });
    const fate = await gm.context.newPage();
    await fate.goto(`/tables/${pool.id}`);
    await expect(fate.getByText(/Connecting|Reconnecting/)).toBeHidden();
    const thrown = fate.frameLocator('iframe[title="3D dice: dice"]').locator('.dice-3d');
    await expect(thrown).toHaveAttribute('data-state', 'idle');
    await type(fate, '/r 4dF');
    await expect(thrown).toHaveAttribute('data-state', 'resting', { timeout: 10_000 });
    const roll = await lastRoll(pool.id);
    expect(roll.rolls[0]?.dice[0]?.die).toBe('dF');
    await expect(thrown).toHaveAttribute('data-shown', tops(roll));
    await fate.close();
  });

  await test.step('turning the overlays off in the settings hides the dice', async () => {
    // The switch is among the member's own settings (T-1620).
    await showPanel(page, 'Settings');
    const overlays = page.getByRole('checkbox', { name: /overlays on this table/ });
    await overlays.uncheck();
    await expect(page.locator('iframe[title="3D dice: dice"]')).toHaveCount(0);
    await type(page, '/r 3d8');
    await expect(log.getByRole('list', { name: 'Dice of 3d8' })).toBeVisible();
    await expect(page.locator('iframe[title="3D dice: dice"]')).toHaveCount(0);
    // Turned back on, the overlay is back and waits for the next roll.
    await overlays.check();
    await expect(dice).toHaveAttribute('data-state', 'idle');
  });

  await gm.context.close();
});
