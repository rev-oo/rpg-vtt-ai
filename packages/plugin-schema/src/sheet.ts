import { z } from 'zod';

import { cssClass, formula, name, schemaUrl, text } from './common.js';

/** A dot path into the data (`hp.value`); inside a `list`, relative to the row. */
const path = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/);
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

const base = { class: cssClass.optional(), visibleIf: formula.optional() };

export const sheetNode: z.ZodType<SheetNode> = z.lazy(() =>
  z.union([
    z.discriminatedUnion('type', [
      z.strictObject({
        ...base,
        type: z.literal('row'),
        children: z.array(sheetNode),
        gap: gap.optional(),
        wrap: z.boolean().optional(),
      }),
      z.strictObject({
        ...base,
        type: z.literal('column'),
        children: z.array(sheetNode),
        gap: gap.optional(),
      }),
      z.strictObject({
        ...base,
        type: z.literal('grid'),
        children: z.array(sheetNode),
        columns: z.int().min(1).max(12),
      }),
      z.strictObject({
        ...base,
        type: z.literal('tabs'),
        tabs: z.array(z.strictObject({ label: text, children: z.array(sheetNode) })).min(1),
      }),
      z.strictObject({
        ...base,
        type: z.literal('section'),
        title: text,
        children: z.array(sheetNode),
        collapsible: z.boolean().optional(),
      }),
      z.strictObject({
        ...base,
        type: z.literal('field'),
        path,
        label: text.optional(),
        input: z.enum(FIELD_INPUTS).optional(),
      }),
      z.strictObject({ ...base, type: z.literal('longText'), path, label: text.optional() }),
      z.strictObject({
        ...base,
        type: z.literal('list'),
        path,
        item: sheetNode,
        addLabel: text.optional(),
      }),
      z.strictObject({
        ...base,
        type: z.literal('rollButton'),
        /** A recipe in `rolls.json`. */
        roll: name,
        label: text,
        args: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), rollArg).optional(),
      }),
      z.strictObject({
        ...base,
        type: z.literal('derived'),
        key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        label: text.optional(),
        format: z.enum(['integer', 'signed', 'decimal']).optional(),
      }),
      z.strictObject({
        ...base,
        type: z.literal('image'),
        path,
        size: z.enum(['sm', 'md', 'lg']).optional(),
      }),
      z.strictObject({ ...base, type: z.literal('text'), text }),
    ]),
    z.strictObject({
      ...base,
      /** A node from the plugin's `code/client` (specs §8.10). */
      type: z.templateLiteral(['custom:', name]),
      props: z.record(z.string(), z.unknown()).optional(),
    }),
  ]),
);

/** `sheets/<name>.json`: one layout tree. */
export const sheetSchema = z.strictObject({ ...schemaUrl, layout: sheetNode });
export type Sheet = z.infer<typeof sheetSchema>;
