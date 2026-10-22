import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  adminPluginSchema,
  changePasswordBody,
  copyItemBody,
  createActorBody,
  createItemBody,
  entityListQuery,
  ownershipSchema,
  updateActorBody,
  updateItemBody,
  createInviteBody,
  createTableBody,
  createUserBody,
  describeIssue,
  enablePluginBody,
  loginBody,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  pluginsResponseSchema,
  setupAdminBody,
  tableSchema,
  updateMeBody,
  updateMemberBody,
  updateTableBody,
  updateUserBody,
} from '../src/api/index.js';

/** The first issue a schema raises for `input`, described. */
function describeFirst(schema: z.ZodType, input: unknown): ReturnType<typeof describeIssue> {
  const described: ReturnType<typeof describeIssue>[] = [];
  const result = schema.safeParse(input, {
    error: (issue) => {
      described.push(describeIssue(issue));
      return undefined;
    },
  });
  // Zod words issues lazily, when they are first read.
  expect(result.error?.issues.length).toBeGreaterThan(0);
  return described[0];
}

const admin = { username: 'alice', displayName: 'Alice', password: 'long-password' };

describe('request bodies', () => {
  it('accepts valid setup input and trims names', () => {
    expect(setupAdminBody.parse({ ...admin, username: ' alice ' }).username).toBe('alice');
  });

  it.each([
    ['ab', false],
    ['abc', true],
    ['a'.repeat(32), true],
    ['a'.repeat(33), false],
    ['al ice', false],
    ['al.i_c-e', true],
  ])('username %j valid: %s', (username, valid) => {
    expect(setupAdminBody.safeParse({ ...admin, username }).success).toBe(valid);
  });

  it.each([
    [MIN_PASSWORD_LENGTH - 1, false],
    [MIN_PASSWORD_LENGTH, true],
    [MAX_PASSWORD_LENGTH, true],
    [MAX_PASSWORD_LENGTH + 1, false],
  ])('new password of length %i valid: %s', (length, valid) => {
    const password = 'x'.repeat(length);
    expect(setupAdminBody.safeParse({ ...admin, password }).success).toBe(valid);
    expect(
      changePasswordBody.safeParse({ currentPassword: 'x', newPassword: password }).success,
    ).toBe(valid);
  });

  it('rejects blank names after trimming', () => {
    expect(updateMeBody.safeParse({ displayName: '   ' }).success).toBe(false);
    expect(loginBody.safeParse({ username: ' ', password: 'x' }).success).toBe(false);
    expect(createTableBody.safeParse({ name: ' ', systemId: 's' }).success).toBe(false);
  });

  it('fills table defaults and limits the description', () => {
    expect(createTableBody.parse({ name: 'T', systemId: 's' })).toEqual({
      name: 'T',
      description: '',
      systemId: 's',
      settings: {},
    });
    const base = { name: 'T', systemId: 's' };
    expect(createTableBody.safeParse({ ...base, description: 'x'.repeat(2000) }).success).toBe(
      true,
    );
    expect(createTableBody.safeParse({ ...base, description: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('requires at least one field in partial updates', () => {
    for (const schema of [updateTableBody, updateUserBody, updateMemberBody]) {
      expect(schema.safeParse({}).success).toBe(false);
    }
    expect(updateTableBody.safeParse({ systemId: 'other' }).success).toBe(false);
    expect(updateMemberBody.safeParse({ role: 'player' }).success).toBe(true);
    expect(updateUserBody.safeParse({ disabled: true }).success).toBe(true);
  });

  it('defaults new users and invites', () => {
    expect(createUserBody.parse({ username: 'bob', displayName: 'Bob' }).isAdmin).toBe(false);
    expect(createInviteBody.parse({ role: 'player' }).expiresInSeconds).toBe(7 * 24 * 60 * 60);
    expect(createInviteBody.safeParse({ role: 'gm' }).success).toBe(false);
  });
});

describe('actor and item bodies (FR-ENT-01..06)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';

  it('defaults image and ownership on creation', () => {
    expect(createActorBody.parse({ type: 'character', name: ' Hero ' })).toEqual({
      type: 'character',
      name: 'Hero',
      imageUrl: null,
    });
    expect(createItemBody.parse({ type: 'weapon', name: 'Sword' }).imageUrl).toBeNull();
  });

  it('accepts only http(s) image URLs', () => {
    const base = { type: 'character', name: 'Hero' };
    expect(
      createActorBody.safeParse({ ...base, imageUrl: 'https://img.example.com/a.png' }).success,
    ).toBe(true);
    expect(createActorBody.safeParse({ ...base, imageUrl: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(updateItemBody.safeParse({ imageUrl: null }).success).toBe(true);
  });

  it('validates ownership levels and user ids', () => {
    expect(
      ownershipSchema.safeParse({ default: 'observer', users: { [userId]: 'owner' } }).success,
    ).toBe(true);
    expect(ownershipSchema.safeParse({ default: 'admin', users: {} }).success).toBe(false);
    expect(ownershipSchema.safeParse({ default: 'none', users: { bob: 'owner' } }).success).toBe(
      false,
    );
  });

  it('keeps plugin data out of REST updates', () => {
    expect(updateActorBody.safeParse({ system: { hp: 1 } }).success).toBe(false);
    expect(updateActorBody.safeParse({}).success).toBe(false);
    expect(updateItemBody.safeParse({ name: 'Axe' }).success).toBe(true);
  });

  it('parses list queries and copy requests', () => {
    expect(entityListQuery.parse({})).toEqual({ trash: 'live' });
    expect(entityListQuery.parse({ search: ' gob ', type: 'npc', trash: 'restorable' })).toEqual({
      search: 'gob',
      type: 'npc',
      trash: 'restorable',
    });
    expect(entityListQuery.safeParse({ trash: 'all' }).success).toBe(false);
    expect(copyItemBody.safeParse({ itemId: userId }).success).toBe(true);
    expect(copyItemBody.safeParse({ itemId: 'x' }).success).toBe(false);
  });
});

describe('responses', () => {
  it('validates a table view', () => {
    const table = {
      id: 't1',
      name: 'T',
      description: '',
      systemId: 's',
      systemName: 'S',
      systemVersion: '1.0.0',
      settings: {},
      playersMayCreateAnyActorType: false,
      systemAvailable: true,
      createdAt: '2026-10-20T00:00:00.000Z',
      role: 'gm',
    };
    expect(tableSchema.parse(table)).toEqual(table);
    expect(tableSchema.safeParse({ ...table, role: 'owner' }).success).toBe(false);
  });

  it('validates an admin plugin view and the enable body', () => {
    const plugin = {
      id: 'tiny-d20',
      name: 'Tiny D20',
      version: '0.1.0',
      description: null,
      coreApi: '^0.1.0',
      hasCode: false,
      codeEntries: [],
      enabled: true,
      status: 'invalid',
      available: false,
      issues: [
        {
          severity: 'error',
          code: 'unknown_key',
          file: 'plugin.json',
          path: ['x', 0],
          params: { key: 'x' },
        },
      ],
      scannedAt: '2026-10-21T00:00:00.000Z',
    };
    expect(pluginsResponseSchema.parse({ plugins: [plugin] })).toEqual({ plugins: [plugin] });
    expect(adminPluginSchema.safeParse({ ...plugin, status: 'broken' }).success).toBe(false);
    expect(enablePluginBody.parse({})).toEqual({});
    expect(enablePluginBody.safeParse({ acknowledgeCode: 'yes' }).success).toBe(false);
  });
});

describe('describeIssue', () => {
  it('names the rules the API uses', () => {
    expect(describeFirst(updateMeBody, { displayName: '' })).toEqual({ key: 'required' });
    expect(describeFirst(setupAdminBody, { ...admin, password: 'short' })).toEqual({
      key: 'tooShort',
      min: MIN_PASSWORD_LENGTH,
    });
    expect(describeFirst(updateMeBody, { displayName: 'x'.repeat(65) })).toEqual({
      key: 'tooLong',
      max: 64,
    });
    expect(describeFirst(setupAdminBody, { ...admin, username: 'a!' })).toEqual({
      key: 'username',
    });
    expect(describeFirst(createActorBody, { type: 'npc', name: 'x', imageUrl: 'ftp://x' })).toEqual(
      { key: 'url' },
    );
  });

  it('leaves other issues to Zod', () => {
    expect(describeFirst(z.array(z.string()).min(2), ['a'])).toBeUndefined();
    expect(describeFirst(z.array(z.string()).max(0), ['a'])).toBeUndefined();
    expect(describeFirst(z.string().regex(/^a$/), 'b')).toBeUndefined();
    expect(describeFirst(z.email(), 'nope')).toBeUndefined();
    expect(describeFirst(updateMeBody, { displayName: 1 })).toBeUndefined();
  });
});
