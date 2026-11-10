import type { ReactElement } from 'react';

import type { ActorStatus } from '@vtt/shared/api';

import { useSystemText } from './system-context.js';

/**
 * An actor's statuses that are on (T-1615), such as conditions: the system's icons, each
 * named in the member's language.
 */
export function StatusIcons({
  statuses,
}: {
  statuses: readonly ActorStatus[];
}): ReactElement | null {
  const translate = useSystemText();
  if (statuses.length === 0) return null;
  return (
    <ul className="flex shrink-0 flex-wrap items-center gap-0.5">
      {statuses.map((status) => {
        const label = translate(status.label);
        return (
          <li key={status.field}>
            <img src={status.iconUrl} alt={label} title={label} className="size-4" />
          </li>
        );
      })}
    </ul>
  );
}
