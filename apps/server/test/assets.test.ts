import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { MIB, type AssetView } from '@vtt/shared/api';

import { backupDataDir } from '../src/db/backup.js';
import { openDatabase, runMigrations } from '../src/db/client.js';
import { actors, members, ydocs } from '../src/db/schema.js';
import { sniffImageType } from '../src/domain/assets.js';

import {
  ADMIN,
  authHeaders,
  clientFrom,
  createTestApp,
  login,
  type Client,
} from './support/app.js';
import { setupTable, type TableSetup } from './support/table.js';

// T-1301 (FR-ASSET-01, FR-ASSET-03, ADR-064): GMs and assistants upload images to a table,
// checked by their bytes and limited in size and in total; members read them.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let t: TableSetup;
let dataDir = '';
beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'vtt-assets-'));
  t = await setupTable({ env: { DATA_DIR: dataDir } });
});
afterEach(async () => {
  await t.app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const upload = (
  client: Client,
  body: Buffer,
  { name = 'map.png', type = 'image/png', tableId = t.table.id } = {},
): Promise<LightMyRequestResponse> =>
  t.app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/assets?name=${encodeURIComponent(name)}`,
    headers: { ...authHeaders(client), 'content-type': type },
    payload: body,
  });

const fetchAsset = (client: Client, url: string) =>
  t.app.inject({ method: 'GET', url, headers: authHeaders(client, { csrf: false }) });

const uploaded = async (client: Client, body: Buffer, options = {}): Promise<AssetView> => {
  const res = await upload(client, body, options);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ asset: AssetView }>().asset;
};

const setLimits = (payload: Record<string, number>, admin: Client) =>
  t.app.inject({
    method: 'PATCH',
    url: '/api/v1/admin/settings',
    headers: authHeaders(admin),
    payload,
  });

describe('sniffImageType', () => {
  it('tells the four image types by their bytes, and nothing else', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(GIF)).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(SVG)).toBeUndefined();
    expect(sniffImageType(Buffer.from('<html><body>hi</body></html>'))).toBeUndefined();
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeUndefined();
    expect(sniffImageType(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('asset uploads (T-1301)', () => {
  it('stores an image under the table and serves it to members with long caching', async () => {
    const asset = await uploaded(t.gm.client, PNG, { name: ' Cave map.png ' });
    expect(asset).toMatchObject({
      tableId: t.table.id,
      uploaderId: t.gm.userId,
      name: 'Cave map.png',
      type: 'image/png',
      size: PNG.length,
      url: `/api/v1/assets/${asset.id}`,
    });
    expect(readdirSync(path.join(dataDir, 'assets', t.table.id))).toEqual([asset.id]);

    for (const member of [t.gm, t.bob, t.dave]) {
      const res = await fetchAsset(member.client, asset.url);
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(PNG)).toBe(true);
      expect(res.headers).toMatchObject({
        'content-type': 'image/png',
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      });
    }

    const list = await t.call(t.bob.client, 'GET', `/tables/${t.table.id}/assets`);
    expect(list.json<{ assets: AssetView[] }>().assets).toEqual([asset]);
  });

  it('judges files by their bytes, not their name or content type, and refuses SVG', async () => {
    // A JPEG sent as a PNG named .gif is stored as the JPEG it is.
    const jpeg = await uploaded(t.gm.client, JPEG, { name: 'x.gif', type: 'image/png' });
    expect(jpeg.type).toBe('image/jpeg');
    expect((await fetchAsset(t.gm.client, jpeg.url)).headers['content-type']).toBe('image/jpeg');
    const octets = await uploaded(t.gm.client, WEBP, { type: 'application/octet-stream' });
    expect(octets.type).toBe('image/webp');
    expect((await uploaded(t.gm.client, GIF)).type).toBe('image/gif');

    for (const [body, type] of [
      [SVG, 'image/svg+xml'],
      [SVG, 'image/png'],
      [Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'],
    ] as const) {
      const res = await upload(t.gm.client, body, { type });
      expect(res.statusCode).toBe(415);
      expect(res.json()).toMatchObject({ error: { code: 'unsupported_asset_type' } });
    }
    // Bodies of other types never reach the route as files.
    const text = await t.app.inject({
      method: 'POST',
      url: `/api/v1/tables/${t.table.id}/assets`,
      headers: { ...authHeaders(t.gm.client), 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(text.statusCode).toBe(415);
    const empty = await upload(t.gm.client, Buffer.alloc(0));
    expect(empty.json()).toMatchObject({ error: { code: 'image_required' } });
    expect(readdirSync(path.join(dataDir, 'assets', t.table.id))).toHaveLength(3);
  });

  it('lets only GMs and assistants of an unarchived table upload', async () => {
    t.db
      .update(members)
      .set({ role: 'assistant' })
      .where(and(eq(members.tableId, t.table.id), eq(members.userId, t.carol.userId)))
      .run();
    expect((await upload(t.carol.client, PNG)).statusCode).toBe(201);
    expect((await upload(t.bob.client, PNG)).statusCode).toBe(403);
    expect((await upload(t.eve.client, PNG)).statusCode).toBe(404);

    expect((await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/archive`)).statusCode).toBe(
      200,
    );
    const archived = await upload(t.gm.client, PNG);
    expect(archived.statusCode).toBe(409);
    expect(archived.json()).toMatchObject({ error: { code: 'table_archived' } });
  });

  it('serves nothing to non-members, signed-out callers or unknown ids', async () => {
    const asset = await uploaded(t.gm.client, PNG);
    expect((await fetchAsset(t.eve.client, asset.url)).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: asset.url })).statusCode).toBe(401);
    expect((await fetchAsset(t.gm.client, '/api/v1/assets/nope')).statusCode).toBe(404);
    expect(
      (await fetchAsset(t.gm.client, '/api/v1/assets/00000000-0000-4000-8000-000000000000'))
        .statusCode,
    ).toBe(404);
    expect((await t.call(t.eve.client, 'GET', `/tables/${t.table.id}/assets`)).statusCode).toBe(
      404,
    );
    // A row whose file is gone, as after a partial restore, is not served.
    rmSync(path.join(dataDir, 'assets', t.table.id, asset.id));
    expect((await fetchAsset(t.gm.client, asset.url)).statusCode).toBe(404);
  });

  it('enforces the upload limit and the instance quota from the admin settings', async () => {
    const admin = await adminOf(t);
    const big = Buffer.concat([PNG, Buffer.alloc(MIB)]);
    expect(
      (await setLimits({ maxUploadBytes: MIB, assetQuotaBytes: 2 * MIB }, admin)).statusCode,
    ).toBe(200);

    const tooLarge = await upload(t.gm.client, big);
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json()).toMatchObject({ error: { code: 'asset_too_large' } });

    const almost = Buffer.concat([PNG, Buffer.alloc(MIB - PNG.length - 10)]);
    await uploaded(t.gm.client, almost);
    await uploaded(t.gm.client, almost);
    const over = await upload(t.gm.client, almost);
    expect(over.statusCode).toBe(413);
    expect(over.json()).toMatchObject({ error: { code: 'asset_quota_exceeded' } });
    // Refused uploads leave no files behind.
    expect(readdirSync(path.join(dataDir, 'assets', t.table.id))).toHaveLength(2);

    expect((await setLimits({ assetQuotaBytes: 3 * MIB }, admin)).statusCode).toBe(200);
    await uploaded(t.gm.client, almost);
    // Lowering a limit keeps what is stored.
    expect((await setLimits({ assetQuotaBytes: MIB }, admin)).statusCode).toBe(200);
    const list = await t.call(t.gm.client, 'GET', `/tables/${t.table.id}/assets`);
    expect(list.json<{ assets: AssetView[] }>().assets).toHaveLength(3);
    expect((await upload(t.gm.client, PNG)).statusCode).toBe(413);

    // The limits themselves are bounded.
    expect((await setLimits({ maxUploadBytes: 1000 }, admin)).statusCode).toBe(400);
    expect((await setLimits({ maxUploadBytes: 101 * MIB }, admin)).statusCode).toBe(400);
  });
});

describe('asset images and deletion (T-1302)', () => {
  const create = async (path: string, payload: Record<string, unknown>) => {
    const res = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/${path}`, payload);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<Record<string, { id: string }>>();
  };
  const remove = (client: Client, asset: AssetView) =>
    t.app.inject({ method: 'DELETE', url: asset.url, headers: authHeaders(client) });

  it("image fields take the table's own assets, and no other table's", async () => {
    const asset = await uploaded(t.gm.client, PNG);
    const { actor } = await create('actors', { type: 'npc', name: 'Ogre', imageUrl: asset.url });
    expect(actor).toMatchObject({ imageUrl: asset.url });

    const other = await t.call(t.gm.client, 'POST', '/tables', {
      name: 'Other',
      systemId: 'test-system',
    });
    const otherAsset = await uploaded(t.gm.client, PNG, {
      tableId: other.json<{ table: { id: string } }>().table.id,
    });
    for (const imageUrl of [
      otherAsset.url,
      '/api/v1/assets/00000000-0000-4000-8000-000000000000',
    ]) {
      const res = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/items`, {
        type: 'weapon',
        name: 'Axe',
        imageUrl,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'unknown_asset' } });
    }
    const patched = await t.call(t.gm.client, 'PATCH', `/actors/${actor?.id ?? ''}`, {
      imageUrl: otherAsset.url,
    });
    expect(patched.statusCode).toBe(422);
    // Other paths are not images of the instance at all.
    const relative = await t.call(t.gm.client, 'PATCH', `/actors/${actor?.id ?? ''}`, {
      imageUrl: '/api/v1/users',
    });
    expect(relative.statusCode).toBe(400);
  });

  it('deletes unused images, for GMs and assistants only', async () => {
    const asset = await uploaded(t.gm.client, PNG);
    expect((await remove(t.bob.client, asset)).statusCode).toBe(403);
    expect((await remove(t.eve.client, asset)).statusCode).toBe(404);
    expect((await remove(t.gm.client, asset)).statusCode).toBe(204);
    expect(readdirSync(path.join(dataDir, 'assets', t.table.id))).toEqual([]);
    expect((await fetchAsset(t.gm.client, asset.url)).statusCode).toBe(404);
    expect((await remove(t.gm.client, asset)).statusCode).toBe(404);
  });

  it('refuses to delete an image an actor, item or journal entry uses, even in the trash', async () => {
    const asset = await uploaded(t.gm.client, PNG);
    const { actor } = await create('actors', { type: 'npc', name: 'Ogre', imageUrl: asset.url });
    const { item } = await create('items', { type: 'weapon', name: 'Axe', imageUrl: asset.url });
    const { entry } = await create('journal', { title: 'The Mill' });
    const actorId = actor?.id ?? '';
    const itemId = item?.id ?? '';
    const entryId = entry?.id ?? '';

    // The entry's body, as the editor stores it: an image node in the `body` fragment.
    const doc = new Y.Doc();
    const image = new Y.XmlElement('image');
    image.setAttribute('src', asset.url);
    doc.getXmlFragment('body').insert(0, [image]);
    const name = `journal:${entryId}:main`;
    t.db
      .insert(ydocs)
      .values({ name, journalEntryId: entryId, state: Buffer.from(Y.encodeStateAsUpdate(doc)) })
      .onConflictDoUpdate({
        target: ydocs.name,
        set: { state: Buffer.from(Y.encodeStateAsUpdate(doc)) },
      })
      .run();

    expect((await t.call(t.gm.client, 'DELETE', `/actors/${actorId}`)).statusCode).toBe(204);
    const res = await remove(t.gm.client, asset);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: {
        code: 'asset_in_use',
        details: {
          uses: [
            { kind: 'actor', id: actorId, name: 'Ogre' },
            { kind: 'item', id: itemId, name: 'Axe' },
            { kind: 'journal', id: entryId, name: 'The Mill' },
          ],
        },
      },
    });

    expect((await t.call(t.gm.client, 'POST', `/actors/${actorId}/restore`)).statusCode).toBe(200);
    await t.call(t.gm.client, 'PATCH', `/actors/${actorId}`, { imageUrl: null });
    await t.call(t.gm.client, 'PATCH', `/items/${itemId}`, { imageUrl: null });
    doc.getXmlFragment('body').delete(0, 1);
    t.db
      .update(ydocs)
      .set({ state: Buffer.from(Y.encodeStateAsUpdate(doc)) })
      .where(eq(ydocs.name, name))
      .run();
    expect((await remove(t.gm.client, asset)).statusCode).toBe(204);
  });
});

describe('images in plugin data (ADR-065)', () => {
  it("counts an image field of an actor's or item's data as a use", async () => {
    const asset = await uploaded(t.gm.client, PNG);
    const created = await t.call(t.gm.client, 'POST', `/tables/${t.table.id}/actors`, {
      type: 'npc',
      name: 'Bard',
    });
    const bard = created.json<{ actor: { id: string } }>().actor;
    // As a sheet's `image` node stores it once the document is saved.
    t.db
      .update(actors)
      .set({ system: { portrait: asset.url } })
      .where(eq(actors.id, bard.id))
      .run();
    const res = await t.app.inject({
      method: 'DELETE',
      url: asset.url,
      headers: authHeaders(t.gm.client),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: { details: { uses: [{ kind: 'actor', id: bard.id, name: 'Bard' }] } },
    });

    t.db
      .update(actors)
      .set({ system: { portrait: '' } })
      .where(eq(actors.id, bard.id))
      .run();
    const again = await t.app.inject({
      method: 'DELETE',
      url: asset.url,
      headers: authHeaders(t.gm.client),
    });
    expect(again.statusCode).toBe(204);
  });
});

describe('asset backups (FR-ASSET-03)', () => {
  it('a backup taken with assets restores them', async () => {
    // Backups copy the database file, so this table's lives on disk.
    await t.app.close();
    const onDisk = openDatabase({ dataDir });
    runMigrations(onDisk);
    t = await setupTable({ env: { DATA_DIR: dataDir }, db: onDisk });
    const asset = await uploaded(t.gm.client, PNG);
    const backups = mkdtempSync(path.join(tmpdir(), 'vtt-asset-backups-'));
    try {
      const result = backupDataDir(dataDir, backups);
      expect(result.assets).toBe(true);

      // Restore as docs/backup.md says: the backup's files into an empty DATA_DIR.
      const restored = mkdtempSync(path.join(tmpdir(), 'vtt-restored-'));
      cpSync(result.dir, restored, { recursive: true });
      expect(existsSync(path.join(restored, 'assets', t.table.id, asset.id))).toBe(true);
      const db = openDatabase({ dataDir: restored });
      const again = await createTestApp({ env: { DATA_DIR: restored }, db });
      const res = await fetchAssetFrom(again.app, t.bob.client, asset.url);
      expect(res.statusCode).toBe(200);
      expect(
        res.rawPayload.equals(readFileSync(path.join(dataDir, 'assets', t.table.id, asset.id))),
      ).toBe(true);
      await again.app.close();
      rmSync(restored, { recursive: true, force: true });
    } finally {
      rmSync(backups, { recursive: true, force: true });
    }
  });
});

const fetchAssetFrom = (app: TableSetup['app'], client: Client, url: string) =>
  app.inject({ method: 'GET', url, headers: authHeaders(client, { csrf: false }) });

/** The instance admin, signed in again: setupTable keeps only the table's people. */
async function adminOf(setup: TableSetup): Promise<Client> {
  return clientFrom(await login(setup.app, ADMIN));
}
