// @ts-check
// Captures every screen of the app at desktop and phone sizes for the interface review
// (T-1606). Run it against a fresh server started by `start-server.mjs`:
//   E2E_API_PORT=3200 E2E_DATA_DIR=/tmp/review node scripts/start-server.mjs &
//   BASE=http://127.0.0.1:3200 DATA_DIR=/tmp/review OUT=../docs/studies/interface-review \
//     node scripts/capture-screens.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'http://127.0.0.1:3200';
const DATA_DIR = process.env.DATA_DIR ?? '/tmp/review';
const OUT = path.resolve(process.env.OUT ?? 'screens');
const ONLY = process.env.ONLY;
mkdirSync(OUT, { recursive: true });

const SIZES = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};
const ADMIN = { username: 'admin', displayName: 'Ana (GM)', password: 'review-password-1' };
const cli = path.resolve(here, '../node_modules/@vtt/plugin-cli/dist/src/bin.js');
const plugins = path.resolve(here, '../../plugins');

const browser = await chromium.launch();

/** @param {import('@playwright/test').Page} page @param {string} name */
async function shot(page, name) {
  if (ONLY && !name.startsWith(ONLY)) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 72 });
  console.log('shot', name);
}

/** @param {keyof typeof SIZES} size @param {{ colorScheme?: 'light' | 'dark' }} [extra] */
const context = (size, extra = {}) =>
  browser.newContext({ baseURL: BASE, locale: 'en-US', ...SIZES[size], ...extra });

/** @param {import('@playwright/test').BrowserContext} ctx @param {{username: string, password: string}} who */
async function login(ctx, who) {
  const response = await ctx.request.post('/api/v1/auth/login', { data: who });
  if (!response.ok()) throw new Error(await response.text());
  const body = await response.json();
  return { ctx, csrf: body.csrfToken, userId: body.user.id };
}

/** @param {{ctx: import('@playwright/test').BrowserContext, csrf: string}} who @param {string} p @param {unknown} [data] */
async function post(who, p, data = {}) {
  const response = await who.ctx.request.post(`/api/v1${p}`, {
    data,
    headers: { 'x-csrf-token': who.csrf },
  });
  if (!response.ok()) throw new Error(`${p}: ${await response.text()}`);
  return response.status() === 204 ? {} : response.json();
}

/** @param {'actors' | 'items'} table @param {string} id @param {object} system */
function setData(table, id, system) {
  const db = new Database(path.join(DATA_DIR, 'vtt.sqlite'));
  try {
    db.prepare(`update ${table} set system = ? where id = ?`).run(JSON.stringify(system), id);
  } finally {
    db.close();
  }
}

/** @param {{ctx: import('@playwright/test').BrowserContext, csrf: string}} admin @param {string} name */
async function install(admin, name) {
  const out = path.join(DATA_DIR, `${name}.vttplugin`);
  const packed = spawnSync(process.execPath, [cli, 'pack', path.join(plugins, name), '--out', out]);
  if (packed.status !== 0) throw new Error(String(packed.stderr));
  const response = await admin.ctx.request.post('/api/v1/plugins/install?replace=true', {
    data: readFileSync(out),
    headers: { 'content-type': 'application/zip', 'x-csrf-token': admin.csrf },
  });
  if (!response.ok()) throw new Error(await response.text());
}

/** @param {import('@playwright/test').Page} page @param {string} name */
async function showPanel(page, name) {
  await page.getByRole('button', { name: 'Panels' }).click();
  await page
    .getByRole('list', { name: 'Panels' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
}

/** @param {import('@playwright/test').Page} page */
async function settle(page) {
  await page.getByText(/Connecting|Reconnecting/).waitFor({ state: 'hidden' });
  await page.waitForLoadState('networkidle');
}

// 1. First run and login, before anyone exists.
for (const size of /** @type {const} */ (['desktop', 'phone'])) {
  const ctx = await context(size);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('heading', { name: 'Set up your instance' }).waitFor();
  await shot(page, `01-setup-${size}`);
  await ctx.close();
}
{
  const ctx = await context('desktop');
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Display name').fill(ADMIN.displayName);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await page.getByRole('heading', { name: 'Your tables' }).waitFor();
  await ctx.close();
}
for (const size of /** @type {const} */ (['desktop', 'phone'])) {
  const ctx = await context(size);
  const page = await ctx.newPage();
  await page.goto('/login');
  await shot(page, `02-login-${size}`);
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('alert').waitFor();
  await shot(page, `02-login-error-${size}`);
  await ctx.close();
}

// 2. Seed: plugins, a player, tables, actors, items, a scene, an encounter and chat.
const seedCtx = await browser.newContext({ baseURL: BASE });
const admin = await login(seedCtx, ADMIN);

for (const size of /** @type {const} */ (['desktop', 'phone'])) {
  const ctx = await context(size);
  await login(ctx, ADMIN);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('heading', { name: 'Your tables' }).waitFor();
  await shot(page, `03-tables-empty-${size}`);
  await ctx.close();
}

await install(admin, 'srd5');
await post(admin, '/plugins/srd5/enable', { acknowledgeCode: true });
await install(admin, 'tiny-d20');
await post(admin, '/plugins/tiny-d20/enable', { acknowledgeCode: true });
await install(admin, 'dice-3d');

const { oneTimePassword } = await post(admin, '/users', { username: 'lena', displayName: 'Lena' });
const lenaCtx = await browser.newContext({ baseURL: BASE });
const lenaFirst = await login(lenaCtx, { username: 'lena', password: oneTimePassword });
const LENA = { username: 'lena', password: 'lena-password-1' };
await lenaFirst.ctx.request.post('/api/v1/me/password', {
  data: { currentPassword: oneTimePassword, newPassword: LENA.password },
  headers: { 'x-csrf-token': lenaFirst.csrf },
});
const lena = await login(await browser.newContext({ baseURL: BASE }), LENA);

const { table } = await post(admin, '/tables', {
  name: 'The Crimson Road',
  description: 'Thursdays at 8. Level 3 party heading north.',
  systemId: 'srd5',
});
await post(admin, '/tables', { name: 'One-shot: The Bell Tower', systemId: 'tiny-d20' });
const { token } = await post(admin, `/tables/${table.id}/invites`, { role: 'player' });
await post(lena, `/invites/${token}/accept`);
const invite = await post(admin, `/tables/${table.id}/invites`, { role: 'player' });

const { actor: mira } = await post(lena, `/tables/${table.id}/actors`, {
  type: 'character',
  name: 'Mira Ashdown',
});
setData('actors', mira.id, {
  class: 'class.fighter',
  level: 3,
  species: 'Human',
  background: 'Soldier',
  str: 16,
  dex: 14,
  con: 14,
  int: 10,
  wis: 12,
  cha: 8,
  hp: { value: 21, max: 28, temp: 0 },
  conditions: { poisoned: true, prone: true },
});
const { actor: goblin } = await post(admin, `/tables/${table.id}/actors`, {
  type: 'npc',
  name: 'Goblin Warrior',
});
setData('actors', goblin.id, {
  hp: { value: 7, max: 10 },
  ac: 15,
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
const { actor: wolf } = await post(admin, `/tables/${table.id}/actors`, {
  type: 'npc',
  name: 'Wolf',
});
await post(lena, `/tables/${table.id}/compendium/copy`, {
  refs: ['srd5:srd:longsword', 'srd5:srd:chain-mail'],
  actorId: mira.id,
});
await post(admin, `/tables/${table.id}/compendium/copy`, { refs: ['srd5:srd:fire-bolt'] }).catch(
  () => undefined,
);
await post(admin, `/tables/${table.id}/items`, { type: 'gear', name: 'Rope (50 feet)' }).catch(
  () => undefined,
);
await post(admin, `/tables/${table.id}/journal`, { title: 'Session 4 recap', hidden: false });
await post(admin, `/tables/${table.id}/journal`, { title: 'The Ashen Pact (GM only)' });

const { scene } = await post(admin, `/tables/${table.id}/scenes`, {
  name: 'Ambush at the ford',
  columns: 12,
  rows: 8,
});
await post(admin, `/tables/${table.id}/scenes`, { name: 'Old mill', columns: 10, rows: 10 });
await post(admin, `/tables/${table.id}/scenes/active`, { sceneId: scene.id });
await post(admin, `/scenes/${scene.id}/tokens`, { actorId: mira.id, column: 3, row: 4 });
await post(admin, `/scenes/${scene.id}/tokens`, { actorId: goblin.id, column: 7, row: 3 });
await post(admin, `/scenes/${scene.id}/tokens`, { actorId: wolf.id, column: 8, row: 5 });

await post(admin, `/tables/${table.id}/encounter`);
for (const actorId of [mira.id, goblin.id, wolf.id]) {
  await post(admin, `/tables/${table.id}/encounter/combatants`, { actorId });
}
await post(admin, `/tables/${table.id}/encounter/initiative`, {});
await post(admin, `/tables/${table.id}/encounter/start`, {});

await post(lena, `/tables/${table.id}/messages`, {
  text: 'Mira draws her sword and steps into the ford.',
});
await post(admin, `/tables/${table.id}/rolls`, {
  actorId: goblin.id,
  recipe: { name: 'npcAttack', args: { id: 'a1' } },
});
await post(lena, `/tables/${table.id}/rolls`, { formula: '1d20+5' });
await post(admin, `/tables/${table.id}/messages`, {
  text: 'The goblin hisses and dives for cover.',
});

// 3. App pages: tables, the new table dialog, invite, account, admin.
for (const size of /** @type {const} */ (['desktop', 'phone'])) {
  const ctx = await context(size);
  await login(ctx, ADMIN);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('heading', { name: 'Your tables' }).waitFor();
  await shot(page, `03-tables-${size}`);
  await page.getByRole('button', { name: 'New table' }).click();
  await page.getByRole('dialog', { name: 'New table' }).waitFor();
  await shot(page, `04-new-table-${size}`);
  await page.keyboard.press('Escape');
  await page.goto('/account');
  await shot(page, `05-account-${size}`);
  await page.goto('/admin/plugins');
  await page.waitForLoadState('networkidle');
  await shot(page, `06-admin-plugins-${size}`);
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle');
  await shot(page, `07-admin-settings-${size}`);
  await page.goto('/no-such-page');
  await shot(page, `08-not-found-${size}`);
  await ctx.close();

  const anon = await context(size);
  const invitePage = await anon.newPage();
  await invitePage.goto(`/invite/${invite.token}`);
  await invitePage.waitForLoadState('networkidle');
  await shot(invitePage, `09-invite-${size}`);
  await anon.close();
}

// 4. The table as the GM and as a player.
for (const size of /** @type {const} */ (['desktop', 'phone'])) {
  const ctx = await context(size);
  await login(ctx, ADMIN);
  const page = await ctx.newPage();
  await page.goto(`/tables/${table.id}`);
  await settle(page);
  await shot(page, `10-table-gm-${size}`);
  for (const [panel, name] of [
    ['Map', 'map'],
    ['Scenes', 'scenes'],
    ['Actors', 'actors'],
    ['Items', 'items'],
    ['Journal', 'journal'],
    ['Compendium', 'compendium'],
    ['Images', 'assets'],
    ['Combat', 'combat'],
    ['Chat', 'chat'],
    ['Dice', 'dice'],
    ['Table', 'overview'],
    ['Members', 'members'],
    ['Settings', 'settings'],
  ]) {
    try {
      await showPanel(page, panel);
      await shot(page, `11-panel-${name}-${size}`);
    } catch (error) {
      console.log('panel failed', panel, String(error).slice(0, 200));
      await page.keyboard.press('Escape');
    }
  }
  try {
    await showPanel(page, 'Actors');
    await page.getByRole('button', { name: 'Open sheet: Mira Ashdown' }).click();
    await page.waitForTimeout(1500);
    await shot(page, `12-sheet-character-${size}`);
    await showPanel(page, 'Actors');
    await page.getByRole('button', { name: 'Open sheet: Goblin Warrior' }).click();
    await page.waitForTimeout(1500);
    await shot(page, `12-sheet-npc-${size}`);
    await showPanel(page, 'Journal');
    await page
      .getByRole('button', { name: /Session 4 recap/ })
      .first()
      .click();
    await page.waitForTimeout(1200);
    await shot(page, `13-journal-entry-${size}`);
  } catch (error) {
    console.log('documents failed', String(error).slice(0, 300));
  }
  await ctx.close();

  const playerCtx = await context(size);
  await login(playerCtx, LENA);
  const playerPage = await playerCtx.newPage();
  await playerPage.goto(`/tables/${table.id}`);
  await settle(playerPage);
  await shot(playerPage, `14-table-player-${size}`);
  await playerCtx.close();
}

// 5. Dark mode.
for (const size of /** @type {const} */ (['desktop', 'phone'])) {
  const ctx = await context(size, { colorScheme: 'dark' });
  await login(ctx, ADMIN);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('heading', { name: 'Your tables' }).waitFor();
  await shot(page, `15-dark-tables-${size}`);
  await page.goto(`/tables/${table.id}`);
  await settle(page);
  await shot(page, `15-dark-table-${size}`);
  await ctx.close();
}

await browser.close();
console.log('done', OUT);
