import { describe, expect, it } from 'vitest';

import type { ActorType } from '@vtt/plugin-schema';

import { activeStatuses, isSecretStatus } from '../src/index.js';

// T-1618: an actor type's statuses, shown on its tokens while their fields are on.

const type: ActorType = {
  label: 'Hero',
  sheet: 'hero',
  controlledBy: 'player',
  schema: {
    type: 'object',
    properties: {
      conditions: {
        type: 'object',
        properties: {
          prone: { type: 'boolean' },
          blinded: { type: 'boolean' },
        },
      },
      cursed: { type: 'boolean', 'x-layer': 'secret' },
      gm: {
        type: 'object',
        'x-layer': 'secret',
        properties: { marked: { type: 'boolean' } },
      },
    },
  },
  statuses: [
    { field: 'conditions.prone', label: 'Prone', icon: 'icons/prone.svg' },
    { field: 'conditions.blinded', label: 'Blinded', icon: 'icons/blinded.svg' },
    { field: 'cursed', label: 'Cursed', icon: 'icons/cursed.svg' },
    { field: 'gm.marked', label: 'Marked', icon: 'icons/marked.svg' },
  ],
};

const fields = (data: Record<string, unknown>, secrets: boolean) =>
  activeStatuses(type, data, { secrets }).map((status) => status.field);

describe('token statuses (T-1618)', () => {
  it('lists the statuses whose fields are true, in the order the type declares them', () => {
    const data = {
      conditions: { prone: true, blinded: 'yes' },
      cursed: true,
      gm: { marked: true },
    };
    expect(fields(data, true)).toEqual(['conditions.prone', 'cursed', 'gm.marked']);
    expect(fields({}, true)).toEqual([]);
    expect(fields({ conditions: [true] }, true)).toEqual([]);
  });

  it('keeps secret statuses, and those under a secret object, for GMs and assistants', () => {
    expect(type.statuses?.map((status) => isSecretStatus(type, status))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    const data = { conditions: { prone: true }, cursed: true, gm: { marked: true } };
    expect(fields(data, false)).toEqual(['conditions.prone']);
  });

  it('has none for a type that declares none, or no type', () => {
    expect(
      activeStatuses({ ...type, statuses: undefined }, { cursed: true }, { secrets: true }),
    ).toEqual([]);
    expect(activeStatuses(undefined, { cursed: true }, { secrets: true })).toEqual([]);
  });
});
