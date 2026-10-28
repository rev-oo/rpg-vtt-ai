/**
 * The workspace's panels (ADR-059). Tools are single panels around the stage; documents
 * have a URL, and sheets and journal entries can be open many at once.
 */
export const TOOL_PANELS = ['actors', 'items', 'journal', 'combat', 'chat', 'dice'] as const;
export type ToolPanel = (typeof TOOL_PANELS)[number];

/** Documents opened from the Panels menu; sheets and entries open from the lists. */
export const PAGE_PANELS = ['overview', 'members', 'settings'] as const;
export type PagePanel = (typeof PAGE_PANELS)[number];

export const LIST_PANELS = ['actors', 'items', 'journal'] as const;

export const sheetPanelId = (actorId: string): string => `actor:${actorId}`;
export const entryPanelId = (entryId: string): string => `entry:${entryId}`;

/** What a table URL asks the workspace to show. */
export type PanelTarget =
  | { kind: 'sheet'; id: string; actorId: string }
  | { kind: 'entry'; id: string; entryId: string }
  | { kind: 'page'; id: PagePanel }
  /** An old list URL (`/items`, `/journal`): show the list, then drop the path. */
  | { kind: 'list'; id: 'items' | 'journal' };

/** The target of the path after `/tables/:id/`; `null` for the table itself or no panel. */
export function targetOf(subpath: string): PanelTarget | null {
  const [section, id, ...rest] = subpath.split('/').filter(Boolean);
  if (rest.length > 0) return null;
  if (section === 'actors' && id) return { kind: 'sheet', id: sheetPanelId(id), actorId: id };
  if (section === 'journal' && id) return { kind: 'entry', id: entryPanelId(id), entryId: id };
  if (id !== undefined) return null;
  if (section === 'members' || section === 'settings') return { kind: 'page', id: section };
  if (section === 'items' || section === 'journal') return { kind: 'list', id: section };
  return null;
}

/** The URL of a document panel; `null` for tools, which leave the URL alone. */
export function pathOf(tableId: string, panelId: string): string | null {
  const base = `/tables/${tableId}`;
  if (panelId === 'overview') return base;
  if (panelId === 'members' || panelId === 'settings') return `${base}/${panelId}`;
  if (panelId.startsWith('actor:')) return `${base}/actors/${panelId.slice('actor:'.length)}`;
  if (panelId.startsWith('entry:')) return `${base}/journal/${panelId.slice('entry:'.length)}`;
  return null;
}

export const isDocument = (panelId: string): boolean => pathOf('_', panelId) !== null;
