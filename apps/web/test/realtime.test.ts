import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@vtt/shared/api';

import { parseChatInput } from '../src/features/chat/commands.js';
import { mergeMessages } from '../src/features/chat/messages.js';
import {
  closeEventsClient,
  defaultBackoff,
  eventsClient,
  EventsClient,
} from '../src/realtime/events-client.js';

import { FakeSocket, fakeWebSocket, serverEvent } from './support/fake-socket.js';

afterEach(() => {
  closeEventsClient();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('chat commands (FR-CHAT-08)', () => {
  it.each([
    ['', { kind: 'empty' }],
    ['   ', { kind: 'empty' }],
    [' hello ', { kind: 'message', text: 'hello' }],
    ['//shrug', { kind: 'message', text: '/shrug' }],
    ['/r 2d6 + 3', { kind: 'roll', formula: '2d6 + 3', audience: 'public' }],
    ['/R 1d20', { kind: 'roll', formula: '1d20', audience: 'public' }],
    ['/gmr 1d20', { kind: 'roll', formula: '1d20', audience: 'gm' }],
    ['/r', { kind: 'usage', command: '/r' }],
    ['/GMR', { kind: 'usage', command: '/gmr' }],
    ['/toString 1', { kind: 'unknown', command: '/toString' }],
    ['/ hi', { kind: 'unknown', command: '/' }],
  ])('%j', (input, expected) => {
    expect(parseChatInput(input)).toEqual(expected);
  });
});

describe('mergeMessages', () => {
  const at = (id: string, second: number): ChatMessage => ({
    id,
    tableId: 't1',
    senderId: null,
    speaker: { name: 'x', actorId: null, imageUrl: null },
    audience: 'public',
    recipientIds: [],
    kind: 'text',
    text: id,
    rolls: [],
    card: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
  });

  it('skips duplicates and keeps time order, ties in arrival order', () => {
    const a = at('a', 1);
    const b = at('b', 2);
    const c = at('c', 2);
    const merged = mergeMessages([b], [c, a, b, c]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    const current = [a];
    expect(mergeMessages(current, [a])).not.toBe(current);
  });
});

describe('EventsClient', () => {
  function client() {
    const sockets: FakeSocket[] = [];
    const events = new EventsClient({
      url: 'ws://vtt.test/ws/events',
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      backoff: (attempt) => 100 * (attempt + 1),
    });
    const latest = () => {
      const socket = sockets.at(-1);
      if (!socket) throw new Error('no socket');
      return socket;
    };
    return { events, sockets, latest };
  }

  it('subscribes once per table and unsubscribes after the last listener', () => {
    const { events, latest } = client();
    const first = events.subscribe('t1');
    const second = events.subscribe('t1');
    latest().open();
    expect(latest().sent).toEqual([{ v: 1, type: 'subscribe', tableId: 't1' }]);

    first();
    expect(latest().sent).toHaveLength(1);
    second();
    second();
    expect(latest().sent).toEqual([
      { v: 1, type: 'subscribe', tableId: 't1' },
      { v: 1, type: 'unsubscribe', tableId: 't1' },
    ]);
  });

  it('reconnects with growing delays and resets them once connected', () => {
    vi.useFakeTimers();
    const { events, sockets, latest } = client();
    const statuses: string[] = [];
    events.onStatus((s) => statuses.push(s));
    events.subscribe('t1');

    latest().drop();
    vi.advanceTimersByTime(99);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    latest().drop();
    vi.advanceTimersByTime(199);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    latest().open();
    expect(latest().sent).toEqual([{ v: 1, type: 'subscribe', tableId: 't1' }]);
    latest().drop();
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(4);
    expect(statuses).toEqual(['open', 'reconnecting']);
  });

  it('delivers valid events and ignores anything else', () => {
    const { events, latest } = client();
    const received: unknown[] = [];
    const off = events.onEvent((e) => received.push(e.type));
    latest().open();
    latest().receive(serverEvent({ type: 'ack', payload: { replyTo: 'x' } }));
    latest().dispatchEvent(new MessageEvent('message', { data: 'not json' }));
    latest().dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(2) }));
    latest().receive({ v: 1, id: 'x', type: 'from.the.future' });
    off();
    latest().receive(serverEvent({ type: 'ack', payload: { replyTo: 'y' } }));
    expect(received).toEqual(['ack']);
  });

  it('stays closed after close() and after the session ends', () => {
    vi.useFakeTimers();
    const { events, sockets, latest } = client();
    latest().drop(4401);
    expect(events.status).toBe('ended');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);

    const other = client();
    other.events.close();
    vi.advanceTimersByTime(60_000);
    expect(other.sockets).toHaveLength(1);
    expect(other.latest().readyState).toBe(FakeSocket.CLOSED);
  });

  it('shares one connection per page on the same host', () => {
    const sockets = fakeWebSocket();
    expect(eventsClient()).toBe(eventsClient());
    expect(sockets.map((s) => s.url)).toEqual([`ws://${window.location.host}/ws/events`]);
    closeEventsClient();
    eventsClient();
    expect(sockets).toHaveLength(2);
  });

  it('backs off up to 30 seconds with jitter', () => {
    for (const attempt of [0, 3, 20]) {
      const cap = Math.min(30_000, 500 * 2 ** attempt);
      const delay = defaultBackoff(attempt);
      expect(delay).toBeGreaterThanOrEqual(cap / 2);
      expect(delay).toBeLessThanOrEqual(cap);
    }
  });
});
