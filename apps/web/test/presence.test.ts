import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import type { MemberView } from '@vtt/shared/api';

import { colorOf, useSheetPresence } from '../src/collab/presence.js';

const member = (userId: string, displayName: string): MemberView => ({
  userId,
  username: displayName.toLowerCase(),
  displayName,
  role: 'player',
  defaultCharacterId: null,
  joinedAt: '2026-10-22T00:00:00.000Z',
});
const MEMBERS = [member('u1', 'Me'), member('u2', 'Lena')];

/** Copies every state of `from` into `to`, as the server relays awareness. */
function relay(from: Awareness, to: Awareness) {
  const update = encodeAwarenessUpdate(from, [...from.getStates().keys()]);
  act(() => {
    applyAwarenessUpdate(to, update, 'remote');
  });
}

describe('sheet presence (FR-SHEET-02, T-0507)', () => {
  it('shares the focused field and shows other members by name', () => {
    const mine = new Awareness(new Y.Doc());
    const theirs = new Awareness(new Y.Doc());
    const { result } = renderHook(() => useSheetPresence(mine, { userId: 'u1', members: MEMBERS }));
    expect(mine.getLocalState()).toEqual({ user: { id: 'u1' }, focus: null });

    act(() => {
      result.current?.focus(['hp', 'value']);
    });
    expect(mine.getLocalState()).toMatchObject({ focus: ['hp', 'value'] });

    theirs.setLocalState({ user: { id: 'u2' }, focus: ['str'] });
    relay(theirs, mine);
    expect(result.current?.at(['str'])).toEqual([{ id: 'u2', name: 'Lena', color: colorOf('u2') }]);
    expect(result.current?.at(['hp', 'value'])).toEqual([]);

    theirs.setLocalStateField('focus', null);
    relay(theirs, mine);
    expect(result.current?.at(['str'])).toEqual([]);
  });

  it('ignores strangers, malformed states and the viewer elsewhere', () => {
    const mine = new Awareness(new Y.Doc());
    const { result } = renderHook(() => useSheetPresence(mine, { userId: 'u1', members: MEMBERS }));
    const states: unknown[] = [
      { user: { id: 'u9' }, focus: ['str'] },
      { user: { id: 'u2', name: 'Someone else' }, focus: 'str' },
      { user: { id: 'u1' }, focus: ['str'] },
    ];
    for (const state of states) {
      const other = new Awareness(new Y.Doc());
      other.setLocalState(state as Record<string, unknown>);
      relay(other, mine);
    }
    expect(result.current?.at(['str'])).toEqual([]);
  });

  it('gives each user one stable color', () => {
    expect(colorOf('u2')).toBe(colorOf('u2'));
    expect(colorOf('u2')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
