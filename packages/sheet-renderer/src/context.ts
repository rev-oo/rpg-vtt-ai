import { createContext, useContext, type ComponentType, type ReactNode } from 'react';

import type { FormulaFunction, Value } from '@vtt/formula';
import type { DerivedValues } from '@vtt/plugin-engine';
import type { FieldSchema, SheetNode } from '@vtt/plugin-schema';

import type { SheetPresence } from './presence.js';
import type { FieldPath, SheetStore } from './store.js';
import type { SheetStrings } from './strings.js';

/** Where a node inside a `list` row reads from: its row, by id. */
export interface RowScope {
  /** The row's path: the list's path plus the row id. */
  path: FieldPath;
  /** The schema of the list's rows. */
  schema: FieldSchema | undefined;
  /** The row's data with its id, read by `@row.*`. */
  row: Readonly<Record<string, unknown>>;
}

/** What a `custom:<name>` node receives (specs §8.10). */
export interface CustomNodeProps {
  props: Readonly<Record<string, unknown>>;
  /** Set inside a `list`: the row the node sits in. */
  rowPath?: FieldPath;
}

export type RollHandler = (roll: string, args: Readonly<Record<string, Value>>) => void;

/** What the host's rich text editor receives for a `richText` field (ADR-037). */
export interface RichTextProps {
  path: FieldPath;
  /** The id of the field's label, for `aria-labelledby`. */
  labelId: string;
  readOnly: boolean;
  className: string;
}

/**
 * Renders the editor of a `richText` field. The host provides it, so the renderer stays free
 * of Yjs and of the editor; without it the field is a plain text area.
 */
export type RichTextRenderer = (props: RichTextProps) => ReactNode;

/** The item a row of an `items` node shows, read by `@item.*` (ADR-063). */
export interface SheetItemRef {
  id: string;
  name: string;
  type: string;
}

/** What the host's `items` node receives: the node, to lay out each item with `ItemRow`. */
export interface ItemsNodeProps {
  node: Extract<SheetNode, { type: 'items' }>;
}

/**
 * Renders an `items` node (FR-SHEET-12). The host lists the actor's items and opens their
 * documents, so the renderer stays free of the network; without it the node shows nothing.
 */
export type ItemsRenderer = (props: ItemsNodeProps) => ReactNode;

export interface SheetEnvironment {
  store: SheetStore;
  schema: FieldSchema;
  /** The store's data with defaults filled in. */
  data: Readonly<Record<string, unknown>>;
  derived: DerivedValues;
  /** `@items.*`: the actor's item totals (ADR-063). */
  itemTotals: Readonly<Record<string, Value>>;
  /**
   * Inside an item's row, the actor's data: formulas still read the actor, while fields
   * (`data`, `store`, `schema`) are the item's.
   */
  holderData?: Readonly<Record<string, unknown>> | undefined;
  /** Inside an item's row, the item (`@item.*`). */
  item?: SheetItemRef | undefined;
  settings: Readonly<Record<string, Value>>;
  functions: Readonly<Record<string, FormulaFunction>>;
  readOnly: boolean;
  /** Whether the viewer sees the secret layer (GM and assistants, FR-SHEET-04). */
  secret: boolean;
  translate: (text: string) => string;
  strings: SheetStrings;
  onRoll: RollHandler | undefined;
  nodes: Readonly<Record<string, ComponentType<CustomNodeProps>>>;
  /** Other viewers' focus, on live sheets (FR-SHEET-02). */
  presence: SheetPresence | undefined;
  renderRichText: RichTextRenderer | undefined;
  renderItems: ItemsRenderer | undefined;
}

export const SheetContext = createContext<SheetEnvironment | null>(null);

/** The sheet a node renders in; custom nodes can read it too. */
export function useSheet(): SheetEnvironment {
  const sheet = useContext(SheetContext);
  if (!sheet) throw new Error('useSheet() is only available inside <Sheet>');
  return sheet;
}

/**
 * The data formulas in this node read: the entity's (or, in an item's row, its holder's)
 * fields, `@derived`, `@items`, `@settings`, and `@row` in a list or `@item` in an item's row.
 */
export function formulaScope(
  sheet: SheetEnvironment,
  row: RowScope | undefined,
): Record<string, unknown> {
  return {
    ...(sheet.holderData ?? sheet.data),
    derived: sheet.derived.values,
    items: sheet.itemTotals,
    settings: sheet.settings,
    ...(sheet.item && { item: sheet.item }),
    ...(row && { row: row.row }),
  };
}
