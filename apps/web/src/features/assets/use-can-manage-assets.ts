import { isGmLike } from '@vtt/shared';

import { useTableData } from '../table/table-data.js';

/** GMs and assistants of a table that is not archived upload and delete images (ADR-064). */
export function useCanManageAssets(): boolean {
  const { table } = useTableData();
  return isGmLike(table.role) && table.archivedAt === null;
}
