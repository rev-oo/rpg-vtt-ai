import type { TableView } from '@vtt/shared/api';

/** Whether the table plays another version of its system than the installed one (ADR-058). */
export const upgradeAvailable = (table: TableView): boolean =>
  table.installedVersion !== null && table.installedVersion !== table.systemVersion;
