// Module panels and overlays in the workspace (T-1603, ADR-077).

/** A module panel's dock id: one panel per module and panel name. */
export const modulePanelId = (moduleId: string, name: string): string =>
  `module:${moduleId}:${name}`;
export const MODULE_PREFIX = 'module:';

/** Where the viewer's choice to hide a table's overlays is kept, in this browser. */
const overlaysKey = (userId: string, tableId: string) => `vtt:overlays:${userId}:${tableId}`;

/** Whether the viewer shows the table's overlays; on unless they turned them off. */
export function overlaysShown(userId: string, tableId: string): boolean {
  try {
    return localStorage.getItem(overlaysKey(userId, tableId)) !== 'off';
  } catch {
    return true;
  }
}

export function setOverlaysShown(userId: string, tableId: string, shown: boolean): void {
  try {
    if (shown) localStorage.removeItem(overlaysKey(userId, tableId));
    else localStorage.setItem(overlaysKey(userId, tableId), 'off');
  } catch {
    // Without storage the choice lasts until the page closes.
  }
}
