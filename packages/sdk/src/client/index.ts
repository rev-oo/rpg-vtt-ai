import { createContext, useContext, type ComponentType } from 'react';

import type { Value } from '@vtt/formula';
import type { RecipeCard, Roll, Speaker } from '@vtt/shared/api';

// What plugin client code may use (specs §8.10): hooks into the sheet it renders in, and
// `defineClient` to declare its custom nodes and cards. It gets no sockets and no API client.

/** The entity a sheet shows. */
export interface SheetActor {
  id: string;
  name: string;
  type: string;
}

/**
 * The sheet a custom node renders in, as the host provides it. Paths are dot paths; inside a
 * `list` they are relative to the node's row.
 */
export interface ClientSheet {
  actor: SheetActor | null;
  readOnly: boolean;
  get: (path: string) => unknown;
  /** Ignored while read-only. */
  set: (path: string, value: unknown) => void;
  adjust: (path: string, delta: number) => void;
  derived: (key: string) => Value | undefined;
  translate: (text: string) => string;
}

export const ClientSheetContext = createContext<ClientSheet | null>(null);

function useSheetContext(hook: string): ClientSheet {
  const sheet = useContext(ClientSheetContext);
  if (!sheet) throw new Error(`${hook}() only works inside a plugin sheet node`);
  return sheet;
}

/** A field's value and a setter (FR-SHEET-01); the setter does nothing while read-only. */
export function useField(path: string): [value: unknown, set: (value: unknown) => void] {
  const sheet = useSheetContext('useField');
  return [
    sheet.get(path),
    (value) => {
      if (!sheet.readOnly) sheet.set(path, value);
    },
  ];
}

/** A derived value of the sheet's entity (FR-SHEET-05), or undefined if it failed. */
export function useDerived(key: string): Value | undefined {
  return useSheetContext('useDerived').derived(key);
}

/** The entity the sheet shows. */
export function useActor(): SheetActor | null {
  return useSheetContext('useActor').actor;
}

/** Translates the plugin's lang keys into the viewer's language. */
export function useTranslate(): (text: string) => string {
  return useSheetContext('useTranslate').translate;
}

/** What a `custom:<name>` node receives. */
export interface NodeProps {
  props: Readonly<Record<string, unknown>>;
}

/** What a custom card receives: the message's recipe roll, resolved on the server. */
export interface CardProps {
  card: RecipeCard;
  rolls: readonly Roll[];
  speaker: Speaker;
  translate: (text: string) => string;
}

/** The default export of `code/client.js`. */
export interface ClientDefinition {
  /** Components for `custom:<name>` sheet nodes. */
  nodes?: Readonly<Record<string, ComponentType<NodeProps>>>;
  /** Components that replace the core rendering of `cards/<name>.json`. */
  cards?: Readonly<Record<string, ComponentType<CardProps>>>;
}

/** Declares a plugin's client code; it returns its argument, typed. */
export function defineClient(definition: ClientDefinition): ClientDefinition {
  return definition;
}
