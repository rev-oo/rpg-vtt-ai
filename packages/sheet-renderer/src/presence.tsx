import type { CSSProperties, FocusEvent, ReactElement } from 'react';

import { useSheet } from './context.js';
import type { FieldPath } from './store.js';

/** Another viewer of the sheet (FR-SHEET-02). */
export interface PresenceUser {
  id: string;
  name: string;
  /** A CSS color for their outline and badge. */
  color: string;
}

/** Who else is on the sheet, and where the viewer is (specs §9, FR-SHEET-02). */
export interface SheetPresence {
  /** The other viewers whose focus is in the field at `path`. */
  at: (path: FieldPath) => readonly PresenceUser[];
  /** The viewer's focus moved into a field, or out of every field (`null`). */
  focus: (path: FieldPath | null) => void;
}

/** Focus handlers and the outline of a field wrapper; nothing without presence. */
export function usePresence(path: FieldPath): {
  users: readonly PresenceUser[];
  handlers: {
    onFocus?: () => void;
    onBlur?: (event: FocusEvent<HTMLElement>) => void;
  };
  style: CSSProperties | undefined;
} {
  const { presence } = useSheet();
  if (!presence) return { users: [], handlers: {}, style: undefined };
  const users = presence.at(path);
  const first = users[0];
  return {
    users,
    handlers: {
      onFocus: () => {
        presence.focus(path);
      },
      onBlur: (event) => {
        // Moving between controls of one field keeps the focus there.
        if (!event.currentTarget.contains(event.relatedTarget)) presence.focus(null);
      },
    },
    style: first && {
      outline: `2px solid ${first.color}`,
      outlineOffset: '2px',
      borderRadius: 'var(--vtt-radius, 0.375rem)',
    },
  };
}

/** The name badges of the viewers in a field. */
export function PresenceBadges({ users }: { users: readonly PresenceUser[] }): ReactElement | null {
  if (users.length === 0) return null;
  return (
    <span className="vtt-presence flex flex-wrap gap-1" data-presence="">
      {users.map((user) => (
        <span
          key={user.id}
          className="rounded px-1.5 text-xs font-semibold text-white"
          style={{ backgroundColor: user.color }}
        >
          {user.name}
        </span>
      ))}
    </span>
  );
}
