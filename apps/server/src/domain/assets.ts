import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { desc, eq, sql } from 'drizzle-orm';

import { assetPath, type AssetType, type AssetView } from '@vtt/shared/api';

import type { Db, DbOrTx } from '../db/client.js';
import { assets } from '../db/schema.js';
import { AppError, notFound } from '../errors.js';

import { generateId } from './auth/tokens.js';

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
