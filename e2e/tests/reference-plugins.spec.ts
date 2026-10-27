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

/**
 * Everything the page receives over its sockets and from the API, as one buffer. Collab
 * frames are binary Yjs updates, in which strings are plain UTF-8.
 */
function recordTraffic(page: Page): () => Promise<Buffer> {
  const chunks: Buffer[] = [];
  const bodies: Promise<void>[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      chunks.push(typeof payload === 'string' ? Buffer.from(payload) : payload);
    });
  });
  page.on('response', (response) => {
    if (!new URL(response.url()).pathname.startsWith('/api/')) return;
    bodies.push(
      response.body().then(
        (body) => void chunks.push(body),
        () => undefined,
      ),
    );
  });
  return async () => {
    await Promise.all(bodies);
    return Buffer.concat(chunks);
  };
}

/**
 * The GM puts actors in an encounter and rolls the system's combat.json initiative
 * (T-0802): every combatant gets a number, and each roll is in the chat.
 */
async function rollsInitiative(
  page: Page,
  gm: SignedIn,
  tableId: string,
  combatants: object[],
  formula: string,
): Promise<string[]> {
  await post(gm, `/tables/${tableId}/encounter`);
  for (const combatant of combatants) {
    await post(gm, `/tables/${tableId}/encounter/combatants`, combatant);
  }
  await page.goto(`/tables/${tableId}`);
  await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
  const rows = page.getByRole('list', { name: 'Turn order' }).getByRole('listitem');
  await expect(rows).toHaveCount(combatants.length);
  await page.getByRole('button', { name: 'Roll initiative' }).click();
  await expect(page.getByRole('button', { name: 'Roll initiative' })).toBeHidden();
  for (const row of await rows.all()) await expect(row).toHaveText(/^-?\d+/);
  await expect(page.getByRole('log', { name: 'Messages' })).toContainText(formula);
  return rows.allTextContents();
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
  const received = recordTraffic(page);
  await openSheet(page, table.id, 'Ayla');
  const sheet = page.locator('[data-plugin="tiny-d20"]');
  let goblinId = '';

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

  await test.step('the /check command runs tiny-d20’s server code (T-0804)', async () => {
    const log = page.getByRole('log', { name: 'Messages' });
    const message = page.getByLabel('Message', { exact: true });
    await message.fill('/check');
    await message.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Use /check str or /check dex.');
    await page.getByLabel('Speak as').selectOption({ label: 'Ayla' });
    await message.fill('/check str');
    await message.press('Enter');
    await expect(log.getByText('Ayla: Strength check')).toBeVisible();
    await expect(log.getByText('1d20 + @derived.strMod → 1d20 + 3')).toBeVisible();
    await expect(message).toHaveValue('');
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

    // The GM edits the secret, then a public field. Once the public change shows on the
    // player's sheet, the secret edit would have arrived too if it were sent.
    await gmSheet.getByLabel('GM notes').fill('Hoards stolen gold');
    await gmSheet.getByRole('textbox', { name: 'Notes', exact: true }).fill('Met at the inn');
    await expect(sheet.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue(
      'Met at the inn',
    );
    await gmPage.close();
  });

  await test.step('the secret layer never reaches the player on the wire (FR-SHEET-04)', async () => {
    const traffic = await received();
    expect(traffic.includes('Met at the inn')).toBe(true);
    expect(traffic.includes('Secretly a dragon')).toBe(false);
    expect(traffic.includes('Hoards stolen gold')).toBe(false);
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
    goblinId = npc.id;
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

  await test.step('combat.json rolls initiative for the hero and the goblin (T-0802)', async () => {
    const combatPage = await gm.context.newPage();
    const order = await rollsInitiative(
      combatPage,
      gm,
      table.id,
      [{ actorId: actor.id }, { actorId: goblinId }],
      '1d20 + @derived.dexMod',
    );
    expect(order.join(' ')).toMatch(/Ayla/);
    expect(order.join(' ')).toMatch(/Goblin/);
  });

  await test.step('the GM imports the bestiary pack once (T-0803)', async () => {
    const gmPage = await gm.context.newPage();
    await gmPage.goto(`/tables/${table.id}/settings`);
    const importButton = gmPage.getByRole('button', { name: 'Import Bestiary' });
    await expect(gmPage.getByText('2 actors, 2 items · 0 in this table')).toBeVisible();
    await importButton.click();
    await expect(gmPage.getByText('Imported 4; 0 were already in the table.')).toBeVisible();
    await expect(gmPage.getByText('2 actors, 2 items · 4 in this table')).toBeVisible();
    await expect(importButton).toBeDisabled();
    await gmPage.getByRole('link', { name: 'Items' }).click();
    await expect(gmPage.getByRole('heading', { name: 'Greatclub' })).toBeVisible();
    await expect(gmPage.getByRole('heading', { name: 'Shortsword' })).toBeVisible();
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

  // sideBased: Brask rolls 1d6 + 2, at least 3, so the players' side acts first (T-0802).
  const order = await rollsInitiative(
    page,
    gm,
    table.id,
    [{ actorId: actor.id }, { name: 'Shade', initiative: 3 }],
    '1d6 + @wits',
  );
  expect(order.map((row) => row.replace(/^\d+/, '').slice(0, 5))).toEqual(['Brask', 'Shade']);
  await gm.context.close();
});
