import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn, type SignedIn } from './support/api.js';
import { installPlugin, packPlugin, setActorData } from './support/plugins.js';

const reference = fileURLToPath(new URL('../../plugins/', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-reference-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

/** Packs a reference plugin with the CLI, installs and enables it (T-0410). */
async function setUp(admin: SignedIn, id: string): Promise<void> {
  await installPlugin(
    admin,
    packPlugin(path.join(reference, id), path.join(temp, `${id}.vttplugin`)),
  );
  await post(admin, `/plugins/${id}/enable`, { acknowledgeCode: true });
}

async function openSheet(page: Page, tableId: string, name: string): Promise<void> {
  await page.goto(`/tables/${tableId}`);
  await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
  await page.getByRole('link', { name: `Open sheet: ${name}` }).click();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
}

// T-0411: tiny-d20 uses types, derived values, a skills collection with a roll recipe and its
// card, a counter, `visibleIf`, tabs, a secret layer, a custom node, scoped CSS and lang files.
test('tiny-d20 renders its sheet, rolls skills and keeps GM notes secret', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await setUp(gm, 'tiny-d20');
  const player = await createPlayer(browser, gm, 'gwen', 'Gwen');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'D20 Table',
    systemId: 'tiny-d20',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);
  const { actor } = await post<{ actor: { id: string } }>(player, `/tables/${table.id}/actors`, {
    type: 'character',
    name: 'Ayla',
  });
  setActorData(actor.id, {
    level: 5,
    str: 16,
    hp: { value: 2, max: 12 },
    skills: { s1: { name: 'Climb', ability: 'str', rank: 4, sort: 'i' } },
    gmNotes: 'Secretly a dragon',
  });

  const page = await player.context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSheet(page, table.id, 'Ayla');
  const sheet = page.locator('[data-plugin="tiny-d20"]');

  await test.step('fields, defaults and derived values in the plugin language', async () => {
    await expect(sheet.getByLabel('Strength')).toHaveValue('16');
    await expect(sheet.getByLabel('Dexterity')).toHaveValue('10');
    await expect(sheet.getByRole('status', { name: 'Str mod' })).toHaveText('+3');
    await expect(sheet.getByRole('status', { name: 'Proficiency' })).toHaveText('+3');
    await expect(sheet.getByText('No image')).toBeVisible();
  });

  await test.step('hit points: counter, custom bar with scoped CSS, and visibleIf', async () => {
    await expect(sheet.getByRole('textbox', { name: 'Hit points', exact: true })).toHaveValue('2');
    const bar = sheet.getByRole('meter', { name: 'Hit points' });
    await expect(bar).toHaveAttribute('aria-valuenow', '2');
    await expect(bar).toHaveAttribute('aria-valuemax', '12');
    await expect(bar).toContainText('2 / 12');
    await expect(sheet.locator('.vitals')).toHaveCSS('flex-wrap', 'wrap');
    await expect(sheet.getByText('Unconscious')).toBeHidden();
  });

  await test.step('a skill roll posts the plugin card with an outcome', async () => {
    const row = sheet.locator('[data-row]').filter({ has: page.getByLabel('Skill') });
    await expect(row.getByLabel('Skill')).toHaveValue('Climb');
    await row.getByRole('button', { name: 'Roll' }).click();
    const log = page.getByRole('log', { name: 'Messages' });
    const card = log.locator('[data-plugin="tiny-d20"]').last();
    await expect(card.getByText('Skill check')).toBeVisible();
    await expect(card.getByText(/^(Success|Failure)$/)).toBeVisible();
    // The card's rows: the resolved roll, then the total.
    await expect(card.locator('dd').first()).toHaveText(/^1d20 \+ .+ \+ 4$/);
  });

  await test.step('players do not see the secret layer; the GM does', async () => {
    await sheet.getByRole('tab', { name: 'Notes' }).click();
    await expect(sheet.getByRole('textbox', { name: 'Notes', exact: true })).toBeVisible();
    await expect(sheet.getByLabel('GM notes')).toHaveCount(0);

    const gmPage = await gm.context.newPage();
    await openSheet(gmPage, table.id, 'Ayla');
    const gmSheet = gmPage.locator('[data-plugin="tiny-d20"]');
    await gmSheet.getByRole('tab', { name: 'Notes' }).click();
    await expect(gmSheet.getByLabel('GM notes')).toHaveValue('Secretly a dragon');
  });

  await test.step('at zero hit points the sheet says so', async () => {
    // Sheets are live (M5): the player edits the value in place.
    const hp = sheet.getByRole('textbox', { name: 'Hit points', exact: true });
    await hp.fill('0');
    await hp.blur();
    await expect(sheet.getByText('Unconscious')).toBeVisible();
    await expect(sheet.getByRole('meter', { name: 'Hit points' })).toHaveAttribute(
      'data-low',
      'true',
    );
  });

  await test.step('the NPC of the GM has its own sheet and attack roll', async () => {
    const { actor: npc } = await post<{ actor: { id: string } }>(gm, `/tables/${table.id}/actors`, {
      type: 'npc',
      name: 'Goblin',
    });
    setActorData(npc.id, { str: 8, gmNotes: 'Flees at 2 HP' });
    const gmPage = await gm.context.newPage();
    await openSheet(gmPage, table.id, 'Goblin');
    const npcSheet = gmPage.locator('[data-plugin="tiny-d20"]');
    await expect(npcSheet.getByLabel('GM notes')).toHaveValue('Flees at 2 HP');
    await npcSheet.getByRole('button', { name: 'Attack' }).click();
    const card = gmPage
      .getByRole('log', { name: 'Messages' })
      .locator('[data-plugin="tiny-d20"]')
      .last();
    await expect(card.locator('dd').first()).toHaveText(/^1d20 \+ -1$/);
  });

  expect(errors).toEqual([]);
  await gm.context.close();
  await player.context.close();
});

// T-0412: tiny-pool has no code; it rolls success-counting pools and its custom Fate die.
test('tiny-pool works without code', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await setUp(gm, 'tiny-pool');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Pool Table',
    systemId: 'tiny-pool',
  });
  const { actor } = await post<{ actor: { id: string } }>(gm, `/tables/${table.id}/actors`, {
    type: 'character',
    name: 'Brask',
  });
  setActorData(actor.id, { might: 3, wits: 2 });

  const page = await gm.context.newPage();
  await openSheet(page, table.id, 'Brask');
  const sheet = page.locator('[data-plugin="tiny-pool"]');
  await expect(sheet.getByRole('status', { name: 'Pool' })).toHaveText('5');
  await expect(sheet.getByRole('textbox', { name: 'Stress', exact: true })).toHaveValue('0');

  const log = page.getByRole('log', { name: 'Messages' });
  await sheet.getByRole('button', { name: 'Roll pool' }).click();
  await expect(
    log.getByText(/^Roll pool: 5d6cs>=5 = \d \((Great success|Success|Failure)\)$/),
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'Fate roll' }).click();
  await expect(log.getByText(/^Fate roll: 4dF \+ 3 = -?\d$/)).toBeVisible();
  await expect(log.getByRole('list', { name: 'Dice of 4dF' })).toBeVisible();
  await gm.context.close();
});
