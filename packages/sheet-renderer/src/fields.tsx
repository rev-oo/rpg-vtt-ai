import { useId, useState, type ReactElement, type ReactNode } from 'react';

import type { Value } from '@vtt/formula';
import type { FieldSchema, SheetNode } from '@vtt/plugin-schema';
import { Button, cn, controlClass } from '@vtt/ui';

import { useSheet, type RowScope, type SheetEnvironment } from './context.js';
import { PresenceBadges, usePresence } from './presence.js';
import { fieldAt, isSecretPath } from './schema.js';
import { valueAt, type FieldPath } from './store.js';
import { fill } from './strings.js';
import { SharedTextarea } from './text.js';

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

const inputFor = (schema: FieldSchema | undefined): NonNullable<NodeOf<'field'>['input']> => {
  if (schema?.enum) return 'select';
  if (schema?.['x-counter']) return 'counter';
  if (schema?.type === 'boolean') return 'checkbox';
  if (schema?.type === 'integer' || schema?.type === 'number') return 'number';
  return 'text';
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
    return max !== undefined && text.length > max ? fill(strings.tooLong, { max }) : undefined;
  }
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return strings.notNumber;
  if (schema?.type === 'integer' && !Number.isInteger(value)) return strings.notInteger;
  if (schema?.minimum !== undefined && value < schema.minimum) {
    return fill(strings.tooSmall, { min: schema.minimum });
  }
  if (schema?.maximum !== undefined && value > schema.maximum) {
    return fill(strings.tooBig, { max: schema.maximum });
  }
  return undefined;
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
  children,
}: FieldShellProps): ReactElement {
  const presence = usePresence(path);
  return (
    <div
      className={cn(`vtt-${node.type} flex min-w-0 flex-col gap-1`, node.class)}
      data-field={node.path}
      style={presence.style}
      {...presence.handlers}
    >
      {labelFor ? (
        <label className="text-sm font-semibold" htmlFor={labelFor}>
          {label}
        </label>
      ) : (
        <span id={labelId} className="text-sm font-semibold">
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
  const shell = { node, path: field.path, label, errorId, error };

  if (input === 'checkbox') {
    return (
      <div
        className={cn('vtt-field flex min-w-0 items-center gap-2', node.class)}
        data-field={node.path}
      >
        <input
          id={id}
          type="checkbox"
          className="size-5 accent-(--vtt-accent)"
          checked={field.value === true}
          disabled={readOnly}
          onChange={(event) => {
            store.set(field.path, event.target.checked);
          }}
        />
        <label className="text-sm font-semibold" htmlFor={id}>
          {label}
        </label>
      </div>
    );
  }

  if (input === 'select') {
    const options = field.schema?.enum ?? [];
    return (
      <FieldShell {...shell} labelFor={id}>
        <select
          id={id}
          className={controlClass}
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
              {sheet.translate(String(option))}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  }

  const numeric = input === 'number' || input === 'counter';
  // A counter not stored yet shows its default; the first step starts from there.
  const step = (delta: number) => {
    const stored = valueAt(store.getSnapshot(), field.path);
    if (typeof stored === 'number') store.adjust(field.path, delta);
    else store.set(field.path, (typeof field.value === 'number' ? field.value : 0) + delta);
  };
  const shown = draft ?? asText(field.value);
  const control = (
    <input
      id={id}
      type="text"
      inputMode={numeric ? (field.schema?.type === 'integer' ? 'numeric' : 'decimal') : undefined}
      className={cn(controlClass, 'w-full min-w-0', input === 'counter' && 'text-center')}
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
  const className = cn(controlClass, 'min-h-24 w-full min-w-0');
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

/** An `image` node: a picture from a URL field; other URLs are not loaded. */
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
  return (
    <div className={cn('vtt-image shrink-0', size, node.class)} data-field={node.path}>
      {src ? (
        <img src={src} alt="" className="size-full rounded-lg border border-line object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center rounded-lg border border-dashed border-line text-center text-sm text-muted">
          {sheet.strings.noImage}
        </div>
      )}
    </div>
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
