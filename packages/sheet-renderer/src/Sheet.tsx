import { useMemo, useSyncExternalStore, type ComponentType, type ReactElement } from 'react';

import type { FormulaFunction, Value } from '@vtt/formula';
import { computeDerived, withDefaults } from '@vtt/plugin-engine';
import type { FieldSchema, SheetNode } from '@vtt/plugin-schema';
import { cn } from '@vtt/ui';

import {
  SheetContext,
  type CustomNodeProps,
  type RollHandler,
  type SheetEnvironment,
} from './context.js';
import { SheetNodeView } from './nodes.js';
import type { SheetPresence } from './presence.js';
import type { SheetStore } from './store.js';
import { DEFAULT_STRINGS, type SheetStrings } from './strings.js';

export interface SheetProps {
  /** Scopes the plugin's CSS to this sheet (ADR-021). */
  pluginId: string;
  layout: SheetNode;
  /** The entity's type: its data schema and derived values. */
  type: { schema: FieldSchema; derived?: Readonly<Record<string, string>> | undefined };
  store: SheetStore;
  /** The table's setting values (`settingValues()` of the plugin engine). */
  settings?: Readonly<Record<string, Value>>;
  /** The plugin's `shared` functions. */
  functions?: Readonly<Record<string, FormulaFunction>>;
  /** Observers see the sheet without inputs (FR-SHEET-03); roll buttons follow `onRoll`. */
  readOnly?: boolean;
  /** Whether the viewer sees secret fields (FR-SHEET-04); the server sends them only then. */
  secret?: boolean;
  /** Turns plugin texts (lang keys or literal text) into what the viewer reads. */
  translate?: (text: string) => string;
  strings?: Partial<SheetStrings>;
  onRoll?: RollHandler;
  /** The plugin's custom nodes by name (`custom:<name>`). */
  nodes?: Readonly<Record<string, ComponentType<CustomNodeProps>>>;
  /** Other viewers' focus, outlined on their fields (FR-SHEET-02). */
  presence?: SheetPresence;
  className?: string;
}

const identity = (text: string): string => text;

/**
 * Renders a plugin sheet (specs §8.5) against a store. Missing data reads as the schema's
 * defaults and derived values are computed on every change (FR-SHEET-05), never stored.
 */
export function Sheet({
  pluginId,
  layout,
  type,
  store,
  settings = {},
  functions = {},
  readOnly = false,
  secret = false,
  translate = identity,
  strings,
  onRoll,
  nodes = {},
  presence,
  className,
}: SheetProps): ReactElement {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const data = useMemo(() => withDefaults(type.schema, snapshot), [type.schema, snapshot]);
  const derived = useMemo(
    () => computeDerived(type.derived ?? {}, data, { settings, functions }),
    [type.derived, data, settings, functions],
  );
  const sheet: SheetEnvironment = {
    store,
    schema: type.schema,
    data,
    derived,
    settings,
    functions,
    readOnly,
    secret,
    translate,
    strings: { ...DEFAULT_STRINGS, ...strings },
    onRoll,
    nodes,
    presence,
  };

  return (
    <SheetContext.Provider value={sheet}>
      <div
        data-plugin={pluginId}
        data-readonly={readOnly || undefined}
        className={cn('vtt-sheet @container flex min-w-0 flex-col gap-(--vtt-gap-md)', className)}
      >
        <SheetNodeView node={layout} />
      </div>
    </SheetContext.Provider>
  );
}
