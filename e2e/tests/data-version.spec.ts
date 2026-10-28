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

// T-0813 (§9.7, ADR-058): a GM upgrades the table to a newly installed system version; sheets
// made before then say so.
test('a GM upgrades the table, and older sheets show a notice', async ({ browser }) => {
  const gm = await signIn(browser, ADMIN);
  await installPlugin(gm, await pack('1.0.0'));
  await post(gm, '/plugins/e2e-versioned/enable');
  const { table } = await post<{ table: { id: string } }>(gm, '/tables', {
    name: 'Versioned Table',
    systemId: 'e2e-versioned',
  });
  const create = (name: string) =>
    post<{ actor: { id: string } }>(gm, `/tables/${table.id}/actors`, { type: 'npc', name });
  await create('Veteran');
  await installPlugin(gm, await pack('1.1.0'));

  const page = await gm.context.newPage();
  const notice = page.getByText(/This sheet was made with/);
  const openSheet = async (name: string) => {
    await page.goto(`/tables/${table.id}`);
    await page.getByRole('button', { name: `Open sheet: ${name}` }).click();
    await expect(page.getByRole('tabpanel', { name }).getByRole('heading', { name })).toBeVisible();
  };

  await test.step('the table stays on its version until upgraded', async () => {
    await openSheet('Veteran');
    await expect(
      page.getByText('Versioned System 1.1.0 is installed; this table plays 1.0.0.'),
    ).toBeVisible();
    await expect(notice).toBeHidden();
  });

  await test.step('the GM upgrades it from the settings', async () => {
    await page.getByRole('button', { name: 'Upgrade in settings' }).click();
    await page.getByRole('button', { name: 'Upgrade to 1.1.0' }).click();
    await expect(page.getByText('This table plays Versioned System 1.1.0.')).toBeVisible();
  });

  await test.step('older sheets say so; new ones do not', async () => {
    await openSheet('Veteran');
    await expect(notice).toHaveText(
      'This sheet was made with Versioned System 1.0.0; the table now uses 1.1.0. Fields that changed since may show their defaults.',
    );
    await create('Recruit');
    await openSheet('Recruit');
    await expect(notice).toBeHidden();
  });
});
