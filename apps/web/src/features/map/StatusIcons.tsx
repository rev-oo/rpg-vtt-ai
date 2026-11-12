import type { ReactElement } from 'react';

import type { TokenStatus } from '@vtt/shared/api';

import { useSystem } from '../../plugin-host/system-context.js';

/**
 * A token's or combatant's statuses that are on (T-1618): the system's icons, each named by
 * its label in the system's language, for screen readers and as a tooltip.
 */
export function StatusIcons({
  statuses,
}: {
  statuses: readonly TokenStatus[];
}): ReactElement | null {
  const system = useSystem();
  if (statuses.length === 0) return null;
  const translate = system.status === 'ready' ? system.translate : (text: string) => text;
  return (
    <span
      data-vtt-part="statuses"
      className="inline-flex shrink-0 items-center gap-0.5 align-middle"
    >
      {statuses.map((status) => (
        <img
          key={status.field}
          src={status.icon}
          alt={translate(status.label)}
          title={translate(status.label)}
          // A ring in the text colour keeps a dark icon visible on a dark theme (T-1620).
          className="size-4 rounded-full ring-1 ring-fg/60"
        />
      ))}
    </span>
  );
}
