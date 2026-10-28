import { createContext, use } from 'react';

import type { PanelTarget } from './panel-ids.js';

/** What the dockview panels need beyond the table's data (ADR-059). */
export interface DockContextValue {
  userId: string;
  /** The actor of the sheet used last, which the dice panel rolls as. */
  diceActorId: string | null;
  /** Saves the layout after a change dockview does not report, such as a panel's filters. */
  save: () => void;
  /** Opens a sheet, journal entry or page as a panel, or brings it to the front. */
  open: (target: PanelTarget) => void;
}

export const DockContext = createContext<DockContextValue | null>(null);

/** The workspace around a component, if any. */
export function useOptionalDock(): DockContextValue | null {
  return use(DockContext);
}

/** Only usable in a workspace panel; they render through portals below `Workspace`. */
export function useDock(): DockContextValue {
  const value = use(DockContext);
  if (!value) throw new Error('useDock used outside the table workspace');
  return value;
}
