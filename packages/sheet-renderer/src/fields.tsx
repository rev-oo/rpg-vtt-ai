import { useId, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';

import { isDiceText, type Value } from '@vtt/formula';
import { fieldBounds } from '@vtt/plugin-engine';
import type { FieldSchema, SheetNode } from '@vtt/plugin-schema';
import { Button, cn, controlClass } from '@vtt/ui';

import { useSheet, type RowScope, type SheetEnvironment } from './context.js';
import { PresenceBadges, usePresence } from './presence.js';
import { fieldAt, isSecretPath } from './schema.js';
import { valueAt, type FieldPath } from './store.js';
import { fill } from './strings.js';
import { SharedTextarea } from './text.js';

/**
 * A sheet's controls. On a sheet the caller may only view, text dims as the disabled selects
 * and checkboxes do (T-1620): a `readonly` input or textarea, or a rich text editor that is
 * not editable.
 */
const sheetControlClass = cn(
  controlClass,
  '[&[readonly]]:opacity-60 [&[contenteditable=false]]:opacity-60',
);

type NodeOf<T extends SheetNode['type']> = Extract<SheetNode, { type: T }>;

export interface ResolvedField {
  path: FieldPath;
  schema: FieldSchema | undefined;
  value: unknown;
  /** On the secret layer while the viewer cannot see it: such fields render nothing. */
  hidden: boolean;
}

/** Where a node's `path` points: from the row inside a list, else from the data root. */
export function resolveField(
  sheet: SheetEnvironment,
  row: RowScope | undefined,
  dotPath: string,
): ResolvedField {
  const parent = row ? row.schema : sheet.schema;
  const path = [...(row?.path ?? []), ...dotPath.split('.')];
  const secret =
    isSecretPath(parent, dotPath) ||
    (row !== undefined && isSecretPath(sheet.schema, row.path[0] ?? ''));
  return {
    path,
    schema: fieldAt(parent, dotPath),
    value: valueAt(sheet.data, path),
    hidden: secret && !sheet.secret,
  };
}

/** A stored scalar as input text; anything else shows as empty. */
const asText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';

type FieldInput = NonNullable<NodeOf<'field'>['input']>;

const inputFor = (schema: FieldSchema | undefined): FieldInput => {
  if (schema?.enum) return 'select';
  if (schema?.['x-counter']) return 'counter';
  if (schema?.type === 'boolean') return 'checkbox';
  if (schema?.type === 'integer' || schema?.type === 'number') return 'number';
  return 'text';
};

/** The input a field node shows: the one it names, or the one its schema calls for. */
export const inputOf = (
  sheet: SheetEnvironment,
  row: RowScope | undefined,
  node: NodeOf<'field'>,
): FieldInput => node.input ?? inputFor(resolveField(sheet, row, node.path).schema);

/**
 * The width a field asks for in a row (T-1620): enough for an input's value, more for a
 * counter's buttons around it, and only its own for a checkbox. Rows wrap once their fields'
 * widths do not fit.
 */
const BASIS: Record<FieldInput, string> = {
  text: '6rem',
  number: '6rem',
  select: '6rem',
  counter: '9rem',
  checkbox: 'auto',
};
const basisStyle = (input: FieldInput): CSSProperties => {
  const style: Record<string, string> = { '--vtt-basis': BASIS[input] };
  return style;
};

/** Why `text` cannot be stored in the field, or undefined (FR-SHEET-09). */
function problemWith(
  sheet: SheetEnvironment,
  schema: FieldSchema | undefined,
  text: string,
  numeric: boolean,
) {
  const { strings } = sheet;
  if (!numeric) {
    const max = schema?.maxLength;
    if (max !== undefined && text.length > max) return fill(strings.tooLong, { max });
    return schema?.format === 'dice' && !isDiceText(text) ? strings.notDice : undefined;
  }
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return strings.notNumber;
  if (schema?.type === 'integer' && !Number.isInteger(value)) return strings.notInteger;
  const { minimum, maximum } = schema ? boundsOf(sheet, schema) : {};
  if (minimum !== undefined && value < minimum) return fill(strings.tooSmall, { min: minimum });
  if (maximum !== undefined && value > maximum) return fill(strings.tooBig, { max: maximum });
  return undefined;
}

/**
 * A field's bounds: a counter's formulas (T-1610) read the entity whose sheet this is, its
 * derived values, its item totals and the settings, as the server does on every step.
 */
function boundsOf(sheet: SheetEnvironment, schema: FieldSchema) {
  return fieldBounds(
    schema,
    {
      ...sheet.data,
      derived: sheet.derived.values,
      // An item's own fields, in a row of its holder's sheet, have no totals.
      items: sheet.holderData ? {} : sheet.itemTotals,
      settings: sheet.settings,
    },
    sheet.functions,
  );
}

interface FieldShellProps {
  node: { path: string; class?: string | undefined; type: string };
  /** The field's full path, for presence. */
  path: FieldPath;
  label: string;
  labelFor?: string;
  labelId?: string;
  errorId: string;
  error: string | undefined;
  /** A field's input, which sets the width it asks for in a row; other nodes have none. */
  input?: FieldInput;
  children: ReactNode;
}

function FieldShell({
  node,
  path,
  label,
  labelFor,
  labelId,
  errorId,
  error,
  input,
  children,
}: FieldShellProps): ReactElement {
  const presence = usePresence(path);
  return (
    <div
      className={cn(`vtt-${node.type} relative flex min-w-0 flex-col gap-1`, node.class)}
      data-field={node.path}
      data-input={input}
      style={{ ...presence.style, ...(input && basisStyle(input)) }}
      {...presence.handlers}
    >
      {labelFor ? (
        <label className="text-sm font-semibold wrap-anywhere" htmlFor={labelFor}>
          {label}
        </label>
      ) : (
        <span id={labelId} className="text-sm font-semibold wrap-anywhere">
          {label}
        </span>
      )}
      <PresenceBadges users={presence.users} />
      {children}
      {error && (
        <span id={errorId} className="text-sm text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/** A `field` node: an input bound to one value (specs §8.5). */
export function FieldNode({
  node,
  row,
}: {
  node: NodeOf<'field'>;
  row: RowScope | undefined;
}): ReactElement | null {
  const sheet = useSheet();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const field = resolveField(sheet, row, node.path);
  if (field.hidden) return null;

  const { store, readOnly } = sheet;
  const input = node.input ?? inputFor(field.schema);
  const label = node.label ? sheet.translate(node.label) : node.path;
  const errorId = `${id}-error`;
  const described = error ? errorId : undefined;
  const shell = { node, path: field.path, label, errorId, error, input };

  if (input === 'checkbox') {
    return (
      <div
        className={cn('vtt-field flex min-w-0 items-center gap-2', node.class)}
        data-field={node.path}
        data-input={input}
        style={basisStyle(input)}
      >
        <input
          id={id}
          type="checkbox"
          className="size-5 accent-(--vtt-accent) disabled:opacity-60"
          checked={field.value === true}
          disabled={readOnly}
          onChange={(event) => {
            store.set(field.path, event.target.checked);
          }}
        />
        <label className="text-sm font-semibold wrap-anywhere" htmlFor={id}>
          {label}
        </label>
      </div>
    );
  }

  if (input === 'select') {
    const options = field.schema?.enum ?? [];
    // A value shows its label (T-1611), or itself: a value that is a lang key is translated.
    const labels = field.schema?.enumLabels ?? {};
    const labelOf = (option: string) =>
      sheet.translate(Object.hasOwn(labels, option) ? (labels[option] ?? option) : option);
    return (
      <FieldShell {...shell} labelFor={id}>
        <select
          id={id}
          className={sheetControlClass}
          value={asText(field.value)}
          disabled={readOnly}
          onChange={(event) => {
            const chosen = options.find((option) => String(option) === event.target.value);
            if (chosen !== undefined) store.set(field.path, chosen);
          }}
        >
          {!options.some((option) => String(option) === asText(field.value)) && (
            <option value={asText(field.value)}>{asText(field.value)}</option>
          )}
          {options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {labelOf(String(option))}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  }

  const numeric = input === 'number' || input === 'counter';
  // Always an adjustment, even before the counter is stored: writing `default + delta`
  // instead would lose a step when two people make the first one at once (FR-SHEET-08).
  const step = (delta: number) => {
    store.adjust(field.path, delta);
  };
  const shown = draft ?? asText(field.value);
  const control = (
    <input
      id={id}
      type="text"
      inputMode={numeric ? (field.schema?.type === 'integer' ? 'numeric' : 'decimal') : undefined}
      className={cn(sheetControlClass, 'w-full min-w-0', input === 'counter' && 'text-center')}
      value={shown}
      readOnly={readOnly}
      aria-invalid={error ? true : undefined}
      aria-describedby={described}
      onChange={(event) => {
        const text = event.target.value;
        const problem = problemWith(sheet, field.schema, text, numeric);
        setDraft(text);
        setError(problem);
        if (!problem) store.set(field.path, numeric ? Number(text) : text);
      }}
      onBlur={() => {
        setDraft(null);
        setError(undefined);
      }}
    />
  );

  if (input !== 'counter')
    return (
      <FieldShell {...shell} labelFor={id}>
        {control}
      </FieldShell>
    );
  return (
    <FieldShell {...shell} labelFor={id}>
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="secondary"
          aria-label={fill(sheet.strings.decrease, { label })}
          disabled={readOnly}
          onClick={() => {
            step(-1);
          }}
        >
          −
        </Button>
        {control}
        <Button
          variant="secondary"
          aria-label={fill(sheet.strings.increase, { label })}
          disabled={readOnly}
          onClick={() => {
            step(1);
          }}
        >
          +
        </Button>
      </div>
    </FieldShell>
  );
}

/**
 * A `longText` node. On live stores it edits the field's shared text, so several people can
 * type at once (FR-SHEET-07); otherwise it writes the whole value. A `richText` field uses the
 * host's rich text editor when there is one (ADR-037).
 */
export function LongTextNode({
  node,
  row,
}: {
  node: NodeOf<'longText'>;
  row: RowScope | undefined;
}): ReactElement | null {
  const sheet = useSheet();
  const id = useId();
  const field = resolveField(sheet, row, node.path);
  if (field.hidden) return null;
  const label = node.label ? sheet.translate(node.label) : node.path;
  const shared = sheet.store.text?.(field.path);
  const className = cn(sheetControlClass, 'min-h-24 w-full min-w-0');
  const labelId = `${id}-label`;
  // The host renders nothing when it cannot edit the field richly, such as without its text.
  const rich =
    field.schema?.['x-kind'] === 'richText'
      ? sheet.renderRichText?.({ path: field.path, labelId, readOnly: sheet.readOnly, className })
      : undefined;
  const isRich = rich !== undefined && rich !== null && rich !== false;
  return (
    <FieldShell
      node={node}
      path={field.path}
      label={label}
      {...(isRich ? { labelId } : { labelFor: id })}
      errorId={`${id}-error`}
      error={undefined}
    >
      {isRich ? (
        rich
      ) : shared ? (
        <SharedTextarea id={id} text={shared} readOnly={sheet.readOnly} className={className} />
      ) : (
        <textarea
          id={id}
          className={className}
          value={typeof field.value === 'string' ? field.value : ''}
          readOnly={sheet.readOnly}
          onChange={(event) => {
            sheet.store.set(field.path, event.target.value);
          }}
        />
      )}
    </FieldShell>
  );
}

const SAFE_IMAGE = /^(?:https?:\/\/|\/(?!\/)|data:image\/(?:png|jpeg|gif|webp|avif);)/i;
const IMAGE_SIZES = { sm: 'size-16', md: 'size-32', lg: 'size-48' } as const;

/**
 * An `image` node: the field's picture; other URLs are not loaded. Editors of a sheet whose
 * host can pick images click it to choose another (ADR-065).
 */
export function ImageNode({
  node,
  row,
}: {
  node: NodeOf<'image'>;
  row: RowScope | undefined;
}): ReactElement | null {
  const sheet = useSheet();
  const field = resolveField(sheet, row, node.path);
  if (field.hidden) return null;
  const src =
    typeof field.value === 'string' && SAFE_IMAGE.test(field.value) ? field.value : undefined;
  const size = IMAGE_SIZES[node.size ?? 'md'];
  const picture = src ? (
    <img src={src} alt="" className="size-full rounded-lg border border-line object-cover" />
  ) : (
    <div className="flex size-full items-center justify-center rounded-lg border border-dashed border-line text-center text-sm text-muted">
      {sheet.pickImage && !sheet.readOnly ? sheet.strings.chooseImage : sheet.strings.noImage}
    </div>
  );
  const { pickImage } = sheet;
  if (!pickImage || sheet.readOnly) {
    return (
      <div className={cn('vtt-image shrink-0', size, node.class)} data-field={node.path}>
        {picture}
      </div>
    );
  }
  const current = typeof field.value === 'string' ? field.value : '';
  return (
    <button
      type="button"
      className={cn(
        'vtt-image shrink-0 cursor-pointer rounded-lg hover:opacity-85 focus-visible:outline-2 focus-visible:outline-primary',
        size,
        node.class,
      )}
      data-field={node.path}
      aria-label={src ? sheet.strings.changeImage : sheet.strings.chooseImage}
      onClick={() => {
        pickImage((url) => {
          sheet.store.set(field.path, url ?? '');
        }, current);
      }}
    >
      {picture}
    </button>
  );
}

/** How a `derived` node shows its value. */
export function formatDerived(value: Value, format: NodeOf<'derived'>['format']): string {
  if (typeof value !== 'number') return Array.isArray(value) ? value.join(', ') : String(value);
  switch (format) {
    case 'integer':
      return String(Math.round(value));
    case 'signed': {
      const rounded = Math.round(value);
      return rounded < 0 ? `−${String(-rounded)}` : `+${String(rounded)}`;
    }
    case 'decimal':
      return String(Math.round(value * 100) / 100);
    default:
      return String(value);
  }
}

/** A `derived` node: a computed value, never stored (FR-SHEET-05). */
export function DerivedNode({ node }: { node: NodeOf<'derived'> }): ReactElement {
  const sheet = useSheet();
  const id = useId();
  const value = Object.hasOwn(sheet.derived.values, node.key)
    ? sheet.derived.values[node.key]
    : undefined;
  const failure = sheet.derived.errors[node.key];
  const label = node.label ? sheet.translate(node.label) : node.key;
  return (
    <div
      className={cn('vtt-derived flex min-w-0 flex-col gap-1', node.class)}
      data-derived={node.key}
    >
      <span id={id} className="text-sm font-semibold">
        {label}
      </span>
      <output
        aria-labelledby={id}
        className="text-xl font-bold text-(--vtt-accent)"
        title={failure?.message}
      >
        {value === undefined ? '—' : formatDerived(value, node.format)}
      </output>
    </div>
  );
}
