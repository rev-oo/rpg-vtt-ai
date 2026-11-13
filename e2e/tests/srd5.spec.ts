import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn } from './support/api.js';
import { installPlugin, packPlugin, setActorData, setItemData } from './support/plugins.js';
import { showPanel, showTokens, tokenList } from './support/workspace.js';

// T-1605: the SRD 5.2 system, packed from plugins/ like an author would. A player's wizard
// gets its numbers from the class tables, copies a sword and a cantrip from the SRD pack,
// attacks, casts, spends a slot and takes a Long Rest through the plugin's server code.
// T-1609: d20 rolls ask for Advantage (or take Shift and Ctrl), and spells for their slot.
// T-1610: casting a spell spends its slot through the Cast roll's `then` server code.
// T-1616: a player who turns the asking off at the table rolls with a click.
// T-1611: a Portuguese player reads the sheet, cards and server messages in pt-BR.
// T-1617: cards apply damage to the token selected on the map, and roll the save a spell asks for.
// T-1618: a condition set on a sheet shows on the actor's token.

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
      await page.getByLabel(`Actor to copy ${name} onto`).selectOption(actor.id);
      await page.getByRole('button', { name: `Copy ${name} onto the chosen actor` }).click();
      await expect(page.getByText(`${name} was copied onto Elowen.`)).toBeVisible();
    }
    // The SRD's credit shows on each entry's sheet, linked to the SRD (T-1614, T-1620).
    await page.getByRole('button', { name: 'Open compendium entry: Longsword' }).click();
    await expect(
      page
        .getByRole('tabpanel', { name: 'Longsword' })
        .getByRole('link', { name: /material from the System Reference Document 5\.2/ }),
    ).toHaveAttribute('href', 'https://www.dndbeyond.com/srd');
    await showPanel(page, 'Actors');
    await page.getByRole('button', { name: 'Open sheet: Elowen' }).click();
    await sheet.getByRole('tab', { name: 'Main' }).click();
  });

  /**
   * Rolls the damage from the last attack card (T-1617). Attacks here roll with Advantage, so
   * a natural 1, which misses and offers no damage, is rare.
   */
  const rollDamage = async () => {
    const cards = log.locator('[data-plugin="srd5"]');
    await expect(cards.last().getByText('Weapon attack')).toBeVisible();
    // The attack card by its place, as the damage card comes after it.
    const at = await cards.count();
    const attack = cards.nth(at - 1);
    // A card's actions look like the panels' buttons (T-1620).
    await expect(attack.getByRole('button', { name: 'Roll damage' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    await attack.getByRole('button', { name: 'Roll damage' }).click();
    await expect(attack.getByRole('status')).toHaveText('Rolled for Elowen.');
    const damage = cards.nth(at);
    await expect(damage.getByText('Weapon damage')).toBeVisible();
    return damage;
  };

  await test.step('the Attack button rolls the attack, and its card the damage (T-1608)', async () => {
    await sheet.getByRole('tab', { name: 'Attacks' }).click();
    const sword = sheet.getByRole('listitem', { name: 'Longsword' });
    // Shift picks Advantage and rolls at once (T-1609).
    await sword.getByRole('button', { name: 'Attack' }).click({ modifiers: ['Shift'] });
    const card = log.locator('[data-plugin="srd5"]').last();
    await expect(card.locator('dd').nth(0)).toHaveText('Longsword');
    await expect(card.locator('dd').nth(1)).toHaveText(/^2d20kh1 \+ \d+$/);
    const damage = await rollDamage();
    await expect(damage.locator('dd').nth(0)).toHaveText('Longsword');
    // Only the branches the formula took, with their values (T-1607); a critical hit doubles
    // the dice.
    await expect(damage.locator('dd').nth(1)).toHaveText(/^[12]d8 \+ 3$/);
    // The damage type is a lang key the card translates (T-1611).
    await expect(damage.locator('dd').nth(3)).toHaveText('Slashing');
    await expect(damage.getByRole('list', { name: /Dice of [12]d8/ })).toBeVisible();

    // Versatile: with two hands the longsword deals 1d10. Only versatile weapons ask.
    await sword.getByLabel('Two hands').check();
    // Without a key the button asks, with Normal chosen (T-1609).
    await sword.getByRole('button', { name: 'Attack' }).click();
    const options = page.getByRole('dialog', { name: 'Attack' });
    await expect(options.getByRole('radio', { name: 'Normal' })).toBeChecked();
    await options.getByRole('radio', { name: 'Advantage', exact: true }).check();
    await options.getByRole('button', { name: 'Roll' }).click();
    await expect(options).toBeHidden();
    const versatile = await rollDamage();
    await expect(versatile.locator('dd').nth(1)).toHaveText(/^[12]d10 \+ 3$/);
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
    await sword.getByRole('button', { name: 'Attack' }).click({ modifiers: ['Shift'] });
    await expect(
      log.locator('[data-plugin="srd5"]').last().getByText('Critical hit!'),
    ).toBeVisible();
    const crit = await rollDamage();
    await expect(crit.getByText('Critical hit!')).toBeVisible();
    await expect(crit.locator('dd').nth(1)).toHaveText('2d10 + 3 + 2d6');
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
    const attack = log.locator('[data-plugin="srd5"]').last();
    await expect(attack.getByText('Ataque com arma')).toBeVisible();
    // Advantage makes a natural 1, which offers no damage, rare.
    await attack.getByRole('button', { name: 'Rolar dano' }).click();
    const card = log.locator('[data-plugin="srd5"]').last();
    await expect(card.getByText('Dano da arma')).toBeVisible();
    await expect(card.getByText('Tipo', { exact: true })).toBeVisible();
    await expect(card.locator('dd').nth(3)).toHaveText('Cortante');
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

test('cards roll damage for the attacker, apply it to the selected token and roll the save a spell asks for', async ({
  browser,
}) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(gm, packPlugin(plugin, path.join(temp, 'srd5-actions.vttplugin')));
  await post(gm, '/plugins/srd5/enable', { acknowledgeCode: true });
  const player = await createPlayer(browser, gm, 'tamsin', 'Tamsin');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Card Actions',
    systemId: 'srd5',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);
  const { actor: elowen } = await post<{ actor: { id: string } }>(
    player,
    `/tables/${table.id}/actors`,
    { type: 'character', name: 'Elowen' },
  );
  setActorData(elowen.id, {
    class: 'class.wizard',
    level: 5,
    int: 16,
    hp: { value: 20, max: 27, temp: 0 },
  });
  const { actor: goblin } = await post<{ actor: { id: string } }>(
    gm,
    `/tables/${table.id}/actors`,
    {
      type: 'npc',
      name: 'Goblin',
    },
  );
  setActorData(goblin.id, {
    hp: { value: 7, max: 7 },
    actions: {
      a1: {
        name: 'Scimitar',
        bonus: 4,
        dice: 1,
        die: 6,
        damageBonus: 2,
        damageType: 'slashing',
        extraDamage: '',
        sort: 'a0',
      },
    },
  });
  // A save spell the wizard holds.
  const { item: library } = await post<{ item: { id: string } }>(gm, `/tables/${table.id}/items`, {
    type: 'spell',
    name: 'Burning Hands',
  });
  const { item: spell } = await post<{ item: { id: string } }>(
    player,
    `/actors/${elowen.id}/items`,
    { itemId: library.id },
  );
  setItemData(spell.id, {
    level: 1,
    attack: 'spell.save',
    save: 'ability.dex',
    dice: 3,
    die: 6,
    effectType: 'fire',
  });
  const { scene } = await post<{ scene: { id: string } }>(gm, `/tables/${table.id}/scenes`, {
    name: 'Ambush',
    columns: 8,
    rows: 6,
  });
  await post(gm, `/tables/${table.id}/scenes/active`, { sceneId: scene.id });
  await post(gm, `/scenes/${scene.id}/tokens`, { actorId: elowen.id, column: 1, row: 1 });
  await post(gm, `/scenes/${scene.id}/tokens`, { actorId: goblin.id, column: 4, row: 2 });

  const open = async (who: typeof gm): Promise<Page> => {
    const page = await who.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/tables/${table.id}`);
    await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
    await expect(page.getByRole('application', { name: 'Ambush' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await showTokens(page);
    return page;
  };
  const gmPage = await open(gm);
  const playerPage = await open(player);
  const errors: string[] = [];
  for (const page of [gmPage, playerPage])
    page.on('pageerror', (error) => errors.push(error.message));
  const tokens = tokenList;
  const cards = (page: Page) =>
    page.getByRole('log', { name: 'Messages' }).locator('[data-plugin="srd5"]');

  await test.step('the GM rolls a goblin’s damage, which the player takes on their token', async () => {
    // A natural 1 misses and offers no damage, so roll until the goblin does not fumble.
    for (let tries = 0; tries < 20; tries += 1) {
      const { message } = await post<{ message: { card: { card: { actions: unknown[] } } } }>(
        gm,
        `/tables/${table.id}/rolls`,
        { actorId: goblin.id, recipe: { name: 'npcAttack', args: { id: 'a1' } } },
      );
      if (message.card.card.actions.length > 0) break;
    }
    const rollDamage = (scope: Page | Locator) =>
      scope.getByRole('button', { name: 'Roll damage' });
    const attack = cards(gmPage)
      .filter({ has: rollDamage(gmPage) })
      .last();
    // Only those who may roll for the goblin see its damage button.
    await expect(cards(playerPage).filter({ hasText: 'Scimitar' }).last()).toBeVisible();
    await expect(rollDamage(playerPage)).toHaveCount(0);
    await rollDamage(attack).click();
    await expect(attack.getByRole('status')).toHaveText('Rolled for Goblin.');

    const damage = cards(playerPage)
      .filter({ has: playerPage.getByRole('button', { name: 'Apply damage' }) })
      .last();
    await expect(damage.getByText('Select a token on the map to use these.')).toBeVisible();
    await expect(damage.getByRole('button', { name: 'Apply damage' })).toBeDisabled();
    await (await tokens(playerPage)).getByRole('button', { name: /^Elowen/ }).click();
    await expect(damage.getByText('Acts on Elowen')).toBeVisible();
    await damage.getByRole('button', { name: 'Apply damage' }).click();
    // 20 hit points less 1d6 + 2.
    await expect(damage.getByRole('status')).toHaveText(/^Done: Elowen is now at 1[2-7]\.$/);
  });

  await test.step('the GM rolls the goblin’s save from the spell card, then applies half', async () => {
    await post(player, `/tables/${table.id}/rolls`, {
      actorId: elowen.id,
      recipe: { name: 'spellEffect', args: {}, itemId: spell.id },
    });
    const card = cards(gmPage).filter({ hasText: 'Burning Hands' });
    await (await tokens(gmPage)).getByRole('button', { name: /^Goblin/ }).click();
    await expect(card.getByText('Acts on Goblin')).toBeVisible();
    await card.getByRole('button', { name: 'Roll saving throw' }).click();
    const save = cards(gmPage).filter({ hasText: 'Saving throw' }).last();
    await expect(save.getByText(/^(Success|Failure)$/)).toBeVisible();
    // Intelligence 16 and a Proficiency Bonus of 3: DC 14.
    await expect(save.locator('dd').nth(0)).toHaveText('Dexterity');
    await expect(save.locator('dd').nth(1)).toHaveText('14');
    await card.getByRole('button', { name: 'Apply half damage' }).click();
    await expect(card.getByRole('status')).toHaveText(/^Done: Goblin is now at \d\.$/);
  });

  expect(errors).toEqual([]);
});

test('a condition set on a sheet shows on the token', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(gm, packPlugin(plugin, path.join(temp, 'srd5-statuses.vttplugin')));
  await post(gm, '/plugins/srd5/enable', { acknowledgeCode: true });
  const player = await createPlayer(browser, gm, 'ysolde', 'Ysolde');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Statuses',
    systemId: 'srd5',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);
  const { actor: mira } = await post<{ actor: { id: string } }>(
    player,
    `/tables/${table.id}/actors`,
    { type: 'character', name: 'Mira' },
  );
  const { scene } = await post<{ scene: { id: string } }>(gm, `/tables/${table.id}/scenes`, {
    name: 'Crossroads',
    columns: 6,
    rows: 4,
  });
  await post(gm, `/tables/${table.id}/scenes/active`, { sceneId: scene.id });
  await post(gm, `/scenes/${scene.id}/tokens`, { actorId: mira.id, column: 2, row: 1 });

  const gmPage = await gm.context.newPage();
  await gmPage.goto(`/tables/${table.id}`);
  await expect(gmPage.getByText(/Connecting|Reconnecting/)).toBeHidden();
  const miraToken = async () =>
    (await tokenList(gmPage)).getByRole('button', {
      name: /^Mira/,
    });
  await expect(await miraToken()).toBeVisible();
  await expect((await miraToken()).getByRole('img')).toHaveCount(0);

  const page = await player.context.newPage();
  const errors: string[] = [];
  for (const each of [gmPage, page]) each.on('pageerror', (error) => errors.push(error.message));
  await openSheet(page, table.id, 'Mira');
  const sheet = page.locator('[data-plugin="srd5"]');
  await sheet.getByRole('tab', { name: 'Features' }).click();
  const prone = sheet.getByRole('checkbox', { name: 'Prone' });
  await prone.check();
  // The GM's map follows the sheet once it is stored.
  await expect((await miraToken()).getByRole('img', { name: 'Prone' })).toBeVisible();
  await expect(await miraToken()).toHaveAccessibleName(/^Mira \(3, 2\) Prone$/);
  await sheet.getByRole('checkbox', { name: 'Poisoned' }).check();
  await expect((await miraToken()).getByRole('img')).toHaveCount(2);
  await prone.uncheck();
  await expect((await miraToken()).getByRole('img', { name: 'Prone' })).toHaveCount(0);
  await expect((await miraToken()).getByRole('img', { name: 'Poisoned' })).toBeVisible();

  expect(errors).toEqual([]);
});
