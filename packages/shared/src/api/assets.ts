import { z } from 'zod';

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

export const assetResponseSchema = z.object({ asset: assetSchema });
export const assetListResponseSchema = z.object({ assets: z.array(assetSchema) });
