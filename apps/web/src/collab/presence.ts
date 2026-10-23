import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { fieldPath, type MemberView } from '@vtt/shared/api';
import type { FieldPath, PresenceUser, SheetPresence } from '@vtt/sheet-renderer';

export type Awareness = NonNullable<HocuspocusProvider['awareness']>;

/** What each client shares on a sheet's main document: who it is and where it is. */
const presenceState = z.object({
  user: z.object({ id: z.string() }),
  focus: fieldPath.nullable(),
});

/** Outline colors; badges put white text on them. */
const COLORS = ['#b42318', '#175cd3', '#067647', '#a15c07', '#6941c6', '#c11574', '#0e7090'];

/** A stable color per user, so everyone sees one person in the same color. */
export function colorOf(userId: string): string {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] ?? '#175cd3';
}

const keyOf = (path: FieldPath) => path.join('\u0000');

/**
 * Sheet presence over Yjs awareness (FR-SHEET-02, T-0507). Clients only share a user id and
 * a field path; names and colors come from the table's members, so a client cannot show up
 * as someone else or style the page. The viewer's own other tabs are not shown.
 */
export function useSheetPresence(
  awareness: Awareness | undefined,
  { userId, members }: { userId: string; members: readonly MemberView[] },
): SheetPresence | undefined {
  const [byField, setByField] = useState<ReadonlyMap<string, readonly PresenceUser[]>>(new Map());

  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalState({ user: { id: userId }, focus: null });
    const names = new Map(members.map((member) => [member.userId, member.displayName]));

    const update = () => {
      const fields = new Map<string, PresenceUser[]>();
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        const parsed = presenceState.safeParse(state);
        if (!parsed.success || !parsed.data.focus) continue;
        const { user, focus } = parsed.data;
        const name = names.get(user.id);
        if (!name || user.id === userId) continue;
        const key = keyOf(focus);
        const users = fields.get(key) ?? [];
        if (!users.some((other) => other.id === user.id)) {
          users.push({ id: user.id, name, color: colorOf(user.id) });
        }
        fields.set(key, users);
      }
      setByField(fields);
    };
    update();
    awareness.on('change', update);
    return () => {
      awareness.off('change', update);
      setByField(new Map());
    };
  }, [awareness, userId, members]);

  return useMemo(
    () =>
      awareness && {
        at: (path) => byField.get(keyOf(path)) ?? [],
        focus: (path) => {
          awareness.setLocalStateField('focus', path && [...path]);
        },
      },
    [awareness, byField],
  );
}
