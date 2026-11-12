import type { ReactElement, ReactNode } from 'react';

import { Button } from '@vtt/ui';

import { ICON } from '../../icons.js';

import { useDock } from './dock-context.js';
import type { PanelTarget } from './panel-ids.js';

export interface OpenButtonProps {
  target: PanelTarget;
  label?: string;
  className?: string;
  /**
   * A button with the open icon, as in the lists (T-1620); or a link, for a name or a phrase
   * within text.
   */
  look?: 'button' | 'link';
  children: ReactNode;
}

/** Opens a sheet, journal entry or page as a workspace panel; the URL stays (ADR-059). */
export function OpenButton({
  target,
  label,
  className,
  look = 'button',
  children,
}: OpenButtonProps): ReactElement {
  const { open } = useDock();
  const onClick = () => {
    open(target);
  };
  if (look === 'button') {
    return (
      <Button icon={<ICON.open />} aria-label={label} className={className} onClick={onClick}>
        {children}
      </Button>
    );
  }
  return (
    <button
      type="button"
      className={`text-primary underline ${className ?? ''}`}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
