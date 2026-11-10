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
// T-1609: d20 rolls ask for Advantage (or take Shift and Ctrl), and spells for their slot.
// T-1610: casting a spell spends its slot through the Cast roll's `then` server code.
// T-1616: a player who turns the asking off at the table rolls with a click.
// T-1611: a Portuguese player reads the sheet, cards and server messages in pt-BR.

const plugin = fileURLToPath(new URL('../../plugins/srd5', import.meta.url));

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
  await installPlugin(gm, packPlugin(plugin, path.join(temp, 'srd5.vttplugin')));
  await post(gm, '/plugins/srd5/enable', { acknowledgeCode: true });
  const player = await createPlayer(browser, gm, 'mira', 'Mira');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Fifth Edition',
    systemId: 'srd5',
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
  const sheet = page.locator('[data-plugin="srd5"]');
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
    for (const name of ['Longsword', 'Fire Bolt', 'Magic Missile']) {
      await page.getByRole('button', { name: `Copy ${name} onto the chosen actor` }).click();
      await expect(page.getByText(`${name} was copied onto Elowen.`)).toBeVisible();
    }
    // The SRD's credit shows beside each entry, linked to the SRD (T-1614).
    const longsword = page
      .getByRole('group', { name: 'Compendium entries' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Longsword', exact: true }) });
    await longsword.getByText('Preview').click();
    await expect(
      longsword.getByRole('link', { name: /material from the System Reference Document 5\.2/ }),
    ).toHaveAttribute('href', 'https://www.dndbeyond.com/srd');
    await showPanel(page, 'Actors');
    await page.getByRole('button', { name: 'Open sheet: Elowen' }).click();
    await sheet.getByRole('tab', { name: 'Main' }).click();
  });

  await test.step('one Attack button rolls the attack and its damage (T-1608)', async () => {
    await sheet.getByRole('tab', { name: 'Attacks' }).click();
    const sword = sheet.getByRole('listitem', { name: 'Longsword' });
    // Shift picks Advantage and rolls at once (T-1609).
    await sword.getByRole('button', { name: 'Attack' }).click({ modifiers: ['Shift'] });
    const card = log.locator('[data-plugin="srd5"]').last();
    await expect(card.getByText('Weapon attack')).toBeVisible();
    await expect(card.locator('dd').nth(0)).toHaveText('Longsword');
    await expect(card.locator('dd').nth(1)).toHaveText(/^2d20kh1 \+ \d+$/);
    // Only the branches the formula took, with their values (T-1607); a natural 20 doubles
    // the dice.
    await expect(card.locator('dd').nth(3)).toHaveText(/^[12]d8 \+ 3$/);
    // The damage type is a lang key the card translates (T-1611).
    await expect(card.locator('dd').nth(5)).toHaveText('Slashing');
    await expect(card.getByRole('list', { name: /Dice of [12]d8/ })).toBeVisible();

    // Versatile: with two hands the longsword deals 1d10. Only versatile weapons ask.
    await sword.getByLabel('Two hands').check();
    // Without a key the button asks, with Normal chosen (T-1609).
    await sword.getByRole('button', { name: 'Attack' }).click();
    const options = page.getByRole('dialog', { name: 'Attack' });
    await expect(options.getByRole('radio', { name: 'Normal' })).toBeChecked();
    await options.getByRole('button', { name: 'Roll' }).click();
    await expect(options).toBeHidden();
    const versatile = log.locator('[data-plugin="srd5"]').last();
    await expect(versatile.locator('dd').nth(3)).toHaveText(/^[12]d10 \+ 3$/);
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
    await sword.getByRole('button', { name: 'Attack' }).click({ modifiers: ['Control'] });
    const crit = log.locator('[data-plugin="srd5"]').last();
    await expect(crit.getByText('Critical hit!')).toBeVisible();
    await expect(crit.locator('dd').nth(3)).toHaveText('2d10 + 3 + 2d6');
    await expect(crit.getByRole('list', { name: 'Dice of 2d6' })).toBeVisible();
  });

  await test.step('Fire Bolt rolls a spell attack, then 2d10 at level 5', async () => {
    await sheet.getByRole('tab', { name: 'Spells' }).click();
    const bolt = sheet.getByRole('listitem', { name: 'Fire Bolt' });
    await bolt.getByRole('button', { name: 'Cast' }).click();
    await page.getByRole('dialog', { name: 'Cast' }).getByRole('button', { name: 'Roll' }).click();
    const cast = log.locator('[data-plugin="srd5"]').last();
    await expect(cast.getByText('Spell', { exact: true }).first()).toBeVisible();
    await expect(cast.locator('dd').nth(0)).toHaveText('Fire Bolt');
    await expect(cast.locator('dd').nth(2)).toContainText('1d20');
    await expect(cast.locator('dd').nth(4)).toHaveText('—');

    await bolt.getByRole('button', { name: 'Effect' }).click();
    await page
      .getByRole('dialog', { name: 'Spell effect' })
      .getByRole('button', { name: 'Roll' })
      .click();
    const effect = log.locator('[data-plugin="srd5"]').last();
    await expect(effect.locator('dd').nth(2)).toContainText('2d10');
    await expect(effect.locator('dd').nth(6)).toHaveText('Fire');
  });

  await test.step('Magic Missile cast with a level 3 slot fires two more darts (T-1609)', async () => {
    const missile = sheet.getByRole('listitem', { name: 'Magic Missile' });
    await missile.getByRole('button', { name: 'Effect' }).click();
    const options = page.getByRole('dialog', { name: 'Spell effect' });
    const slot = options.getByRole('spinbutton', { name: 'Spell slot level' });
    await expect(slot).toHaveValue('1');
    await slot.fill('0');
    await expect(options.getByText('Must be at least 1.')).toBeVisible();
    await slot.fill('3');
    await options.getByRole('button', { name: 'Roll' }).click();
    const effect = log.locator('[data-plugin="srd5"]').last();
    await expect(effect.locator('dd').nth(0)).toHaveText('Magic Missile');
    await expect(effect.locator('dd').nth(1)).toHaveText('3');
    await expect(effect.locator('dd').nth(2)).toHaveText('5d4 + 5');
  });

  const spent = sheet.getByRole('textbox', { name: 'Level 1 slots spent' });
  await test.step('casting Magic Missile spends a level 1 slot (T-1610)', async () => {
    await expect(spent).toHaveValue('0');
    const missile = sheet.getByRole('listitem', { name: 'Magic Missile' });
    await missile.getByRole('button', { name: 'Cast' }).click();
    const options = page.getByRole('dialog', { name: 'Cast' });
    await expect(options.getByRole('spinbutton', { name: 'Spell slot level' })).toHaveValue('1');
    await options.getByRole('button', { name: 'Roll' }).click();
    await expect(spent).toHaveValue('1');
    await expect(sheet.getByRole('status', { name: 'Level 1 slots left' })).toHaveText('3');
  });

  await test.step('a Long Rest restores Hit Points and spent slots', async () => {
    await sheet.getByRole('tab', { name: 'Main' }).click();
    await sheet.getByRole('button', { name: 'Long Rest' }).click();
    await expect(log.getByText('Elowen finishes a Long Rest')).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Hit Points', exact: true })).toHaveValue('27');
    await sheet.getByRole('tab', { name: 'Spells' }).click();
    await expect(spent).toHaveValue('0');
  });

  await test.step('without asking for options, a click rolls a Normal check (T-1616)', async () => {
    // The preference is the member's own, at this table.
    await showPanel(page, 'Members');
    const ask = page.getByRole('checkbox', { name: 'Ask for roll options' });
    await expect(ask).toBeChecked();
    await ask.uncheck();
    await expect(page.getByText('Roll buttons roll at once at this table')).toBeVisible();

    // Kept on the server. The page is not reloaded to show it: the change makes the page load
    // its lists again, and WebKit reports requests a reload cuts short as page errors.
    const response = await player.context.request.get(`/api/v1/tables/${table.id}`);
    const { table: kept } = (await response.json()) as { table: { askRollOptions: boolean } };
    expect(kept.askRollOptions).toBe(false);
    await page.getByRole('button', { name: 'Open sheet: Elowen' }).click();
    await sheet.getByRole('tab', { name: 'Main' }).click();
    const check = sheet.getByRole('button', { name: 'Strength check' });
    await expect(check).toHaveAttribute('title', 'Alt-click to choose the options.');
    await check.click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(log.getByText(/Strength check: 1d20 \+ 3 = \d+/)).toBeVisible();
  });

  expect(errors).toEqual([]);
});

test('a Portuguese player reads the SRD sheet, cards and rest messages in pt-BR', async ({
  browser,
}) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(gm, packPlugin(plugin, path.join(temp, 'srd5-pt.vttplugin')));
  await post(gm, '/plugins/srd5/enable', { acknowledgeCode: true });
  const player = await createPlayer(browser, gm, 'ana', 'Ana');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Quinta Edição',
    systemId: 'srd5',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);
  const { actor } = await post<{ actor: { id: string } }>(player, `/tables/${table.id}/actors`, {
    type: 'character',
    name: 'Lia',
  });
  setActorData(actor.id, {
    class: 'class.fighter',
    level: 3,
    str: 16,
    hp: { value: 10, max: 28, temp: 0 },
  });
  await post(player, `/tables/${table.id}/compendium/copy`, {
    refs: ['srd5:srd:longsword'],
    actorId: actor.id,
  });

  // The same account, in a Portuguese browser.
  const context = await browser.newContext({
    locale: 'pt-BR',
    storageState: await player.context.storageState(),
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/tables/${table.id}`);
  await expect(page.getByText(/Conectando|Reconectando/)).toBeHidden();
  await page.getByRole('button', { name: 'Abrir ficha: Lia' }).click();
  const sheet = page.locator('[data-plugin="srd5"]');
  const log = page.getByRole('log', { name: 'Mensagens' });

  await test.step('the sheet is in Portuguese, its values stored as they are', async () => {
    await expect(sheet.getByRole('status', { name: 'Bônus de Proficiência' })).toHaveText('+2');
    const klass = sheet.getByRole('combobox', { name: 'Classe' });
    await expect(klass).toHaveValue('class.fighter');
    await expect(klass.locator('option:checked')).toHaveText('Guerreiro');
  });

  await test.step('the attack card names its rows and damage type in Portuguese', async () => {
    await sheet.getByRole('tab', { name: 'Ataques' }).click();
    const sword = sheet.getByRole('listitem', { name: 'Longsword' });
    await sword.getByRole('button', { name: 'Atacar' }).click({ modifiers: ['Shift'] });
    const card = log.locator('[data-plugin="srd5"]').last();
    await expect(card.getByText('Ataque com arma')).toBeVisible();
    await expect(card.getByText('Tipo', { exact: true })).toBeVisible();
    await expect(card.locator('dd').nth(5)).toHaveText('Cortante');
  });

  await test.step("the server code's rest message is in Portuguese", async () => {
    await sheet.getByRole('tab', { name: 'Principal' }).click();
    await sheet.getByRole('button', { name: 'Descanso Longo' }).click();
    await expect(log.getByText('Lia termina um Descanso Longo')).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Pontos de Vida', exact: true })).toHaveValue(
      '28',
    );
  });

  expect(errors).toEqual([]);
  await context.close();
});
