import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn, type SignedIn } from './support/api.js';
import { installPlugin, packPlugin, setActorData } from './support/plugins.js';
import { showPanel } from './support/workspace.js';

/** A 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
  await page.getByRole('button', { name: `Open sheet: ${name}` }).click();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
}

// T-1208 (FR-SHEET-12, FR-PLUGIN-15, ADR-063): tiny-d20's inventory. Equipped armour adds to
// AC, prepared spells are counted, and a weapon's row attacks with that weapon.
test('tiny-d20 equips armour, prepares a spell and attacks with a weapon', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await setUp(gm, 'tiny-d20');
  const player = await createPlayer(browser, gm, 'hana', 'Hana');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'D20 Inventory',
    systemId: 'tiny-d20',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);
  const { actor } = await post<{ actor: { id: string } }>(player, `/tables/${table.id}/actors`, {
    type: 'character',
    name: 'Brann',
  });
  setActorData(actor.id, { str: 16, dex: 14 });
  // New items take their type's defaults: AC +1 and 1d6 damage.
  const library = [
    { type: 'armor', name: 'Chain mail' },
    { type: 'weapon', name: 'Longsword' },
    { type: 'spell', name: 'Spark' },
  ];
  for (const item of library) await post(gm, `/tables/${table.id}/items`, item);

  const page = await player.context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSheet(page, table.id, 'Brann');
  const sheet = page.locator('[data-plugin="tiny-d20"]');
  const add = async (name: string, button: string) => {
    await sheet.getByLabel('Item from the library').selectOption({ label: name });
    await sheet.getByRole('button', { name: button }).click();
    const row = sheet.getByRole('listitem', { name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(name);
    return row;
  };

  await test.step('equipped armour raises AC', async () => {
    const ac = sheet.getByRole('status', { name: 'Armour class' });
    await expect(ac).toHaveText('12');
    await sheet.getByRole('tab', { name: 'Gear' }).click();
    const armour = await add('Chain mail', 'Add gear');
    await expect(ac).toHaveText('12');
    await armour.getByLabel('Equipped').check();
    await expect(ac).toHaveText('13');
    await armour.getByLabel('AC bonus').fill('4');
    await expect(ac).toHaveText('16');
  });

  await test.step('a weapon row attacks with the weapon', async () => {
    const sword = await add('Longsword', 'Add gear');
    await sword.getByRole('button', { name: 'Attack' }).click();
    const card = page.getByRole('log', { name: 'Messages' }).locator('[data-plugin="tiny-d20"]');
    await expect(card.getByText('Attack', { exact: true })).toBeVisible();
    // The card's rows: the weapon, the resolved roll, the total and the weapon's damage.
    await expect(card.locator('dd').nth(0)).toHaveText('Longsword');
    await expect(card.locator('dd').nth(1)).toHaveText('1d20 + 3 + 0');
    await expect(card.locator('dd').nth(3)).toHaveText('1d6');
  });

  await test.step('preparing a spell counts it', async () => {
    await sheet.getByRole('tab', { name: 'Spells' }).click();
    const prepared = sheet.getByRole('status', { name: 'Prepared spells' });
    await expect(prepared).toHaveText('0');
    const spark = await add('Spark', 'Add spell');
    await spark.getByLabel('Prepared').check();
    await expect(prepared).toHaveText('1');
  });

  expect(errors).toEqual([]);
});

// T-0411: tiny-d20 uses types, derived values, a skills collection with a roll recipe and its
// card, a counter, `visibleIf`, tabs, a secret layer, a custom node, scoped CSS and lang files.
// ADR-065: tiny-d20's portrait is an image field; its box picks one of the table's images,
// and the image then counts as used, even before the sheet is saved.
test("tiny-d20's portrait is set from the table's images", async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await setUp(gm, 'tiny-d20');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'D20 Portraits',
    systemId: 'tiny-d20',
  });
  await post(gm, `/tables/${table.id}/actors`, { type: 'character', name: 'Ysolde' });
  const upload = await gm.context.request.post(
    `/api/v1/tables/${table.id}/assets?name=ysolde.png`,
    {
      data: PNG,
      headers: { 'x-csrf-token': gm.csrf, 'content-type': 'image/png' },
    },
  );
  expect(upload.status()).toBe(201);
  const { asset } = (await upload.json()) as { asset: { url: string } };

  const page = await gm.context.newPage();
  await openSheet(page, table.id, 'Ysolde');
  const sheet = page.locator('[data-plugin="tiny-d20"]');
  const portrait = sheet.getByRole('button', { name: 'Choose image' });
  await expect(portrait).toContainText('Choose image');
  await portrait.click();
  await page
    .getByRole('dialog', { name: 'Choose an image' })
    .getByRole('button', { name: 'Use ysolde.png' })
    .click();
  const picture = sheet.getByRole('button', { name: 'Change image' }).locator('img');
  await expect(picture).toHaveAttribute('src', asset.url);
  await expect(picture).toHaveJSProperty('naturalWidth', 1);

  // The sheet is still open, so the portrait may not be saved yet: it counts all the same.
  const refused = await gm.context.request.delete(asset.url, {
    headers: { 'x-csrf-token': gm.csrf },
  });
  expect(refused.status()).toBe(409);
});

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
    // The portrait field is empty; editors pick one from its box (ADR-065).
    await expect(sheet.getByRole('button', { name: 'Choose image' })).toBeVisible();
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
    // dockview keeps an empty alert region of its own (ADR-059).
    await expect(page.getByRole('alert').filter({ hasText: /./ })).toHaveText(
      'Use /check str or /check dex.',
    );
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

  await test.step('a player copies a pack item onto their character (T-1202)', async () => {
    await showPanel(page, 'Compendium');
    const entries = page.getByRole('group', { name: 'Compendium entries' });
    await expect(entries.getByRole('heading', { name: 'Greatclub' })).toBeVisible();
    // Players browse every entry but copy nothing into the table.
    await expect(page.getByRole('button', { name: /to the table$/ })).toHaveCount(0);
    await expect(page.getByLabel('Actor to copy Shortsword onto')).toHaveValue(actor.id);
    await page.getByRole('button', { name: 'Copy Shortsword onto the chosen actor' }).click();
    await expect(page.getByText('Shortsword was copied onto Ayla.')).toBeVisible();
    const owned = await player.context.request.get(`/api/v1/actors/${actor.id}/items`);
    expect(((await owned.json()) as { items: { name: string }[] }).items).toEqual([
      expect.objectContaining({ name: 'Shortsword' }),
    ]);
  });

  await test.step('spells sit under "Spells" in the compendium and on the character (T-1203)', async () => {
    const spells = page.getByRole('list', { name: 'Spells' });
    await expect(spells.getByRole('heading')).toHaveText(['Mend', 'Spark']);
    await expect(page.getByRole('list', { name: 'Gear' })).toContainText('Shortsword');
    await page.getByRole('button', { name: 'Copy Spark onto the chosen actor' }).click();
    await expect(page.getByText('Spark was copied onto Ayla.')).toBeVisible();

    await showPanel(page, 'Actors');
    const ayla = page
      .getByRole('list', { name: 'Actors' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Ayla', exact: true }) })
      .first();
    await ayla.getByText('Items', { exact: true }).click();
    const owned = page.getByRole('group', { name: 'Items of Ayla' });
    await expect(owned.getByRole('heading')).toHaveText(['Gear', 'Spells']);
    await expect(owned.getByRole('list', { name: 'Spells' })).toContainText('Spark (spell)');
  });

  await test.step('the GM previews a pack actor and copies it into the table (T-1202)', async () => {
    const gmPage = await gm.context.newPage();
    await gmPage.goto(`/tables/${table.id}`);
    await showPanel(gmPage, 'Compendium');
    const entries = gmPage.getByRole('group', { name: 'Compendium entries' });
    const ogre = entries.getByRole('listitem').filter({
      has: gmPage.getByRole('heading', { name: 'Ogre' }),
    });
    await ogre.getByText('Preview').click();
    // GMs see the entry's secret field in the preview.
    await expect(ogre.getByText('Hates bright light.')).toBeVisible();
    await gmPage.getByRole('button', { name: 'Copy Ogre to the table' }).click();
    await expect(gmPage.getByText('Ogre was copied to the table.')).toBeVisible();
    await expect(ogre).toContainText('In the table');
    await gmPage.getByRole('tab', { name: 'Actors' }).click();
    await expect(
      gmPage.getByRole('list', { name: 'Actors' }).getByRole('heading', { name: 'Ogre' }),
    ).toBeVisible();

    // A spell copied into the table sits under "Spells" in the items panel (T-1203).
    await showPanel(gmPage, 'Compendium');
    await gmPage.getByRole('button', { name: 'Copy Mend to the table' }).click();
    await expect(gmPage.getByText('Mend was copied to the table.')).toBeVisible();
    await gmPage.getByRole('tab', { name: 'Items' }).click();
    const library = gmPage.getByRole('group', { name: 'Items' });
    await expect(library.getByRole('list', { name: 'Spells' })).toContainText('Mend');
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
