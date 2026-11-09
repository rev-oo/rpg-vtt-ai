import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn } from './support/api.js';
import { installPlugin, packPlugin, setActorData } from './support/plugins.js';
import { showPanel } from './support/workspace.js';

// T-1605: the SRD 5.2 system, packed from plugins/ like an author would. A player's wizard
// gets its numbers from the class tables, copies a sword and a cantrip from the SRD pack,
// attacks, casts, spends a slot and takes a Long Rest through the plugin's server code.

const plugin = fileURLToPath(new URL('../../plugins/dnd5e-srd', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-dnd5e-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function openSheet(page: Page, tableId: string, name: string): Promise<void> {
  await page.goto(`/tables/${tableId}`);
  await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
  await page.getByRole('button', { name: `Open sheet: ${name}` }).click();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
}

test('an SRD wizard attacks, casts a cantrip and takes a Long Rest', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(gm, packPlugin(plugin, path.join(temp, 'dnd5e-srd.vttplugin')));
  await post(gm, '/plugins/dnd5e-srd/enable', { acknowledgeCode: true });
  const player = await createPlayer(browser, gm, 'mira', 'Mira');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Fifth Edition',
    systemId: 'dnd5e-srd',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);
  const { actor } = await post<{ actor: { id: string } }>(player, `/tables/${table.id}/actors`, {
    type: 'character',
    name: 'Elowen',
  });
  setActorData(actor.id, {
    class: 'class.wizard',
    level: 5,
    str: 16,
    dex: 14,
    con: 12,
    int: 16,
    hp: { value: 20, max: 27, temp: 0 },
  });

  const page = await player.context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSheet(page, table.id, 'Elowen');
  const sheet = page.locator('[data-plugin="dnd5e-srd"]');
  const log = page.getByRole('log', { name: 'Messages' });

  await test.step('the sheet derives the numbers of a level 5 wizard', async () => {
    await expect(sheet.getByRole('status', { name: 'Proficiency Bonus' })).toHaveText('+3');
    await expect(sheet.getByRole('status', { name: 'Armor Class' })).toHaveText('12');
    await expect(sheet.getByRole('status', { name: 'Hit Die (d)' })).toHaveText('6');
    await sheet.getByRole('tab', { name: 'Spells' }).click();
    await expect(sheet.getByRole('status', { name: 'Spell save DC' })).toHaveText('14');
    await expect(sheet.getByRole('status', { name: 'Spell attack bonus' })).toHaveText('+6');
    // From the class table, through the plugin's `slots` formula function.
    await expect(sheet.getByRole('status', { name: 'Level 1 slots', exact: true })).toHaveText('4');
    await expect(sheet.getByRole('status', { name: 'Level 3 slots', exact: true })).toHaveText('2');
    await expect(sheet.getByRole('status', { name: 'Level 4 slots', exact: true })).toBeHidden();
  });

  await test.step('the player copies a longsword and Fire Bolt from the SRD pack', async () => {
    await showPanel(page, 'Compendium');
    for (const name of ['Longsword', 'Fire Bolt']) {
      await page.getByRole('button', { name: `Copy ${name} onto the chosen actor` }).click();
      await expect(page.getByText(`${name} was copied onto Elowen.`)).toBeVisible();
    }
    await showPanel(page, 'Actors');
    await page.getByRole('button', { name: 'Open sheet: Elowen' }).click();
  });

  await test.step('one Attack button rolls the attack and its damage (T-1608)', async () => {
    await sheet.getByRole('tab', { name: 'Attacks' }).click();
    const sword = sheet.getByRole('listitem', { name: 'Longsword' });
    await sword.getByRole('button', { name: 'Attack' }).click();
    const card = log.locator('[data-plugin="dnd5e-srd"]').last();
    await expect(card.getByText('Weapon attack')).toBeVisible();
    await expect(card.locator('dd').nth(0)).toHaveText('Longsword');
    await expect(card.locator('dd').nth(1)).toContainText('1d20');
    // Only the branches the formula took, with their values (T-1607); a natural 20 doubles
    // the dice.
    await expect(card.locator('dd').nth(3)).toHaveText(/^[12]d8 \+ 3 slashing$/);
    await expect(card.getByRole('list', { name: /Dice of [12]d8/ })).toBeVisible();

    // Versatile: with two hands the longsword deals 1d10. Only versatile weapons ask.
    await sword.getByLabel('Two hands').check();
    await sword.getByRole('button', { name: 'Attack' }).click();
    const versatile = log.locator('[data-plugin="dnd5e-srd"]').last();
    await expect(versatile.locator('dd').nth(3)).toHaveText(/^[12]d10 \+ 3 slashing$/);
  });

  await test.step('a critical hit doubles every die, extra damage too', async () => {
    const sword = sheet.getByRole('listitem', { name: 'Longsword' });
    const extra = sword.getByRole('textbox', { name: 'Extra damage' });
    await extra.fill('1d6 + @str');
    await expect(sword.getByText('Enter dice, such as 2d6 + 3.')).toBeVisible();
    await extra.fill('1d6');
    await expect(sword.getByText('Enter dice, such as 2d6 + 3.')).toBeHidden();
    await extra.blur();

    // Improved Critical, taken to the limit: every attack is a critical hit.
    await sheet.getByRole('textbox', { name: 'Critical hit on' }).fill('1');
    await sword.getByRole('button', { name: 'Attack' }).click();
    const crit = log.locator('[data-plugin="dnd5e-srd"]').last();
    await expect(crit.getByText('Critical hit!')).toBeVisible();
    await expect(crit.locator('dd').nth(3)).toHaveText('2d10 + 3 + 2d6 slashing');
    await expect(crit.getByRole('list', { name: 'Dice of 2d6' })).toBeVisible();
  });

  await test.step('Fire Bolt rolls a spell attack, then 2d10 at level 5', async () => {
    await sheet.getByRole('tab', { name: 'Spells' }).click();
    const bolt = sheet.getByRole('listitem', { name: 'Fire Bolt' });
    await bolt.getByRole('button', { name: 'Cast' }).click();
    const cast = log.locator('[data-plugin="dnd5e-srd"]').last();
    await expect(cast.getByText('Spell', { exact: true }).first()).toBeVisible();
    await expect(cast.locator('dd').nth(0)).toHaveText('Fire Bolt');
    await expect(cast.locator('dd').nth(2)).toContainText('1d20');
    await expect(cast.locator('dd').nth(4)).toHaveText('—');

    await bolt.getByRole('button', { name: 'Effect' }).click();
    const effect = log.locator('[data-plugin="dnd5e-srd"]').last();
    await expect(effect.locator('dd').nth(2)).toContainText('2d10');
    await expect(effect.locator('dd').nth(5)).toHaveText('fire');
  });

  await test.step('a Long Rest restores Hit Points and spent slots', async () => {
    const spent = sheet.getByRole('textbox', { name: 'Level 1 slots spent' });
    await sheet.getByRole('button', { name: 'Increase Level 1 slots spent' }).click();
    await expect(spent).toHaveValue('1');
    await expect(sheet.getByRole('status', { name: 'Level 1 slots left' })).toHaveText('3');

    await sheet.getByRole('tab', { name: 'Main' }).click();
    await sheet.getByRole('button', { name: 'Long Rest' }).click();
    await expect(log.getByText('Elowen finishes a Long Rest')).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Hit Points', exact: true })).toHaveValue('27');
    await sheet.getByRole('tab', { name: 'Spells' }).click();
    await expect(spent).toHaveValue('0');
  });

  expect(errors).toEqual([]);
});
