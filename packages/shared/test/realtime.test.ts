import { describe, expect, it } from 'vitest';

import {
  chatHistoryQuery,
  chatSendBody,
  clientEventSchema,
  rollRequestBody,
  rollSchema,
  serverEventSchema,
} from '../src/api/index.js';
import { canSendChat, TABLE_ROLES } from '../src/index.js';

const TABLE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

describe('chat bodies (FR-CHAT-01, 02, 07)', () => {
  it('defaults to a public message spoken as the user', () => {
    expect(chatSendBody.parse({ text: ' hi ' })).toEqual({
      text: 'hi',
      audience: 'public',
      recipientIds: [],
      actorId: null,
    });
  });

  it('needs recipients for whispers only', () => {
    expect(chatSendBody.safeParse({ text: 'x', audience: 'whisper' }).success).toBe(false);
    expect(
      chatSendBody.safeParse({ text: 'x', audience: 'whisper', recipientIds: [USER] }).success,
    ).toBe(true);
    expect(chatSendBody.safeParse({ text: 'x', audience: 'gm' }).success).toBe(true);
  });

  it('bounds the text and the history page', () => {
    expect(chatSendBody.safeParse({ text: '  ' }).success).toBe(false);
    expect(chatSendBody.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false);
    expect(chatHistoryQuery.parse({})).toEqual({ limit: 50 });
    expect(chatHistoryQuery.parse({ limit: '10', before: 'abc' })).toEqual({
      limit: 10,
      before: 'abc',
    });
    expect(chatHistoryQuery.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('lets every role but spectators post (§2)', () => {
    expect(TABLE_ROLES.filter(canSendChat)).toEqual(['gm', 'assistant', 'player']);
  });
});

describe('rolls (FR-CHAT-03, 04, 08)', () => {
  it('takes a formula with the same audiences as chat', () => {
    expect(rollRequestBody.parse({ formula: ' 1d20 + 2 ' })).toEqual({
      formula: '1d20 + 2',
      audience: 'public',
      recipientIds: [],
      actorId: null,
    });
    expect(rollRequestBody.safeParse({ formula: '1d20', audience: 'gm' }).success).toBe(true);
    expect(rollRequestBody.safeParse({ formula: '1d20', audience: 'whisper' }).success).toBe(false);
    expect(rollRequestBody.safeParse({ formula: ' ' }).success).toBe(false);
    expect(rollRequestBody.safeParse({ formula: '1'.repeat(501) }).success).toBe(false);
  });

  it('describes every die of a stored roll (FR-DICE-04)', () => {
    const stored = {
      expression: '4dF + @mod',
      resolved: '4dF + 1',
      total: 2,
      dice: [
        {
          formula: '4dF',
          count: 4,
          die: 'dF',
          total: 1,
          results: [
            { value: 1, label: '+', active: true },
            { value: 0, label: ' ', active: true, exploded: true },
            { value: -1, active: false, dropped: true },
            { value: 1, active: true, success: true },
          ],
        },
      ],
    };
    expect(rollSchema.parse(stored)).toEqual(stored);
    expect(
      rollSchema.safeParse({ ...stored, dice: [{ ...stored.dice[0], results: [{ value: 1 }] }] })
        .success,
    ).toBe(false);
  });
});

describe('events protocol (§10.2)', () => {
  it('parses each client event', () => {
    for (const event of [
      { v: 1, type: 'subscribe', tableId: TABLE },
      { v: 1, type: 'unsubscribe', tableId: TABLE, id: 'a1' },
      { v: 1, type: 'chat.send', tableId: TABLE, payload: { text: 'hi' } },
      { v: 1, type: 'roll.request', tableId: TABLE, payload: { formula: '1d20' } },
      { v: 1, type: 'presence.ping' },
    ]) {
      expect(clientEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('rejects other versions, types and ids', () => {
    for (const event of [
      { v: 2, type: 'subscribe', tableId: TABLE },
      { v: 1, type: 'teleport', tableId: TABLE },
      { v: 1, type: 'subscribe', tableId: 'nope' },
      { v: 1, type: 'presence.ping', id: 'x'.repeat(65) },
    ]) {
      expect(clientEventSchema.safeParse(event).success).toBe(false);
    }
  });

  it('describes server events', () => {
    const message = {
      id: 'm1',
      tableId: TABLE,
      senderId: null,
      speaker: { name: 'Bob', actorId: null, imageUrl: null },
      audience: 'public',
      recipientIds: [],
      kind: 'text',
      text: 'hi',
      rolls: [],
      card: null,
      createdAt: '2026-10-20T00:00:00.000Z',
    };
    for (const event of [
      { v: 1, id: 'e1', type: 'ack', payload: { replyTo: 'a1' } },
      {
        v: 1,
        id: 'e2',
        type: 'error',
        payload: {
          code: 'unsupported_version',
          message: 'x',
          replyTo: null,
          supportedVersions: [1],
        },
      },
      {
        v: 1,
        id: 'e3',
        type: 'entity.changed',
        tableId: TABLE,
        payload: { kind: 'item', id: 'i1', change: 'restored', actorId: 'a1' },
      },
      { v: 1, id: 'e4', type: 'chat.message', tableId: TABLE, payload: { message } },
    ]) {
      expect(serverEventSchema.safeParse(event).success).toBe(true);
    }
  });
});
