import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type BrowserContext } from '@playwright/test';

import { ADMIN, createPlayer, post, signIn } from './support/api.js';
import { installPlugin, packPlugin } from './support/plugins.js';
import { showPanel } from './support/workspace.js';

const reference = fileURLToPath(new URL('../../plugins/', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-security-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

/** What the browser reports blocking by the page's Content Security Policy. */
function policyViolations(context: BrowserContext): string[] {
  const violations: string[] = [];
  context.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      violations.push(message.text());
    }
  });
  return violations;
}

// T-0701: the page's policy blocks nothing the app needs: its inline scripts, plugin code and
// styles, both sockets and the rich-text editor.
test('the Content Security Policy lets the app run', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(
    gm,
    packPlugin(path.join(reference, 'tiny-d20'), path.join(temp, 'tiny-d20.vttplugin')),
  );
  await post(gm, '/plugins/tiny-d20/enable', { acknowledgeCode: true });
  const player = await createPlayer(browser, gm, 'quinn', 'Quinn');
  const violations = policyViolations(player.context);
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Policy Table',
    systemId: 'tiny-d20',
  });
  const { token } = await post<{ token: string }>(gm, `/tables/${table.id}/invites`, {
    role: 'player',
  });
  await post(player, `/invites/${token}/accept`);
  await post(player, `/tables/${table.id}/actors`, {
    type: 'character',
    name: 'Brin',
  });
  await post(gm, `/tables/${table.id}/journal`, {
    title: 'Rumours',
    hidden: false,
  });

  const page = await player.context.newPage();
  const response = await page.goto(`/tables/${table.id}`);
  expect(await response?.text()).toContain('http-equiv="Content-Security-Policy"');
  await page.getByRole('button', { name: 'Open sheet: Brin' }).click();
  // The sheet is plugin code, styled by the plugin, live over the collab socket.
  await expect(page.getByRole('status', { name: 'Max HP by the rules' })).toHaveText('10');
  await expect(page.getByText(/Connecting|Reconnecting/)).toBeHidden();

  // Chat travels over the events socket.
  await page.getByLabel('Message', { exact: true }).fill('Hello');
  await page.getByLabel('Message', { exact: true }).press('Enter');
  await expect(page.getByRole('log', { name: 'Messages' })).toContainText('Hello');

  await showPanel(page, 'Journal');
  await page.getByRole('button', { name: 'Open: Rumours' }).click();
  await expect(page.getByRole('textbox', { name: 'Rumours' })).toBeVisible();

  expect(violations).toEqual([]);
});

test('API responses forbid framing and sniffing', async ({ request }) => {
  const response = await request.get('/api/v1/setup/status');
  const headers = response.headers();
  expect(headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('same-origin');
});
