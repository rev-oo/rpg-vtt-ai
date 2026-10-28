import { useId, type ReactElement, type ReactNode } from 'react';

import type { RowGroup } from './item-groups.js';

export interface GroupedListProps<T> {
  /** Names the whole list. */
  label: string;
  groups: readonly RowGroup<T>[];
  rowKey: (row: T) => string;
  /** One row, as an `<li>`; `nested` when it sits under a group heading. */
  renderRow: (row: T, nested: boolean) => ReactNode;
  listClassName?: string;
  headingClassName?: string;
  /** The level of the group headings; rows under them sit one lower. */
  headingLevel?: 3 | 4;
}

/**
 * One list, or a list per group under its heading. Without groups it stays a plain list, so
 * systems that declare none look as before.
 */
export function GroupedList<T>({
  label,
  groups,
  rowKey,
  renderRow,
  listClassName = 'flex list-none flex-col gap-2 p-0',
  headingClassName = 'text-sm font-semibold text-muted uppercase',
  headingLevel = 3,
}: GroupedListProps<T>): ReactElement {
  const id = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const [only] = groups;
  if (groups.length === 1 && only?.title === null) {
    return (
      <ul className={listClassName} aria-label={label}>
        {only.rows.map((row) => (
          <Keyed key={rowKey(row)}>{renderRow(row, false)}</Keyed>
        ))}
      </ul>
    );
  }
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-3">
      {groups.map((group, index) => (
        <section
          key={group.key}
          aria-labelledby={`${id}-${String(index)}`}
          className="flex flex-col gap-2"
        >
          <Heading id={`${id}-${String(index)}`} className={headingClassName}>
            {group.title}
          </Heading>
          <ul className={listClassName} aria-label={group.title ?? label}>
            {group.rows.map((row) => (
              <Keyed key={rowKey(row)}>{renderRow(row, true)}</Keyed>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Keyed({ children }: { children: ReactNode }): ReactElement {
  return <>{children}</>;
}
