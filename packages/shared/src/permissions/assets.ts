import type { TableRole } from '../roles.js';

import { isGmLike, type Subject } from './ownership.js';

/**
 * Who uploads images to a table (FR-ASSET-01, ADR-085): GMs, assistants and players.
 * Spectators edit nothing, so they upload nothing.
 */
export function canUploadAssets(role: TableRole): boolean {
  return role !== 'spectator';
}

/**
 * Who lists an image in the Images panel and the image picker, and deletes it (ADR-085): GMs
 * and assistants every image of the table, others the images they uploaded themselves.
 * Serving is not limited this way: any member may load an image they come across in use.
 */
export function canManageAsset(subject: Subject, asset: { uploaderId: string | null }): boolean {
  return isGmLike(subject.role) || asset.uploaderId === subject.userId;
}
