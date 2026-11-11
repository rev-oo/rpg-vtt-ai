import { useSyncExternalStore } from 'react';

/** The token a member has selected on the map, as card actions act on it (T-1617). */
export interface SelectedToken {
  tokenId: string;
  /** `null` for a token whose actor is gone. */
  actorId: string | null;
  name: string;
}

// One selection per table, shared by the map and the chat, which are separate panels.
const selections = new Map<string, SelectedToken>();
const listeners = new Set<() => void>();

const same = (a: SelectedToken | undefined, b: SelectedToken | null): boolean =>
  (a ?? null) === b ||
  (a !== undefined &&
    b !== null &&
    a.tokenId === b.tokenId &&
    a.actorId === b.actorId &&
    a.name === b.name);

/** Records the map's selection at a table; `null` when nothing is selected. */
export function setSelectedToken(tableId: string, token: SelectedToken | null): void {
  if (same(selections.get(tableId), token)) return;
  if (token) selections.set(tableId, token);
  else selections.delete(tableId);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The token selected on the map at a table, kept up to date. */
export function useSelectedToken(tableId: string): SelectedToken | null {
  return useSyncExternalStore(subscribe, () => selections.get(tableId) ?? null);
}
