import { canUploadAssets } from '@vtt/shared';

import { useTableData } from '../table/table-data.js';

/**
 * GMs, assistants and players of a table that is not archived upload images, and delete the
 * ones they are listed: GMs and assistants every image, players their own (ADR-085).
 */
export function useCanManageAssets(): boolean {
  const { table } = useTableData();
  return canUploadAssets(table.role) && table.archivedAt === null;
}
