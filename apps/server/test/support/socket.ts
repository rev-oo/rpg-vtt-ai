import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

import { serverEventSchema, type ClientEventInput, type ServerEvent } from '@vtt/shared/api';

import type { Client } from './app.js';

const TIMEOUT_MS = 2000;

/** A client event without the envelope fields the helper fills in. */
export type OutgoingClientEvent = ClientEventInput extends infer E
  ? E extends ClientEventInput
    ? Omit<E, 'v' | 'id'>
    : never
  : never;

/** A test client on `/ws/events` that records every server event it receives. */
export interface TestSocket {
  ws: WebSocket;
  received: ServerEvent[];
  /** Sends a raw frame. */
  sendRaw: (data: string) => void;
  /** Sends an event with a fresh id and waits for the matching `ack` or `error`. */
  request: (event: OutgoingClientEvent) => Promise<ServerEvent>;
  /** Waits for the next event matching a predicate (searching what already arrived first). */
  next: (match: (event: ServerEvent) => boolean) => Promise<ServerEvent>;
  /**
   * Resolves once the server has handled everything sent before; events published earlier
   * have then arrived, so a missing event really was not sent.
   */
  flush: () => Promise<void>;
  /** The events of one type received so far. */
  ofType: <T extends ServerEvent['type']>(type: T) => Extract<ServerEvent, { type: T }>[];
  closed: Promise<number>;
}

let counter = 0;

export async function openSocket(
  app: FastifyInstance,
  client: Client | null,
  headers: Record<string, string> = {},
): Promise<TestSocket> {
  const ws = await app.injectWS('/ws/events', {
    headers: { ...(client && { cookie: client.cookie }), ...headers },
  });
  const received: ServerEvent[] = [];
  const waiters: { match: (event: ServerEvent) => boolean; resolve: (e: ServerEvent) => void }[] =
    [];
  let seen = 0;

  ws.on('message', (data: Buffer) => {
    // Every server message must match the shared protocol.
    const event = serverEventSchema.parse(JSON.parse(data.toString()));
    received.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.match(event)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });
  const closed = new Promise<number>((resolve) => ws.on('close', resolve));
  // Browsers answer pings; the injected client does not unless told to.
  ws.on('ping', () => {
    ws.pong();
  });

  const next = (match: (event: ServerEvent) => boolean) => {
    const found = received.slice(seen).find(match);
    if (found) return Promise.resolve(found);
    return new Promise<ServerEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('timed out waiting for a server event'));
      }, TIMEOUT_MS);
      waiters.push({
        match,
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
      });
    });
  };

  const request = async (event: OutgoingClientEvent) => {
    counter += 1;
    const id = `req-${String(counter)}`;
    seen = received.length;
    ws.send(JSON.stringify({ v: 1, id, ...event }));
    return next((e) => (e.type === 'ack' || e.type === 'error') && e.payload.replyTo === id);
  };

  return {
    ws,
    received,
    sendRaw: (data) => {
      seen = received.length;
      ws.send(data);
    },
    request,
    next,
    flush: async () => {
      await request({ type: 'presence.ping' });
    },
    ofType: <T extends ServerEvent['type']>(type: T) =>
      received.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type),
    closed,
  };
}
