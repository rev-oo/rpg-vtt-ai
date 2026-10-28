import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { ADMIN, post, signIn } from './support/api.js';
import { installPlugin, packPlugin } from './support/plugins.js';

const fixtures = fileURLToPath(new URL('../fixtures/plugins/', import.meta.url));

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-version-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

/** The e2e system under its own id, packed at `version`. */
async function pack(version: string): Promise<string> {
  const dir = path.join(temp, version);
  await cp(path.join(fixtures, 'e2e-system'), dir, { recursive: true });
  const manifest = path.join(dir, 'plugin.json');
  const json = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>;
  await writeFile(
    manifest,
    JSON.stringify({ ...json, id: 'e2e-versioned', name: 'Versioned System', version }),
  );
  return packPlugin(dir, path.join(temp, `e2e-versioned-${version}.vttplugin`));
}

// T-0813 (§9.7, ADR-058): after a system upgrade, sheets made with the older version say so.
test('sheets made before a system upgrade show a notice', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(gm, await pack('1.0.0'));
  await post(gm, '/plugins/e2e-versioned/enable');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Versioned Table',
    systemId: 'e2e-versioned',
  });
  const create = (name: string) =>
    post<{ actor: { id: string } }>(gm, `/tables/${table.id}/actors`, { type: 'npc', name });
  const { actor: veteran } = await create('Veteran');

  await installPlugin(gm, await pack('1.1.0'));
  const { actor: recruit } = await create('Recruit');

  const page = await gm.context.newPage();
  const notice = page.getByText(/This sheet was made with/);
  await page.goto(`/tables/${table.id}/actors/${veteran.id}`);
  await expect(page.getByRole('heading', { name: 'Veteran' })).toBeVisible();
  await expect(notice).toHaveText(
    'This sheet was made with Versioned System 1.0.0; the table now uses 1.1.0. Fields that changed since may show their defaults.',
  );

  await page.goto(`/tables/${table.id}/actors/${recruit.id}`);
  await expect(page.getByRole('heading', { name: 'Recruit' })).toBeVisible();
  await expect(notice).toBeHidden();
});
