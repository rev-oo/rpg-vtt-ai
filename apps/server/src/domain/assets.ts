import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import * as Y from 'yjs';

import { documentName, parseDocumentName } from '@vtt/shared';
import {
  assetIdOf,
  assetPath,
  type AssetType,
  type AssetUse,
  type AssetView,
} from '@vtt/shared/api';

import type { Db, DbOrTx } from '../db/client.js';
import { actors, assets, items, journalEntries, scenes, ydocs } from '../db/schema.js';
import { AppError, notFound, unprocessable } from '../errors.js';

import { generateId } from './auth/tokens.js';
import { DATA_MAP } from './documents.js';

export type Asset = typeof assets.$inferSelect;

/**
 * The image type of `bytes`, told by their leading bytes alone (ADR-064); undefined for
 * anything else, SVG included. The request's content type and file name are never trusted.
 */
export function sniffImageType(bytes: Uint8Array): AssetType | undefined {
  const starts = (offset: number, ...expected: number[]) =>
    bytes.length >= offset + expected.length &&
    expected.every((byte, i) => bytes[offset + i] === byte);
  const ascii = (offset: number, text: string) => starts(offset, ...Buffer.from(text, 'latin1'));

  if (starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return undefined;
}

/** Where an asset's file lives: `DATA_DIR/assets/<table id>/<asset id>`, no extension. */
export const assetFile = (dataDir: string, asset: Pick<Asset, 'tableId' | 'id'>): string =>
  path.join(dataDir, 'assets', asset.tableId, asset.id);

export function toAssetView(asset: Asset): AssetView {
  return {
    id: asset.id,
    tableId: asset.tableId,
    uploaderId: asset.uploaderId,
    name: asset.name,
    type: asset.type,
    size: asset.size,
    url: assetPath(asset.id),
    createdAt: asset.createdAt.toISOString(),
  };
}

export interface UploadLimits {
  maxUploadBytes: number;
  assetQuotaBytes: number;
}

/**
 * Stores an upload as a table asset: checks its type and the limits, writes the file, then
 * the row. The quota check and the insert share a transaction, so two uploads cannot both
 * pass it; the file is removed again if the row is not written.
 */
export function storeAsset(
  db: Db,
  dataDir: string,
  upload: { tableId: string; uploaderId: string; name: string; bytes: Buffer; now: Date },
  limits: UploadLimits,
): Asset {
  const { bytes } = upload;
  const type = sniffImageType(bytes);
  if (!type) {
    throw new AppError(
      415,
      'unsupported_asset_type',
      'Upload a PNG, JPEG, GIF or WebP image. Other files, SVG included, are refused.',
    );
  }
  if (bytes.length > limits.maxUploadBytes) {
    throw new AppError(
      413,
      'asset_too_large',
      `The image is larger than the ${mebibytes(limits.maxUploadBytes)} upload limit.`,
    );
  }

  const asset: Asset = {
    id: generateId(),
    tableId: upload.tableId,
    uploaderId: upload.uploaderId,
    name: upload.name,
    type,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    createdAt: upload.now,
  };
  // Checked again below, with the insert; this spares writing a file that cannot be kept.
  requireRoom(db, asset.size, limits.assetQuotaBytes);
  const file = assetFile(dataDir, asset);
  mkdirSync(path.dirname(file), { recursive: true });
  // Written whole under another name first, so a reader never sees half a file.
  const partial = `${file}.part`;
  writeFileSync(partial, bytes, { flag: 'wx' });
  try {
    renameSync(partial, file);
    db.transaction((tx) => {
      requireRoom(tx, asset.size, limits.assetQuotaBytes);
      tx.insert(assets).values(asset).run();
    });
  } catch (error) {
    rmSync(partial, { force: true });
    rmSync(file, { force: true });
    throw error;
  }
  return asset;
}

/** Refuses an upload of `size` bytes that would take the instance's assets past the quota. */
function requireRoom(db: DbOrTx, size: number, quota: number): void {
  const used = db
    .select({ total: sql<number>`coalesce(sum(${assets.size}), 0)` })
    .from(assets)
    .get();
  if ((used?.total ?? 0) + size > quota) {
    throw new AppError(
      413,
      'asset_quota_exceeded',
      `The instance's ${mebibytes(quota)} for images is used up. Ask an admin to raise the quota.`,
    );
  }
}

/** A table's assets, newest first. */
export function listAssets(db: Db, tableId: string): Asset[] {
  return db
    .select()
    .from(assets)
    .where(eq(assets.tableId, tableId))
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .all();
}

export function findAsset(db: Db, id: string): Asset | undefined {
  return db.select().from(assets).where(eq(assets.id, id)).get();
}

export function requireAsset(db: Db, id: string): Asset {
  const asset = findAsset(db, id);
  if (!asset) throw notFound('Asset not found.');
  return asset;
}

const mebibytes = (bytes: number) => `${String(Math.round(bytes / (1024 * 1024)))} MiB`;

/**
 * An image field may name one of the table's own assets, or any `http(s)` URL (ADR-065). An
 * asset of another table, or one that is gone, is refused: its members could not see it.
 */
export function requireTableImage(
  db: DbOrTx,
  tableId: string,
  imageUrl: string | null | undefined,
): void {
  const id = imageUrl ? assetIdOf(imageUrl) : undefined;
  if (id === undefined) return;
  const asset = db.select({ tableId: assets.tableId }).from(assets).where(eq(assets.id, id)).get();
  if (asset?.tableId !== tableId) {
    throw unprocessable('unknown_asset', "The image is not one of this table's assets.");
  }
}

/** The root fragment of a journal entry's body (ADR-038), as the web editor names it. */
const JOURNAL_BODY = 'body';

/** Whether rich text holds an image of `src`, at any depth. */
function hasImage(node: Y.XmlFragment, src: string): boolean {
  return node.toArray().some((child) => {
    if (!(child instanceof Y.XmlElement)) return false;
    if (child.nodeName === 'image' && child.getAttribute('src') === src) return true;
    return hasImage(child, src);
  });
}

/**
 * Where an asset is used in its table (ADR-065): actor and item images, images in their plugin
 * data (`image` fields, read from live documents while loaded, else from the projection),
 * scene backgrounds (ADR-066) and images in journal text. Entities in the trash count, so restoring one never shows a
 * missing image. Journal bodies are read from their live documents while loaded too, so edits
 * not saved yet count.
 */
export function assetUses(db: DbOrTx, asset: Asset, live: ReadonlyMap<string, Y.Doc>): AssetUse[] {
  const url = assetPath(asset.id);
  // A field holding the path, as stored JSON or a live document's data writes it.
  const quoted = `"${url}"`;
  const uses: AssetUse[] = [];
  const add = (use: AssetUse) => {
    if (!uses.some((known) => known.kind === use.kind && known.id === use.id)) uses.push(use);
  };

  const loaded = { actor: [] as string[], item: [] as string[] };
  for (const [name, doc] of live) {
    const ref = parseDocumentName(name);
    if (ref?.kind !== 'actor' && ref?.kind !== 'item') continue;
    if (JSON.stringify(doc.getMap(DATA_MAP).toJSON()).includes(quoted))
      loaded[ref.kind].push(ref.id);
  }
  const inSystem = (column: typeof actors.system | typeof items.system) =>
    sql`${column} like ${`%${quoted}%`}`;
  for (const actor of db
    .select({ id: actors.id, name: actors.name })
    .from(actors)
    .where(
      and(
        eq(actors.tableId, asset.tableId),
        or(eq(actors.imageUrl, url), inSystem(actors.system), inArray(actors.id, loaded.actor)),
      ),
    )
    .orderBy(asc(actors.name))
    .all()) {
    add({ kind: 'actor', ...actor });
  }
  for (const item of db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(
      and(
        eq(items.tableId, asset.tableId),
        or(eq(items.imageUrl, url), inSystem(items.system), inArray(items.id, loaded.item)),
      ),
    )
    .orderBy(asc(items.name))
    .all()) {
    add({ kind: 'item', ...item });
  }
  for (const scene of db
    .select({ id: scenes.id, name: scenes.name })
    .from(scenes)
    .where(and(eq(scenes.tableId, asset.tableId), eq(scenes.backgroundUrl, url)))
    .orderBy(asc(scenes.name))
    .all()) {
    add({ kind: 'scene', ...scene });
  }
  const entries = db
    .select({ id: journalEntries.id, name: journalEntries.title, state: ydocs.state })
    .from(journalEntries)
    .leftJoin(ydocs, eq(ydocs.journalEntryId, journalEntries.id))
    .where(eq(journalEntries.tableId, asset.tableId))
    .all();
  for (const entry of entries) {
    const open = live.get(documentName({ kind: 'journal', id: entry.id, layer: 'main' }));
    const doc = open ?? new Y.Doc();
    if (!open && entry.state) Y.applyUpdate(doc, entry.state);
    const used = hasImage(doc.getXmlFragment(JOURNAL_BODY), url);
    if (!open) doc.destroy();
    if (used) uses.push({ kind: 'journal', id: entry.id, name: entry.name });
  }
  return uses;
}

/** Deletes an asset no one uses: its row, then its file (ADR-065). */
export function deleteAsset(
  db: Db,
  dataDir: string,
  asset: Asset,
  live: ReadonlyMap<string, Y.Doc>,
): void {
  const uses = assetUses(db, asset, live);
  if (uses.length > 0) {
    throw new AppError(409, 'asset_in_use', 'The image is still used, so it was not deleted.', {
      uses,
    });
  }
  db.delete(assets).where(eq(assets.id, asset.id)).run();
  rmSync(assetFile(dataDir, asset), { force: true });
}
