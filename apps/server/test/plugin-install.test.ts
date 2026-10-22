import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPluginFolder, writeZip } from '@vtt/plugin-io';
import {
  errorResponseSchema,
  invalidPluginDetailsSchema,
  pluginResponseSchema,
} from '@vtt/shared/api';

import {
  authHeaders,
  createTestApp,
  createUserClient,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';

const REFERENCE = fileURLToPath(new URL('../../../plugins/', import.meta.url));

let dataDir: string;
let t: TestApp;
let admin: Client;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'vtt-install-'));
  t = await createTestApp({ env: { DATA_DIR: dataDir } });
  admin = await setupAdmin(t.app);
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** A reference plugin as an archive, with its files changed by `edit`. */
async function archive(
  id: string,
  edit: (files: Map<string, Buffer>) => void = () => undefined,
): Promise<Buffer> {
  const dir = path.join(REFERENCE, id);
  const { files: listed } = await readPluginFolder(dir);
  const files = new Map<string, Buffer>();
  for (const file of listed.keys()) files.set(file, await readFile(path.join(dir, file)));
  edit(files);
  return writeZip(files);
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value));

function upload(zip: Buffer, { query = '', client = admin, type = 'application/zip' } = {}) {
  return t.app.inject({
    method: 'POST',
    url: `/api/v1/plugins/install${query}`,
    headers: { ...authHeaders(client), 'content-type': type },
    payload: zip,
  });
}

const errorOf = (res: { json: () => unknown }) => errorResponseSchema.parse(res.json()).error;

describe('POST /plugins/install (T-0410, ADR-026)', () => {
  it('installs a valid archive, disabled, ready to enable', async () => {
    const res = await upload(await archive('tiny-d20'));
    expect(res.statusCode).toBe(201);
    expect(pluginResponseSchema.parse(res.json()).plugin).toMatchObject({
      id: 'tiny-d20',
      status: 'ready',
      enabled: false,
    });
    expect((await readdir(path.join(dataDir, 'plugins', 'tiny-d20'))).sort()).toContain(
      'plugin.json',
    );
    // Nothing is left behind in the staging folder.
    expect(await readdir(path.join(dataDir, 'cache', 'install'))).toEqual([]);
    const enabled = await t.app.inject({
      method: 'POST',
      url: '/api/v1/plugins/tiny-d20/enable',
      headers: authHeaders(admin),
      payload: {},
    });
    expect(enabled.json()).toMatchObject({ plugin: { available: true } });
  });

  it('replaces an installed plugin only when asked, and disables changed code', async () => {
    await upload(await archive('tiny-d20'));
    const again = await upload(await archive('tiny-d20'));
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('plugin_exists');

    const withCode = await archive('tiny-d20', (files) => {
      const manifest = JSON.parse(String(files.get('plugin.json'))) as Record<string, unknown>;
      files.set('plugin.json', json({ ...manifest, version: '0.2.0', hasCode: true }));
      files.set('code/client.js', Buffer.from('export default {};'));
    });
    const replaced = await upload(withCode, { query: '?replace=true' });
    expect(replaced.statusCode).toBe(200);
    expect(pluginResponseSchema.parse(replaced.json()).plugin).toMatchObject({
      version: '0.2.0',
      enabled: false,
      codeEntries: ['code/client.js'],
    });
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/plugins/tiny-d20/enable',
      headers: authHeaders(admin),
      payload: { acknowledgeCode: true },
    });
    const later = await upload(withCode, { query: '?replace=true' });
    expect(pluginResponseSchema.parse(later.json()).plugin.enabled).toBe(false);
  });

  it('refuses plugins with errors and lists them', async () => {
    const res = await upload(
      await archive('tiny-d20', (files) => {
        files.set('types/actors/character.json', json({ label: 'x', sheet: 'missing' }));
      }),
    );
    expect(res.statusCode).toBe(422);
    const error = errorOf(res);
    expect(error.code).toBe('invalid_plugin');
    const { issues } = invalidPluginDetailsSchema.parse(error.details);
    expect(issues.some((issue) => issue.file === 'types/actors/character.json')).toBe(true);
    await expect(stat(path.join(dataDir, 'plugins', 'tiny-d20'))).rejects.toThrow();
  });

  it('refuses archives it cannot unpack safely', async () => {
    const escape = writeZip([
      ['plugin.json', json({})],
      ['../outside.json', json({})],
    ]);
    const res = await upload(escape);
    expect(res.statusCode).toBe(422);
    expect(errorOf(res)).toMatchObject({
      code: 'invalid_archive',
      details: { reason: 'unsafe_name' },
    });
    expect(errorOf(await upload(Buffer.from('not a zip')))).toMatchObject({
      details: { reason: 'not_zip' },
    });
    const noManifest = await upload(writeZip([['a.json', json({})]]));
    expect(errorOf(noManifest)).toMatchObject({ details: { reason: 'no_manifest' } });
  });

  it('is for admins, takes only zip bodies and limits their size', async () => {
    const zip = await archive('tiny-d20');
    const user = await createUserClient(t.app, admin, 'bob');
    expect((await upload(zip, { client: user.client })).statusCode).toBe(403);
    expect((await upload(zip, { type: 'application/octet-stream' })).statusCode).toBe(415);
    const empty = await t.app.inject({
      method: 'POST',
      url: '/api/v1/plugins/install',
      headers: authHeaders(admin),
      payload: {},
    });
    expect(errorOf(empty).code).toBe('archive_required');
    const huge = await upload(Buffer.alloc(20 * 1024 * 1024 + 1));
    expect(huge.statusCode).toBe(413);
  });
});
