import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { RawData } from 'ws';
import { z } from 'zod';

import {
  clientEventSchema,
  EVENTS_PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
  MAX_CLIENT_MESSAGE_BYTES,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ClientEvent,
} from '@vtt/shared/api';

import { sendChatMessage } from '../domain/chat.js';
import { findMembership } from '../domain/tables.js';
import { AppError, notFound } from '../errors.js';
import type { AppContext } from '../http/app.js';
import { SESSION_COOKIE } from '../http/cookies.js';

import { EventHub, SESSION_ENDED, type Connection } from './hub.js';
import { membersOf, publishChatMessage } from './notify.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Event socket fan-out (specs §10.2). */
    events: EventHub;
  }
}

/** Registers the WebSocket plugin and the hub; call before any route publishes events. */
export async function registerEvents(
  app: FastifyInstance,
  { db, sessions }: Pick<AppContext, 'db' | 'sessions'>,
): Promise<EventHub> {
  const hub = new EventHub({
    membersOf: (tableId) => membersOf(db, tableId),
    isSessionValid: (token) => sessions.validate(token) !== null,
  });
  app.decorate('events', hub);

  let heartbeat: NodeJS.Timeout | undefined;
  app.addHook('onReady', (done) => {
    heartbeat = setInterval(() => {
      hub.sweep();
    }, HEARTBEAT_INTERVAL_MS).unref();
    done();
  });
  // Added before the plugin's own preClose, which closes sockets without a reason.
  app.addHook('preClose', (done) => {
    clearInterval(heartbeat);
    hub.closeAll();
    done();
  });
  await app.register(fastifyWebsocket, { options: { maxPayload: MAX_CLIENT_MESSAGE_BYTES } });
  return hub;
}

/**
 * Whether a browser opened the socket from this instance's own page. Cookies ride along on
 * cross-site upgrades too, so the Origin is checked (cross-site WebSocket hijacking).
 * Clients that send no Origin are not browsers.
 */
function isSameOrigin(origin: string | undefined, host: string | undefined, publicUrl: URL) {
  if (origin === undefined) return true;
  if (origin === publicUrl.origin) return true;
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** `/ws/events`: session-authenticated on upgrade, one JSON envelope per message. */
export function eventsSocket({ app, db, config, sessions, events, now }: AppContext): void {
  app.get(
    '/ws/events',
    {
      websocket: true,
      preValidation: (request, reply, done) => {
        if (!request.session) {
          void reply
            .code(401)
            .send({ error: { code: 'unauthenticated', message: 'Authentication required.' } });
          return;
        }
        if (!isSameOrigin(request.headers.origin, request.headers.host, config.publicUrl)) {
          void reply.code(403).send({ error: { code: 'forbidden', message: 'Bad origin.' } });
          return;
        }
        done();
      },
    },
    (socket, request) => {
      const token = request.cookies[SESSION_COOKIE];
      const userId = request.session?.user.id;
      if (!token || !userId) {
        socket.close(SESSION_ENDED, 'session ended');
        return;
      }
      const connection: Connection = {
        socket,
        userId,
        sessionToken: token,
        tables: new Set(),
        alive: true,
      };
      events.add(connection);

      socket.on('pong', () => {
        connection.alive = true;
      });
      socket.on('close', () => {
        events.remove(connection);
      });
      socket.on('message', (data, isBinary) => {
        // Logging out or a password change ends the socket's session too.
        if (!sessions.validate(token)) {
          socket.close(SESSION_ENDED, 'session ended');
          events.remove(connection);
          return;
        }
        const reply = new Replies(events, connection);
        const event = parseEvent(data, isBinary, reply);
        if (!event) return;
        try {
          handle(event);
          if (event.id) reply.ack(event.id);
        } catch (error) {
          if (error instanceof AppError) {
            reply.error(error.code, error.message, event.id);
          } else {
            request.log.error({ err: error }, 'events socket handler failed');
            reply.error('internal_error', 'Something went wrong.', event.id);
          }
        }
      });

      function handle(event: ClientEvent): void {
        switch (event.type) {
          case 'subscribe': {
            if (!findMembership(db, event.tableId, connection.userId))
              throw notFound('Table not found.');
            events.subscribe(connection, event.tableId);
            return;
          }
          case 'unsubscribe':
            events.unsubscribe(connection, event.tableId);
            return;
          case 'chat.send': {
            const membership = findMembership(db, event.tableId, connection.userId);
            if (!membership) throw notFound('Table not found.');
            const row = sendChatMessage(
              db,
              { tableId: event.tableId, userId: connection.userId, role: membership.role },
              event.payload,
              now(),
            );
            publishChatMessage(events, row);
            return;
          }
          case 'roll.request':
            throw new AppError(501, 'not_implemented', 'Rolls are not available yet.');
          case 'presence.ping':
            return;
        }
      }
    },
  );
}

/** Answers to one client message. */
class Replies {
  constructor(
    private readonly hub: EventHub,
    private readonly connection: Connection,
  ) {}

  ack(replyTo: string): void {
    this.hub.send(this.connection, { type: 'ack', payload: { replyTo } });
  }

  error(
    code: string,
    message: string,
    replyTo: string | undefined,
    extra: { supportedVersions?: number[] } = {},
  ): void {
    this.hub.send(this.connection, {
      type: 'error',
      payload: { code, message, replyTo: replyTo ?? null, ...extra },
    });
  }
}

const envelopeHead = z.object({
  v: z.unknown(),
  id: z.string().max(64).optional().catch(undefined),
});

/** Validates one client message, answering with an `error` event when it is unusable. */
function parseEvent(data: RawData, isBinary: boolean, reply: Replies): ClientEvent | undefined {
  if (isBinary) {
    reply.error('invalid_message', 'Messages must be JSON text.', undefined);
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText(data));
  } catch {
    reply.error('invalid_message', 'Messages must be JSON text.', undefined);
    return undefined;
  }
  const head = envelopeHead.safeParse(raw);
  const replyTo = head.success ? head.data.id : undefined;
  if (head.success && head.data.v !== EVENTS_PROTOCOL_VERSION) {
    reply.error('unsupported_version', 'Unsupported protocol version.', replyTo, {
      supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    });
    return undefined;
  }
  const parsed = clientEventSchema.safeParse(raw);
  if (!parsed.success) {
    reply.error('invalid_message', z.prettifyError(parsed.error), replyTo);
    return undefined;
  }
  return parsed.data;
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
}
