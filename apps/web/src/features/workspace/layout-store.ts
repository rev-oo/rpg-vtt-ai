import { useState } from 'react';
import { z } from 'zod';

/** The lists the browse panel shows (ADR-059). */
export const PANEL_TABS = ['actors', 'items', 'journal'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

/** Panel widths in pixels; the stage takes the rest. */
export const PANEL_MIN = 240;
export const PANEL_MAX = 640;

const width = z.number().int().min(PANEL_MIN).max(PANEL_MAX);

/** How one user arranges one table's workspace, kept in this browser. */
const layoutSchema = z.object({
  browseOpen: z.boolean().catch(true),
  chatOpen: z.boolean().catch(true),
  browseWidth: width.catch(320),
  chatWidth: width.catch(384),
  panel: z.enum(PANEL_TABS).catch('actors'),
});
export type WorkspaceLayout = z.infer<typeof layoutSchema>;

export const DEFAULT_LAYOUT: WorkspaceLayout = layoutSchema.parse({});

export const layoutKey = (userId: string, tableId: string): string =>
  `vtt:workspace:${userId}:${tableId}`;

/** The stored layout; the defaults when there is none, or storage is unavailable. */
export function readLayout(key: string): WorkspaceLayout {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return DEFAULT_LAYOUT;
    const parsed: unknown = JSON.parse(stored);
    return layoutSchema.parse(typeof parsed === 'object' && parsed !== null ? parsed : {});
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeLayout(key: string, layout: WorkspaceLayout): void {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // A private window or blocked storage: the layout lasts until the page closes.
  }
}

/** The workspace layout of `tableId` for `userId`, saved as it changes. */
export function useWorkspaceLayout(
  userId: string,
  tableId: string,
): [WorkspaceLayout, (patch: Partial<WorkspaceLayout>) => void] {
  const key = layoutKey(userId, tableId);
  const [state, setState] = useState(() => ({ key, layout: readLayout(key) }));
  // Another table (or user) in the same component: start from what it stored.
  const current = state.key === key ? state.layout : readLayout(key);
  if (state.key !== key) setState({ key, layout: current });

  const update = (patch: Partial<WorkspaceLayout>) => {
    setState((now) => {
      const layout = { ...(now.key === key ? now.layout : readLayout(key)), ...patch };
      writeLayout(key, layout);
      return { key, layout };
    });
  };
  return [current, update];
}
