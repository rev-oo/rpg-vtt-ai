import { z } from 'zod';

import { cssClass, formula, identifier, name, schemaUrl, text } from './common.js';

/** A dot path into the data (`hp.value`); inside a `list`, relative to the row. */
const path = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/)
  .meta({ title: 'Path' });
/** Spacing steps; sizes come from the core's tokens. */
const gap = z.enum(['none', 'sm', 'md', 'lg']);

export const FIELD_INPUTS = ['text', 'number', 'checkbox', 'select', 'counter'] as const;

/** A recipe argument: a formula, or a literal number or true/false. */
export const rollArg = z.union([formula, z.number(), z.boolean()]);

interface NodeBase {
  class?: string | undefined;
  /** Shown only while this formula is true (specs §8.5). */
  visibleIf?: string | undefined;
}

/** A node of a sheet layout (specs §8.5). */
export type SheetNode = NodeBase &
  (
    | {
        type: 'row';
        children: SheetNode[];
        gap?: z.infer<typeof gap> | undefined;
        wrap?: boolean | undefined;
      }
    | { type: 'column'; children: SheetNode[]; gap?: z.infer<typeof gap> | undefined }
    | { type: 'grid'; children: SheetNode[]; columns: number }
    | { type: 'tabs'; tabs: { label: string; children: SheetNode[] }[] }
    | { type: 'section'; title: string; children: SheetNode[]; collapsible?: boolean | undefined }
    | {
        type: 'field';
        path: string;
        label?: string | undefined;
        input?: (typeof FIELD_INPUTS)[number] | undefined;
      }
    | { type: 'longText'; path: string; label?: string | undefined }
    | { type: 'list'; path: string; item: SheetNode; addLabel?: string | undefined }
    | {
        type: 'items';
        itemTypes?: string[] | undefined;
        item: SheetNode;
        addLabel?: string | undefined;
      }
    | {
        type: 'rollButton';
        roll: string;
        label: string;
        args?: Record<string, string | number | boolean> | undefined;
      }
    | {
        type: 'derived';
        key: string;
        label?: string | undefined;
        format?: 'integer' | 'signed' | 'decimal' | undefined;
      }
    | { type: 'image'; path: string; size?: 'sm' | 'md' | 'lg' | undefined }
    | { type: 'text'; text: string }
    | { type: `custom:${string}`; props?: Record<string, unknown> | undefined }
  );

const base = {
  class: cssClass.optional().describe('Extra CSS classes, for `styles/*.css`.'),
  visibleIf: formula
    .optional()
    .describe('Shows the node only while this formula is true. It cannot roll dice.'),
};
/** Called inside `z.lazy`, once `sheetNode` exists. */
const children = () => z.array(sheetNode).describe('The nodes inside, in order.');
const label = text.optional().describe("A lang key or literal text; defaults to the field's path.");

export const sheetNode: z.ZodType<SheetNode> = z.lazy(() =>
  z
    .union([
      z.discriminatedUnion('type', [
        z
          .strictObject({
            ...base,
            type: z.literal('row'),
            children: children(),
            gap: gap.optional().describe('The space between children.'),
            wrap: z.boolean().optional().describe('Wraps children onto more lines when narrow.'),
          })
          .describe('Lays its children out side by side.'),
        z
          .strictObject({
            ...base,
            type: z.literal('column'),
            children: children(),
            gap: gap.optional().describe('The space between children.'),
          })
          .describe('Stacks its children.'),
        z
          .strictObject({
            ...base,
            type: z.literal('grid'),
            children: children(),
            columns: z.int().min(1).max(12).describe('Columns on wide screens; phones show one.'),
          })
          .describe('Lays its children out in columns.'),
        z
          .strictObject({
            ...base,
            type: z.literal('tabs'),
            tabs: z
              .array(
                z
                  .strictObject({ label: text.describe('The tab title.'), children: children() })
                  .meta({ title: 'Tab' }),
              )
              .min(1),
          })
          .describe('Shows one tab at a time.'),
        z
          .strictObject({
            ...base,
            type: z.literal('section'),
            title: text.describe('The heading; a lang key or literal text.'),
            children: children(),
            collapsible: z.boolean().optional().describe('Lets the viewer fold it away.'),
          })
          .describe('A titled group.'),
        z
          .strictObject({
            ...base,
            type: z.literal('field'),
            path: path.describe('The field, as a dot path such as `hp.value`.'),
            label,
            input: z
              .enum(FIELD_INPUTS)
              .optional()
              .describe(
                'The control: `text` (the default), `number`, `checkbox` (boolean fields), `select` (fields with `enum`) or `counter` (− and + buttons).',
              ),
          })
          .describe('Edits one field, and shows who else is in it.'),
        z
          .strictObject({
            ...base,
            type: z.literal('longText'),
            path: path.describe('A `longText` or `richText` field.'),
            label,
          })
          .describe('A text box several people can type into at once; rich text gets a toolbar.'),
        z
          .strictObject({
            ...base,
            type: z.literal('list'),
            path: path.describe('An `array` field.'),
            item: sheetNode,
            addLabel: text.optional().describe('The text of the add button.'),
          })
          .describe(
            "The rows of an array, with add, remove and reorder. `item` is one row's layout; its paths are relative to the row.",
          ),
        z
          .strictObject({
            ...base,
            type: z.literal('items'),
            itemTypes: z
              .array(name)
              .min(1)
              .optional()
              .describe('The item types to list; every type when left out.'),
            item: sheetNode,
            addLabel: text.optional().describe('The text of the add button.'),
          })
          .describe(
            "The actor's items, grouped, each edited in place, with open, remove and add (actor sheets only). `item` is one item's layout: its paths are relative to the item's data, and `@item.id`, `@item.name` and `@item.type` name the item.",
          ),
        z
          .strictObject({
            ...base,
            type: z.literal('rollButton'),
            /** A recipe in `rolls.json`. */
            roll: name.describe('A recipe in `rolls.json`.'),
            label: text.describe("The button's text."),
            args: z
              .record(identifier, rollArg)
              .optional()
              .describe(
                'Values the recipe reads as `@args.<name>`: formulas, numbers or true/false. In a list, `"@row.id"` names the row.',
              ),
          })
          .describe('Rolls a recipe for the entity and posts it to chat.'),
        z
          .strictObject({
            ...base,
            type: z.literal('derived'),
            key: identifier.describe("A name in the type's `derived`."),
            label: text.optional().describe('A lang key or literal text; defaults to the key.'),
            format: z
              .enum(['integer', 'signed', 'decimal'])
              .optional()
              .describe(
                '`integer` rounds, `signed` rounds and shows `+2` or `−1`, `decimal` keeps two places.',
              ),
          })
          .describe('Shows a derived value.'),
        z
          .strictObject({
            ...base,
            type: z.literal('image'),
            path: path.describe('A string field holding the picture URL.'),
            size: z.enum(['sm', 'md', 'lg']).optional().describe('Defaults to `md`.'),
          })
          .describe('Shows a picture from a URL field.'),
        z
          .strictObject({
            ...base,
            type: z.literal('text'),
            text: text.describe('A lang key or literal text.'),
          })
          .describe('Static text.'),
      ]),
      z
        .strictObject({
          ...base,
          /** A node from the plugin's `code/client` (specs §8.10). */
          type: z.templateLiteral(['custom:', name]),
          props: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Any JSON, passed to the component as `props`.'),
        })
        .meta({
          title: 'Node `custom:<name>`',
          description: "A component from the plugin's `code/client`, by its name in `nodes`.",
        }),
    ])
    .meta({ title: 'Node' }),
);

/** `sheets/<name>.json`: one layout tree. */
export const sheetSchema = z
  .strictObject({ ...schemaUrl, layout: sheetNode })
  .describe('A sheet layout: a tree of nodes. Types name their sheet in `sheet`.');
export type Sheet = z.infer<typeof sheetSchema>;
