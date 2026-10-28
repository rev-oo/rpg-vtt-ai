import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';

import { useOptionalDock } from './dock-context.js';
import { pathOf, type PanelTarget } from './panel-ids.js';

export interface DocumentLinkProps {
  tableId: string;
  target: PanelTarget;
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * Opens a sheet or journal entry as a workspace panel, leaving the URL on the table
 * (ADR-059). It stays a real link, so a new tab or window opens the document there.
 */
export function DocumentLink({
  tableId,
  target,
  label,
  className,
  children,
}: DocumentLinkProps): ReactElement {
  const dock = useOptionalDock();
  return (
    <Link
      to={pathOf(tableId, target.id) ?? `/tables/${tableId}`}
      className={className}
      aria-label={label}
      onClick={(event) => {
        const plain =
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey;
        if (!dock || !plain) return;
        event.preventDefault();
        dock.open(target);
      }}
    >
      {children}
    </Link>
  );
}
