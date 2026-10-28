import { createContext, use } from 'react';

/** What the dockview panels need beyond the table's data (ADR-059). */
export interface DockContextValue {
  userId: string;
  /** The actor of the sheet used last, which the dice panel rolls as. */
  diceActorId: string | null;
  /** Saves the layout after a change dockview does not report, such as a panel's filters. */
  save: () => void;
}

export const DockContext = createContext<DockContextValue | null>(null);

/** Only usable in a workspace panel; they render through portals below `Workspace`. */
export function useDock(): DockContextValue {
  const value = use(DockContext);
  if (!value) throw new Error('useDock used outside the table workspace');
  return value;
}
