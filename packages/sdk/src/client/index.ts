import { createContext, useContext, useEffect, useRef, type ComponentType } from 'react';

import type { Value } from '@vtt/formula';
import type { Audience, TableRole } from '@vtt/shared';
import type { ChatMessage, EncounterView, RecipeCard, Roll, Speaker } from '@vtt/shared/api';

// What plugin client code may use (specs §8.10): hooks into the sheet it renders in, hooks for
// module overlays and panels (ADR-077), and `defineClient` to declare its components. It gets
// no sockets and no API client: modules act through the host, as the viewer.

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
  const module = useContext(ModuleFrameContext);
  if (module) return module.translate;
  return useSheetContext('useTranslate').translate;
}

/**
 * What a module's overlay or panel hears of its table (ADR-077): only what the viewer sees,
 * after the server decided it. Rolls arrive inside chat messages, with their dice and results.
 * Scenes, tokens and combat say only that they changed.
 */
export type TableEvent =
  | { type: 'chat.message'; message: ChatMessage }
  | { type: 'chat.updated'; message: ChatMessage }
  | { type: 'chat.deleted'; id: string }
  | { type: 'combat.updated' }
  | { type: 'scene.updated' }
  | { type: 'token.updated'; sceneId: string };

/** Who views the table the module runs in. */
export interface Viewer {
  id: string;
  role: TableRole;
}

/** A message or roll's audience and speaker, as in the chat. */
export interface PostOptions {
  audience?: Audience;
  /** Whisper recipients (user ids). */
  recipientIds?: string[];
  /** Speak as one of the viewer's actors. */
  actorId?: string | null;
}

/** The combat actions a frame may ask for; only GMs and assistants may take them. */
export const COMBAT_ACTIONS = ['start', 'end', 'next', 'previous', 'initiative'] as const;
export type CombatAction = (typeof COMBAT_ACTIONS)[number];

/**
 * What a module may do, as the viewer: the server checks each like the viewer's own, and the
 * app limits how often a frame acts. Each rejects with the reason when refused.
 */
export interface ModuleActions {
  sendChat: (text: string, options?: PostOptions) => Promise<void>;
  /** Rolls a formula; the result arrives as a `chat.message` event. */
  roll: (formula: string, options?: PostOptions) => Promise<void>;
  openSheet: (actorId: string) => Promise<void>;
  openJournal: (entryId: string) => Promise<void>;
  combat: (action: CombatAction) => Promise<void>;
  /** The table's encounter as the viewer sees it, or null. */
  encounter: () => Promise<EncounterView | null>;
}

/** A face of a system die: the text it shows, and the number it counts as. */
export interface SystemDieFace {
  label: string;
  value: number;
}

/**
 * One of the table system's custom dice (its `dice.json`), by the name rolls give it, such as
 * `dF`. Standard dice are named `d<sides>` and are not listed.
 */
export interface SystemDie {
  /** Its name, translated for the viewer. */
  label: string;
  /** Its faces, equally likely, in the system's order. */
  faces: readonly SystemDieFace[];
}

/** The table a module's frame runs in, as the host provides it. */
export interface ModuleFrame {
  tableId: string;
  viewer: Viewer;
  /** Every setting's value for the viewer: instance, table or user, by its scope. */
  settings: Readonly<Record<string, Value>>;
  /** The table system's custom dice by name; empty until the system loads, or if it has none. */
  dice: Readonly<Record<string, SystemDie>>;
  /** Changes one of the viewer's own (`user`) settings. */
  setSetting: (name: string, value: Value) => Promise<void>;
  /** Calls `listener` with each table event; returns a function that stops it. */
  listen: (listener: (event: TableEvent) => void) => () => void;
  actions: ModuleActions;
  translate: (text: string) => string;
}

export const ModuleFrameContext = createContext<ModuleFrame | null>(null);

function useModuleFrame(hook: string): ModuleFrame {
  const frame = useContext(ModuleFrameContext);
  if (!frame) throw new Error(`${hook}() only works inside a module overlay or panel`);
  return frame;
}

/** Calls `listener` with each event of the table, while the component is mounted. */
export function useTableEvents(listener: (event: TableEvent) => void): void {
  const frame = useModuleFrame('useTableEvents');
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(
    () =>
      frame.listen((event) => {
        latest.current(event);
      }),
    [frame],
  );
}

/** The module's settings for the viewer, and a setter for the viewer's own (`user`) ones. */
export function useModuleSettings(): [
  settings: Readonly<Record<string, Value>>,
  set: (name: string, value: Value) => Promise<void>,
] {
  const frame = useModuleFrame('useModuleSettings');
  return [frame.settings, frame.setSetting];
}

/** The viewer and the table. */
export function useViewer(): Viewer & { tableId: string } {
  const frame = useModuleFrame('useViewer');
  return { ...frame.viewer, tableId: frame.tableId };
}

/**
 * The table system's custom dice by name (`dF`…), so a module can draw them. A roll's results
 * name their die (`d20`, `dF`) and, for custom dice, the face's label.
 */
export function useSystemDice(): Readonly<Record<string, SystemDie>> {
  return useModuleFrame('useSystemDice').dice;
}

/** What the module may do as the viewer. */
export function useActions(): ModuleActions {
  return useModuleFrame('useActions').actions;
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

/**
 * A module's overlay, drawn over the whole table page. `plugin.json` declares it under
 * `frames.overlays`, with whether it takes the pointer (T-1612).
 */
export interface OverlayDefinition {
  component: ComponentType;
}

/**
 * A module's panel, which the viewer opens from the Panels menu. `plugin.json` declares it
 * under `frames.panels`, with its title (T-1612).
 */
export interface PanelDefinition {
  component: ComponentType;
}

/** The default export of `code/client.js`. */
export interface ClientDefinition {
  /** Components for `custom:<name>` sheet nodes. */
  nodes?: Readonly<Record<string, ComponentType<NodeProps>>>;
  /** Components that replace the core rendering of `cards/<name>.json`. */
  cards?: Readonly<Record<string, ComponentType<CardProps>>>;
  /** A module's overlays, over the table page (ADR-077); each declared in `plugin.json`. */
  overlays?: Readonly<Record<string, OverlayDefinition>>;
  /** A module's panels in the table workspace (ADR-077); each declared in `plugin.json`. */
  panels?: Readonly<Record<string, PanelDefinition>>;
}

/** Declares a plugin's client code; it returns its argument, typed. */
export function defineClient(definition: ClientDefinition): ClientDefinition {
  return definition;
}
