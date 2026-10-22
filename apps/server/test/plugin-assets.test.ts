import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  authHeaders,
  createTestApp,
  setupAdmin,
  type Client,
  type TestApp,
} from './support/app.js';
import { copyReferencePlugin } from './support/reference.js';

let dataDir: string;
let pluginDir: string;
let t: TestApp;
let admin: Client;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'vtt-assets-'));
  pluginDir = path.join(dataDir, 'plugins', 'tiny-d20');
  await copyReferencePlugin('tiny-d20', pluginDir);
  await mkdir(path.join(pluginDir, 'img'));
  await writeFile(
    path.join(pluginDir, 'img/icon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  await writeFile(path.join(pluginDir, 'img/.secret.png'), 'x');
  await writeFile(path.join(pluginDir, 'notes.html'), '<script>alert(1)</script>');
  await writeFile(path.join(pluginDir, 'loose.css'), 'body { margin: 0 }');
  await writeFile(path.join(dataDir, 'outside.json'), '{"secret": true}');
  await symlink(path.join(dataDir, 'outside.json'), path.join(pluginDir, 'linked.json'));

  t = await createTestApp({ env: { DATA_DIR: dataDir } });
  admin = await setupAdmin(t.app);
  const headers = authHeaders(admin);
  await t.app.inject({ method: 'POST', url: '/api/v1/plugins/rescan', headers });
  await t.app.inject({
    method: 'POST',
    url: '/api/v1/plugins/tiny-d20/enable',
    headers,
    payload: {},
  });
});

afterEach(async () => {
  await t.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const get = (url: string, headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'GET', url, headers: { cookie: admin.cookie, ...headers } });

describe('plugin files (T-0405)', () => {
  it('serves files with their type and revalidation headers', async () => {
    const res = await get('/plugins/tiny-d20/lang/en.json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.json()).toMatchObject({ 'type.character': 'Character' });

    const again = await get('/plugins/tiny-d20/lang/en.json', {
      'if-none-match': String(res.headers.etag),
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it('serves stylesheets scoped (§8.6)', async () => {
    const res = await get('/plugins/tiny-d20/styles/sheet.css');
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.body).toMatch(/^@layer plugin \{\[data-plugin="tiny-d20"\] \{/);
    expect(res.body).toContain('[data-plugin="tiny-d20"] .vitals');
    const again = await get('/plugins/tiny-d20/styles/sheet.css', {
      'if-none-match': String(res.headers.etag),
    });
    expect(again.statusCode).toBe(304);
  });

  it('keeps SVGs from running scripts', async () => {
    const res = await get('/plugins/tiny-d20/img/icon.svg');
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
  });

  it.each([
    '/plugins/tiny-d20/../../vtt.sqlite',
    '/plugins/tiny-d20/..%2f..%2fvtt.sqlite',
    '/plugins/tiny-d20/%2e%2e/%2e%2e/outside.json',
    '/plugins/tiny-d20/lang/..%2f..%2f..%2foutside.json',
    '/plugins/tiny-d20/..%5c..%5coutside.json',
    '/plugins/tiny-d20/lang%2f..%2f..%2foutside.json',
    '/plugins/tiny-d20//plugin.json',
    '/plugins/tiny-d20/plugin.json%00.png',
    '/plugins/..%2ftiny-d20/plugin.json',
    '/plugins/tiny-d20/linked.json',
  ])('refuses the traversal attempt %s with 404', async (url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('secret');
  });

  it.each([
    ['a hidden file', '/plugins/tiny-d20/img/.secret.png'],
    ['a type plugins cannot serve', '/plugins/tiny-d20/notes.html'],
    ['CSS outside styles/', '/plugins/tiny-d20/loose.css'],
    ['a folder', '/plugins/tiny-d20/lang.json/'],
    ['a directory', '/plugins/tiny-d20/lang'],
    ['a missing file', '/plugins/tiny-d20/lang/fr.json'],
    ['an unknown plugin', '/plugins/nope/plugin.json'],
    ['an invalid plugin id', '/plugins/Tiny/plugin.json'],
  ])('answers 404 for %s', async (_, url) => {
    expect((await get(url)).statusCode).toBe(404);
  });

  it('serves nothing from a disabled plugin', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/plugins/tiny-d20/disable',
      headers: authHeaders(admin),
    });
    expect((await get('/plugins/tiny-d20/plugin.json')).statusCode).toBe(404);
  });

  it('needs a session', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/plugins/tiny-d20/plugin.json' });
    expect(res.statusCode).toBe(401);
  });
});
