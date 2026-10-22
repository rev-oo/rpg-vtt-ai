import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { ADMIN, signIn } from './support/api.js';

const fixtures = fileURLToPath(new URL('../fixtures/plugins/', import.meta.url));
// The built CLI, linked as a dependency of this package.
const cli = fileURLToPath(
  new URL('../node_modules/@vtt/plugin-cli/dist/src/bin.js', import.meta.url),
);

let temp = '';
test.beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-e2e-pack-'));
});
test.afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

/** Packs a copy of a fixture under a new id with the plugin CLI, as an author would. */
async function pack(fixture: string, id: string, name: string): Promise<string> {
  const dir = path.join(temp, id);
  await cp(path.join(fixtures, fixture), dir, { recursive: true });
  const manifest = path.join(dir, 'plugin.json');
  const json = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>;
  await writeFile(manifest, JSON.stringify({ ...json, id, name }));
  const file = path.join(temp, `${id}.vttplugin`);
  const result = spawnSync(process.execPath, [cli, 'pack', dir, '--out', file], {
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return file;
}

// T-0410: `vtt-plugin pack` writes an archive the admin installs from the plugin page.
test('admins install and replace a packed plugin', async ({ browser }) => {
  const archive = await pack('e2e-code', 'e2e-packed', 'E2E Packed');
  const admin = await signIn(browser, ADMIN);
  const page = await admin.context.newPage();
  await page.goto('/admin/plugins');
  const card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'E2E Packed', exact: true }) });

  await test.step('install a new plugin', async () => {
    await page.getByLabel('Plugin archive (.vttplugin)').setInputFiles(archive);
    await expect(
      page.getByText('E2E Packed 1.0.0 is installed. Enable it to use it.'),
    ).toBeVisible();
    await expect(card.getByText('Ready', { exact: true })).toBeVisible();
    await expect(card.getByText('Includes code')).toBeVisible();
    await card.getByRole('button', { name: 'Enable' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Enable with code' }).click();
    await expect(card.getByText('Enabled', { exact: true })).toBeVisible();
  });

  await test.step('replace it after confirming, which disables its code again', async () => {
    await page.getByLabel('Plugin archive (.vttplugin)').setInputFiles(archive);
    const dialog = page.getByRole('dialog', { name: 'Replace the installed plugin?' });
    await dialog.getByRole('button', { name: 'Replace' }).click();
    await expect(page.getByText('E2E Packed 1.0.0 is installed.')).toBeVisible();
    await expect(card.getByText('Disabled', { exact: true })).toBeVisible();
  });

  await admin.context.close();
});
