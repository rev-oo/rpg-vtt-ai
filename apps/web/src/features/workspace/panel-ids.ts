/**
 * The workspace's panels (ADR-059). Tools are single panels around the stage; sheets and
 * journal entries are documents, and many can be open at once.
 */
export const TOOL_PANELS = ['actors', 'items', 'journal', 'combat', 'chat', 'dice'] as const;
export type ToolPanel = (typeof TOOL_PANELS)[number];

/** Documents opened from the Panels menu; sheets and entries open from the lists. */
export const PAGE_PANELS = ['overview', 'members', 'settings'] as const;
export type PagePanel = (typeof PAGE_PANELS)[number];

export const LIST_PANELS = ['actors', 'items', 'journal'] as const;

export const sheetPanelId = (actorId: string): string => `actor:${actorId}`;
export const entryPanelId = (entryId: string): string => `entry:${entryId}`;

/** A document or page a component asks the workspace to open. */
export type PanelTarget =
  | { kind: 'sheet'; id: string; actorId: string }
  | { kind: 'entry'; id: string; entryId: string }
  | { kind: 'page'; id: PagePanel };

/** Sheets, entries and pages open in the centre; tools keep to the sides. */
export const isDocument = (panelId: string): boolean =>
  (PAGE_PANELS as readonly string[]).includes(panelId) ||
  panelId.startsWith('actor:') ||
  panelId.startsWith('entry:');
