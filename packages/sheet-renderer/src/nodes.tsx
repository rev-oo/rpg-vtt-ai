import { useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { evaluate, FormulaError, type Value } from '@vtt/formula';
import { collectionRows, withDefaults } from '@vtt/plugin-engine';
import type { SheetNode } from '@vtt/plugin-schema';
import { Button, cn } from '@vtt/ui';

import { formulaScope, useSheet, type RowScope, type SheetEnvironment } from './context.js';
import { DerivedNode, FieldNode, ImageNode, LongTextNode, resolveField } from './fields.js';
import { fill } from './strings.js';

type NodeOf<T extends SheetNode['type']> = Extract<SheetNode, { type: T }>;
type Gap = NodeOf<'row'>['gap'];

const GAPS: Record<NonNullable<Gap>, string> = {
  none: 'gap-0',
  sm: 'gap-(--vtt-gap-sm)',
  md: 'gap-(--vtt-gap-md)',
  lg: 'gap-(--vtt-gap-lg)',
};

/** Whether a node's `visibleIf` holds; one that fails or is not true hides the node. */
function isVisible(sheet: SheetEnvironment, node: SheetNode, row: RowScope | undefined): boolean {
  if (node.visibleIf === undefined) return true;
  try {
    return (
      evaluate(node.visibleIf, { data: formulaScope(sheet, row), functions: sheet.functions }) ===
      true
    );
  } catch (error) {
    if (error instanceof FormulaError) return false;
    throw error;
  }
}

function Children({
  nodes,
  row,
}: {
  nodes: readonly SheetNode[];
  row: RowScope | undefined;
}): ReactElement {
  return (
    <>
      {nodes.map((child, index) => (
        <SheetNodeView key={index} node={child} row={row} />
      ))}
    </>
  );
}

function RowNode({ node, row }: { node: NodeOf<'row'>; row: RowScope | undefined }): ReactElement {
  // Narrow sheets stack the row (FR-SHEET-10); the sheet root is a size container.
  return (
    <div
      className={cn(
        // Children share the width, except images, which keep their size; roll buttons line up
        // with the inputs next to them.
        'vtt-row flex min-w-0 flex-col @md:flex-row @md:items-start [&>*]:min-w-0 @md:[&>:not(.vtt-image)]:flex-1 @md:[&>.vtt-rollButton]:flex-none @md:[&>.vtt-rollButton]:self-end',
        node.wrap && '@md:flex-wrap',
        GAPS[node.gap ?? 'md'],
        node.class,
      )}
    >
      <Children nodes={node.children} row={row} />
    </div>
  );
}

function ColumnNode({
  node,
  row,
}: {
  node: NodeOf<'column'>;
  row: RowScope | undefined;
}): ReactElement {
  return (
    <div className={cn('vtt-column flex min-w-0 flex-col', GAPS[node.gap ?? 'md'], node.class)}>
      <Children nodes={node.children} row={row} />
    </div>
  );
}

function GridNode({
  node,
  row,
}: {
  node: NodeOf<'grid'>;
  row: RowScope | undefined;
}): ReactElement {
  const gaps = String(node.columns - 1);
  // At most `columns` columns, fewer once a column would be narrower than 7rem.
  const columns = `repeat(auto-fill, minmax(max(7rem, calc((100% - ${gaps} * var(--vtt-gap-md)) / ${String(node.columns)})), 1fr))`;
  return (
    <div
      className={cn('vtt-grid grid min-w-0 gap-(--vtt-gap-md)', node.class)}
      style={{ gridTemplateColumns: columns }}
    >
      <Children nodes={node.children} row={row} />
    </div>
  );
}

function TabsNode({
  node,
  row,
}: {
  node: NodeOf<'tabs'>;
  row: RowScope | undefined;
}): ReactElement {
  const sheet = useSheet();
  const id = useId();
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.min(active, node.tabs.length - 1);

  const onKeyDown = (event: KeyboardEvent) => {
    const last = node.tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (current + 1) % node.tabs.length
        : event.key === 'ArrowLeft'
          ? (current + last) % node.tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  };

  return (
    <div className={cn('vtt-tabs flex min-w-0 flex-col gap-(--vtt-gap-md)', node.class)}>
      <div
        role="tablist"
        className="flex flex-wrap gap-1 border-b border-line"
        onKeyDown={onKeyDown}
      >
        {node.tabs.map((tab, index) => (
          <button
            key={index}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${String(index)}`}
            aria-selected={index === current}
            aria-controls={`${id}-panel-${String(index)}`}
            tabIndex={index === current ? 0 : -1}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-semibold',
              index === current
                ? 'border-(--vtt-accent) text-fg'
                : 'border-transparent text-muted hover:text-fg',
            )}
            onClick={() => {
              setActive(index);
            }}
          >
            {sheet.translate(tab.label)}
          </button>
        ))}
      </div>
      {node.tabs.map((tab, index) => (
        <div
          key={index}
          role="tabpanel"
          id={`${id}-panel-${String(index)}`}
          aria-labelledby={`${id}-tab-${String(index)}`}
          hidden={index !== current}
          className="flex min-w-0 flex-col gap-(--vtt-gap-md)"
        >
          {index === current && <Children nodes={tab.children} row={row} />}
        </div>
      ))}
    </div>
  );
}

function SectionNode({
  node,
  row,
}: {
  node: NodeOf<'section'>;
  row: RowScope | undefined;
}): ReactElement {
  const sheet = useSheet();
  const title = sheet.translate(node.title);
  const body = (
    <div className="flex min-w-0 flex-col gap-(--vtt-gap-md)">
      <Children nodes={node.children} row={row} />
    </div>
  );
  const frame = cn(
    'vtt-section flex min-w-0 flex-col gap-(--vtt-gap-sm) rounded-lg border border-line p-3',
    node.class,
  );
  if (node.collapsible) {
    return (
      <details open className={frame}>
        <summary className="cursor-pointer font-semibold">{title}</summary>
        {body}
      </details>
    );
  }
  return (
    <section className={frame}>
      <h3 className="font-semibold">{title}</h3>
      {body}
    </section>
  );
}

/** A `list` node: a collection's rows with add, remove and reorder (FR-SHEET-06). */
function ListNode({
  node,
  row,
}: {
  node: NodeOf<'list'>;
  row: RowScope | undefined;
}): ReactElement | null {
  const sheet = useSheet();
  const field = resolveField(sheet, row, node.path);
  if (field.hidden) return null;
  const { store, strings, readOnly } = sheet;
  const items = field.schema?.items;
  const rows = collectionRows(field.value);

  return (
    <div
      className={cn('vtt-list flex min-w-0 flex-col gap-(--vtt-gap-sm)', node.class)}
      data-field={node.path}
    >
      {rows.length === 0 && <p className="text-sm text-muted">{strings.noRows}</p>}
      {rows.length > 0 && (
        <ul className="flex min-w-0 list-none flex-col gap-(--vtt-gap-sm) p-0">
          {rows.map((entry, index) => {
            const scope: RowScope = { path: [...field.path, entry.id], schema: items, row: entry };
            return (
              <li
                key={entry.id}
                className="vtt-list-row flex min-w-0 flex-col gap-2 @md:flex-row @md:items-end"
                data-row={entry.id}
              >
                <div className="min-w-0 flex-1">
                  <SheetNodeView node={node.item} row={scope} />
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      aria-label={strings.moveUp}
                      title={strings.moveUp}
                      disabled={index === 0}
                      onClick={() => {
                        store.moveRow(field.path, entry.id, rows[index - 1]?.id ?? null);
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={strings.moveDown}
                      title={strings.moveDown}
                      disabled={index === rows.length - 1}
                      onClick={() => {
                        store.moveRow(field.path, entry.id, rows[index + 2]?.id ?? null);
                      }}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={strings.removeRow}
                      title={strings.removeRow}
                      onClick={() => {
                        store.removeRow(field.path, entry.id);
                      }}
                    >
                      ✕
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div>
          <Button
            onClick={() => {
              store.addRow(field.path, withDefaults(items, {}));
            }}
          >
            {node.addLabel ? sheet.translate(node.addLabel) : strings.addRow}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A `rollButton` node: asks for a roll recipe with its arguments (specs §8.7). */
function RollButtonNode({
  node,
  row,
}: {
  node: NodeOf<'rollButton'>;
  row: RowScope | undefined;
}): ReactElement {
  const sheet = useSheet();
  let args: Record<string, Value> | undefined = {};
  let problem: string | undefined;
  for (const [name, arg] of Object.entries(node.args ?? {})) {
    if (typeof arg !== 'string') {
      args[name] = arg;
      continue;
    }
    try {
      args[name] = evaluate(arg, { data: formulaScope(sheet, row), functions: sheet.functions });
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      problem = error.message;
      args = undefined;
      break;
    }
  }
  const { onRoll } = sheet;
  return (
    <div className={cn('vtt-rollButton', node.class)} data-roll={node.roll}>
      <Button
        variant="primary"
        title={problem}
        // Rolling changes no data: an observer may roll whenever the host passes `onRoll`.
        disabled={!onRoll || !args}
        onClick={() => {
          if (onRoll && args) onRoll(node.roll, args);
        }}
      >
        {sheet.translate(node.label)}
      </Button>
    </div>
  );
}

function CustomNode({
  node,
  row,
}: {
  node: NodeOf<`custom:${string}`>;
  row: RowScope | undefined;
}): ReactElement {
  const sheet = useSheet();
  const name = node.type.slice('custom:'.length);
  const Component = Object.hasOwn(sheet.nodes, name) ? sheet.nodes[name] : undefined;
  if (!Component) {
    return (
      <p
        className={cn(
          'vtt-custom rounded-lg border border-dashed border-line p-2 text-sm text-muted',
          node.class,
        )}
      >
        {fill(sheet.strings.missingNode, { name })}
      </p>
    );
  }
  return (
    <div className={cn('vtt-custom min-w-0', node.class)} data-node={name}>
      <Component props={node.props ?? {}} {...(row && { rowPath: row.path })} />
    </div>
  );
}

/** Renders one layout node and its children (specs §8.5). */
export function SheetNodeView({
  node,
  row,
}: {
  node: SheetNode;
  row?: RowScope | undefined;
}): ReactElement | null {
  const sheet = useSheet();
  if (!isVisible(sheet, node, row)) return null;
  switch (node.type) {
    case 'row':
      return <RowNode node={node} row={row} />;
    case 'column':
      return <ColumnNode node={node} row={row} />;
    case 'grid':
      return <GridNode node={node} row={row} />;
    case 'tabs':
      return <TabsNode node={node} row={row} />;
    case 'section':
      return <SectionNode node={node} row={row} />;
    case 'field':
      return <FieldNode node={node} row={row} />;
    case 'longText':
      return <LongTextNode node={node} row={row} />;
    case 'list':
      return <ListNode node={node} row={row} />;
    case 'items':
      // The host lays it out, with `ItemRow` for each item (FR-SHEET-12).
      return sheet.renderItems ? <>{sheet.renderItems({ node })}</> : null;
    case 'rollButton':
      return <RollButtonNode node={node} row={row} />;
    case 'derived':
      return <DerivedNode node={node} />;
    case 'image':
      return <ImageNode node={node} row={row} />;
    case 'text':
      return <p className={cn('vtt-text', node.class)}>{sheet.translate(node.text)}</p>;
    default:
      return <CustomNode node={node} row={row} />;
  }
}
