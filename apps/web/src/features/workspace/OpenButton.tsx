import type { ReactElement, ReactNode } from 'react';

import { useDock } from './dock-context.js';
import type { PanelTarget } from './panel-ids.js';

export interface OpenButtonProps {
  target: PanelTarget;
  label?: string;
  className?: string;
  children: ReactNode;
}

/** Opens a sheet, journal entry or page as a workspace panel; the URL stays (ADR-059). */
export function OpenButton({ target, label, className, children }: OpenButtonProps): ReactElement {
  const { open } = useDock();
  return (
    <button
      type="button"
      className={`text-primary underline ${className ?? ''}`}
      aria-label={label}
      onClick={() => {
        open(target);
      }}
    >
      {children}
    </button>
  );
}
