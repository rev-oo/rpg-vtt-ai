import { describe, expect, it } from 'vitest';

import { INVITE_ROLES, isTableRole, TABLE_ROLES } from '../src/index.js';

describe('roles', () => {
  it('lists table roles from most to least privileged', () => {
    expect(TABLE_ROLES).toEqual(['gm', 'assistant', 'player', 'spectator']);
  });

  it('never lets an invite grant the GM role', () => {
    expect(INVITE_ROLES).not.toContain('gm');
  });

  it.each([
    ['gm', true],
    ['spectator', true],
    ['admin', false],
    [undefined, false],
    [3, false],
  ])('isTableRole(%s) is %s', (value, expected) => {
    expect(isTableRole(value)).toBe(expected);
  });
});
