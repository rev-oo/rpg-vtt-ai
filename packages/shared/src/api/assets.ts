import { z } from 'zod';

import { MAX_IMAGE_URL } from './constants.js';

// Table assets (FR-ASSET-01, ADR-064): images uploaded to a table and served to its members.

export const MIB = 1024 * 1024;
/** The upload limit admins may set, and the upload route's body limit. */
export const MIN_UPLOAD_BYTES = MIB;
export const MAX_UPLOAD_BYTES = 100 * MIB;
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * MIB;
/** The instance's quota for all assets together. */
export const MIN_ASSET_QUOTA_BYTES = MIB;
export const MAX_ASSET_QUOTA_BYTES = 1024 * 1024 * MIB;
export const DEFAULT_ASSET_QUOTA_BYTES = 1024 * MIB;
export const MAX_ASSET_NAME = 120;

/** The image types an upload may be, told by its bytes; SVG is refused (ADR-064). */
export const ASSET_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** The path an asset is served at, which image fields hold (ADR-064). */
export const assetPath = (id: string): string => `/api/v1/assets/${id}`;

const ASSET_PATH =
  /^\/api\/v1\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The asset id an image URL names, if it is an asset's path (ADR-065). */
export function assetIdOf(url: string): string | undefined {
  return ASSET_PATH.exec(url)?.[1];
}

/** An image field's value: an `http(s)` URL, or the path of one of the table's assets. */
export const imageUrlSchema = z.union([
  z.url({ protocol: /^https?$/ }).max(MAX_IMAGE_URL),
  z.string().regex(ASSET_PATH),
]);

/** `POST /tables/:id/assets?name=`: the image is the raw request body. */
export const uploadAssetQuery = z.object({
  /** The file's name, shown in the asset manager. */
  name: z.string().trim().min(1).max(MAX_ASSET_NAME).default('image'),
});
export type UploadAssetQuery = z.input<typeof uploadAssetQuery>;

export const assetSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  /** `null` once the uploader's account is deleted. */
  uploaderId: z.string().nullable(),
  name: z.string(),
  type: z.enum(ASSET_TYPES),
  /** In bytes. */
  size: z.number().int(),
  /** Where it is served: `/api/v1/assets/<id>`. */
  url: z.string(),
  createdAt: z.string(),
});
export type AssetView = z.infer<typeof assetSchema>;

/** Where an asset is used, which keeps it from being deleted (ADR-065). */
export const ASSET_USE_KINDS = ['actor', 'item', 'journal'] as const;
export const assetUseSchema = z.object({
  kind: z.enum(ASSET_USE_KINDS),
  id: z.string(),
  name: z.string(),
});
export type AssetUse = z.infer<typeof assetUseSchema>;
/** The `details` of a `409 asset_in_use`. */
export const assetInUseDetailsSchema = z.object({ uses: z.array(assetUseSchema) });

export const assetResponseSchema = z.object({ asset: assetSchema });
export const assetListResponseSchema = z.object({ assets: z.array(assetSchema) });
