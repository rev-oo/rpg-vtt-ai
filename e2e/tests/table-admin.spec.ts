import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { ADMIN, createPlayer, patch, post, signIn, type SignedIn } from './support/api.js';
import { installPlugin, packPlugin, setActorData } from './support/plugins.js';
import { openSheet, showPanel } from './support/workspace.js';

const reference = fileURLToPath(new URL('../../plugins/', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-m6-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

/** Opens the table, and then one of its panels. */
async function openTab(who: SignedIn, tableId: string, panel?: string): Promise<Page> {
  const page = await who.context.newPage();
  await page.goto(`/tables/${tableId}`);
  await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();
  if (panel) await showPanel(page, panel);
  return page;
}

const memberRow = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Members' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

// T-0602: the GM invites with a link, changes a role and removes a member (FR-TABLE-03, 04).
// T-0604: with the invite policy, the same kind of link signs a new account up (FR-ADMIN-01).
test('members, invite links and sign-up', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const erin = await createPlayer(browser, gm, 'iris', 'Iris');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Guild Table',
    systemId: 'e2e-system',
  });
  const gmPage = await openTab(gm, table.id, 'Members');
  const invites = gmPage.getByRole('list', { name: 'Invite links' });

  let lastLink = '';
  const createLink = async (role: string): Promise<string> => {
    await gmPage.getByLabel('Joins as').selectOption({ label: role });
    await gmPage.getByRole('button', { name: 'Create link' }).click();
    const link = gmPage.getByLabel('New invite link');
    // Wait for the new link: the box still shows the previous one until the server answers.
    await expect(link).toHaveValue(/\/invite\//);
    await expect(link).not.toHaveValue(lastLink);
    lastLink = await link.inputValue();
    return new URL(lastLink).pathname;
  };

  await test.step('a member joins through an invite link (FR-TABLE-03)', async () => {
    const link = await createLink('Player');
    await expect(invites.getByRole('listitem')).toHaveCount(1);
    await expect(invites).toContainText('Active');

    const page = await erin.context.newPage();
    await page.goto(link);
    await expect(page.getByText('You are invited to join Guild Table as Player.')).toBeVisible();
    await page.getByRole('button', { name: 'Join the table' }).click();
    await expect(page.getByRole('heading', { name: 'Guild Table' })).toBeVisible();
    await page.close();
  });

  await test.step('a revoked link no longer works (FR-TABLE-03)', async () => {
    const link = await createLink('Spectator');
    const row = invites.getByRole('listitem').filter({ hasText: 'Spectator' });
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(row).toContainText('Revoked');

    const page = await erin.context.newPage();
    await page.goto(link);
    await expect(page.getByText('This invite link has been revoked.')).toBeVisible();
    await page.close();
  });

  await test.step('the GM changes a role and removes a member (FR-TABLE-04)', async () => {
    await gmPage.reload();
    await memberRow(gmPage, 'Iris').getByLabel('Role').selectOption({ label: 'Spectator' });
    // dockview's own status region narrates panels opening (ADR-059).
    await expect(gmPage.getByRole('tabpanel', { name: 'Members' }).getByRole('status')).toHaveText(
      'Iris is now Spectator.',
    );

    const erinPage = await openTab(erin, table.id, 'Members');
    await expect(memberRow(erinPage, 'Iris (you)')).toContainText('Spectator');
    await expect(erinPage.getByRole('list', { name: 'Invite links' })).toHaveCount(0);

    await memberRow(gmPage, 'Iris').getByRole('button', { name: 'Remove' }).click();
    await expect(memberRow(gmPage, 'Iris')).toHaveCount(0);
    await erinPage.reload();
    await expect(
      erinPage.getByText('This table does not exist, or you are not a member.'),
    ).toBeVisible();
  });

  await test.step('with the invite policy, a link signs a new account up (FR-ADMIN-01)', async () => {
    const admin = await gm.context.newPage();
    await admin.goto('/admin/settings');
    await admin.getByLabel('Site name').fill('Guild Hall');
    await admin
      .getByLabel('Who can create accounts')
      .selectOption({ label: 'Admins, and anyone with a table invite link' });
    await admin.getByRole('button', { name: 'Save' }).click();
    await expect(admin.getByText('The instance settings were saved.')).toBeVisible();
    await expect(admin.getByRole('banner')).toContainText('Guild Hall');

    const link = await createLink('Player');
    const stranger = await browser.newContext();
    const page = await stranger.newPage();
    await page.goto(link);
    await expect(page.getByText('You are invited to join Guild Table as Player.')).toBeVisible();
    await page.getByLabel('Username').fill('newcomer');
    await page.getByLabel('Display name').fill('Newcomer');
    await page.getByLabel('Password').fill('newcomer-password-1');
    await page.getByRole('button', { name: 'Create account and join' }).click();
    await expect(page.getByRole('heading', { name: 'Guild Table' })).toBeVisible();

    await patch(gm, '/admin/settings', { siteName: 'VTT', registration: 'closed' });
    await stranger.close();
  });
});

// FR-JOURNAL-01..03: entries start hidden; the GM reveals one and players read its body.
test('journal entries are hidden until the GM reveals them', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const finn = await createPlayer(browser, gm, 'jonas', 'Jonas');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Journal Table',
    systemId: 'e2e-system',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(finn, `/invites/${token}/accept`);

  const gmPage = await openTab(gm, table.id, 'Journal');
  const finnPage = await openTab(finn, table.id, 'Journal');
  const entry = (page: Page) =>
    page
      .getByRole('list', { name: 'Journal' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'The Old Mill' }) });

  await gmPage.getByRole('button', { name: 'New entry' }).click();
  const dialog = gmPage.getByRole('dialog', { name: 'New entry' });
  await dialog.getByLabel('Title').fill('The Old Mill');
  await dialog.getByRole('button', { name: 'Create entry' }).click();
  await expect(entry(gmPage)).toContainText('Hidden from players');
  await expect(finnPage.getByText('The journal is empty.')).toBeVisible();

  await entry(gmPage).getByRole('button', { name: 'Open: The Old Mill' }).click();
  const body = gmPage.getByRole('textbox', { name: 'The Old Mill' });
  await body.click();
  await gmPage.keyboard.type('The miller hides a map.');
  // The entry opens as its own panel beside the list, which offers the same actions.
  const entryPanel = gmPage.getByRole('tabpanel', { name: 'The Old Mill' });
  await entryPanel.getByRole('button', { name: 'Reveal to players' }).click();
  await expect(gmPage.getByText('Players cannot see this entry.', { exact: false })).toBeHidden();

  // The reveal reaches the player's open list (FR-ENT-07).
  await expect(entry(finnPage)).toBeVisible();
  await entry(finnPage).getByRole('button', { name: 'Open: The Old Mill' }).click();
  const read = finnPage.getByRole('textbox', { name: 'The Old Mill' });
  await expect(read).toHaveText('The miller hides a map.');
  await expect(read).toHaveAttribute('contenteditable', 'false');
  await expect(finnPage.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);

  // Hidden again, it leaves the player's screen.
  await entryPanel.getByRole('button', { name: 'Hide from players' }).click();
  await expect(
    finnPage.getByText('This entry does not exist, or you cannot see it.').first(),
  ).toBeVisible();
});

// T-0603: the GM changes a house rule; an open sheet's derived value follows (FR-ADMIN-04).
test('house rules change derived values on open sheets', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(
    gm,
    packPlugin(path.join(reference, 'tiny-d20'), path.join(temp, 'tiny-d20.vttplugin')),
  );
  await post(gm, '/plugins/tiny-d20/enable', { acknowledgeCode: true });
  const gwen = await createPlayer(browser, gm, 'kira', 'Kira');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Rules Table',
    systemId: 'tiny-d20',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(gwen, `/invites/${token}/accept`);
  const { actor } = await post<{ actor: { id: string } }>(gwen, `/tables/${table.id}/actors`, {
    type: 'character',
    name: 'Ayla',
  });
  setActorData(actor.id, { level: 3 });

  const sheet = await openTab(gwen, table.id);
  await openSheet(sheet, 'Ayla');
  const maxHp = sheet.getByRole('status', { name: 'Max HP by the rules' });
  // startingHp (default 10) + level - 1.
  await expect(maxHp).toHaveText('12');

  const settings = await openTab(gm, table.id, 'Settings');
  await expect(settings.getByRole('heading', { name: 'House rules of Tiny D20' })).toBeVisible();
  const startingHp = settings.getByLabel('Starting hit points');
  await expect(startingHp).toHaveValue('10');
  await startingHp.fill('0');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings.getByText('Must be at least 1.')).toBeVisible();

  await startingHp.fill('20');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings.getByText('The settings were saved.')).toBeVisible();
  await expect(maxHp).toHaveText('22');
});

// T-0807 (FR-TABLE-06): archiving makes the table read-only for its members at once, and
// the table list marks it.
test('an archived table is read-only until unarchived', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  const pia = await createPlayer(browser, gm, 'rowan', 'Rowan');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Old Campaign',
    systemId: 'e2e-system',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(pia, `/invites/${token}/accept`);

  const page = await openTab(pia, table.id);
  const composer = page.getByLabel('Message', { exact: true });
  await expect(composer).toBeVisible();

  const settings = await openTab(gm, table.id, 'Settings');
  await settings.getByRole('button', { name: 'Archive table' }).click();
  await expect(page.getByText('This table is archived: it is read-only.')).toBeVisible();
  await expect(page.getByText('The table is archived: the chat is read-only.')).toBeVisible();
  await expect(composer).toBeHidden();

  await settings.goto('/');
  const card = settings.getByRole('listitem').filter({ hasText: 'Old Campaign' });
  await expect(card).toContainText('Archived');

  await settings.goto(`/tables/${table.id}`);
  await showPanel(settings, 'Settings');
  await settings.getByRole('button', { name: 'Unarchive table' }).click();
  await expect(page.getByText('This table is archived: it is read-only.')).toBeHidden();
  await composer.fill('Back again');
  await composer.press('Enter');
  await expect(page.getByRole('log', { name: 'Messages' })).toContainText('Back again');
  for (const who of [gm, pia]) await who.context.close();
});

// T-0606: a Portuguese browser gets the pt-BR catalogue, and the page hydrates cleanly.
test('the app speaks the browser’s language', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'pt-BR' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.getByLabel('Nome de usuário')).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
