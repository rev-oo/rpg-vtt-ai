import { Forbidden, Unauthorized, type CloseEvent } from '@hocuspocus/common';
import { Hocuspocus } from '@hocuspocus/server';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';

import {
  actorLayerAccess,
  journalAccess,
  parseDocumentName,
  type DocumentAccess,
  type DocumentRef,
  type Subject,
} from '@vtt/shared';

import type { DbOrTx } from '../db/client.js';
import { findActor, findJournalEntry } from '../db/repositories/index.js';
import type { SessionService } from '../domain/auth/sessions.js';
import { isSystemWritable } from '../domain/entities.js';
import { findMembership, findTable } from '../domain/tables.js';
import type { AppContext } from '../http/app.js';
import { SESSION_COOKIE } from '../http/cookies.js';

import { upgradeGuard } from './upgrade.js';

/** The largest frame a client may send to `/ws/collab`: Yjs updates can carry a whole sheet. */
export const MAX_COLLAB_MESSAGE_BYTES = 1024 * 1024;

/** Who is behind a `/ws/collab` socket, fixed at the upgrade. */
export interface CollabContext {
  userId: string;
  /** Raw session token, re-validated before every message. */
  sessionToken: string;
}

/** The access a member's subject gets to the entity, before the table's own state. */
type Grant = (subject: Subject) => DocumentAccess;

function entityAccess(db: DbOrTx, userId: string, tableId: string, grant: Grant): DocumentAccess {
  const member = findMembership(db, tableId, userId);
  if (!member) return 'none';
  const access = grant({ userId, role: member.role });
  if (access !== 'write') return access;
  const table = findTable(db, tableId);
  return table && isSystemWritable(db, table) ? 'write' : 'read';
}

/**
 * A user's access to a collaborative document (specs §9.3). Unknown and deleted entities and
 * non-members get `none`; a table whose system is unavailable is read-only (FR-PLUGIN-07).
 */
export function documentAccess(db: DbOrTx, userId: string, ref: DocumentRef): DocumentAccess {
  if (ref.kind === 'actor') {
    const actor = findActor(db, ref.id);
    if (!actor) return 'none';
    return entityAccess(db, userId, actor.tableId, (subject) =>
      actorLayerAccess(subject, actor.ownership, ref.layer),
    );
  }
  const entry = findJournalEntry(db, ref.id);
  if (!entry) return 'none';
  return entityAccess(db, userId, entry.tableId, (subject) =>
    journalAccess(subject, { ownership: entry.ownership, hidden: entry.hidden }),
  );
}

/**
 * Refuses a document. Hocuspocus sends `reason` to the client; the message stays empty because
 * Hocuspocus logs the message of any hook error to the console.
 */
class Denied extends Error {
  readonly code: number;
  readonly reason: string;

  constructor({ code, reason }: CloseEvent) {
    super();
    this.code = code;
    this.reason = reason;
  }
}

interface CollabOptions {
  db: DbOrTx;
  sessions: Pick<SessionService, 'validate'>;
}

/** The Yjs document server and the sockets connected to it. */
export interface Collab {
  hocuspocus: Hocuspocus<CollabContext>;
  sockets: Set<WebSocket>;
}

/**
 * The Yjs document server (ADR-002, specs §10.3). Every document is authorised when a client
 * opens it, and again before each message, so lost access takes effect on the next update.
 * Read access opens the document read-only: Hocuspocus then drops the client's updates.
 */
function createHocuspocus(
  { db, sessions }: CollabOptions,
  logger: FastifyBaseLogger,
): Hocuspocus<CollabContext> {
  function check(context: CollabContext, documentName: string): DocumentAccess | 'no_session' {
    if (!sessions.validate(context.sessionToken)) return 'no_session';
    const ref = parseDocumentName(documentName);
    return ref ? documentAccess(db, context.userId, ref) : 'none';
  }
  function deny(context: CollabContext, documentName: string, reason: string): void {
    logger.warn({ userId: context.userId, documentName, reason }, 'collab access denied');
  }

  return new Hocuspocus<CollabContext>({
    quiet: true,
    onAuthenticate: ({ context, documentName, connectionConfig }) => {
      const access = check(context, documentName);
      if (access === 'no_session' || access === 'none') {
        deny(context, documentName, access);
        return Promise.reject(new Denied(access === 'no_session' ? Unauthorized : Forbidden));
      }
      connectionConfig.readOnly = access === 'read';
      return Promise.resolve();
    },
    beforeHandleMessage: ({ context, documentName, connection }) => {
      const access = check(context, documentName);
      // Read-only drops the update; a closed document receives nothing more.
      connection.readOnly = access !== 'write';
      if (access === 'no_session' || access === 'none') {
        deny(context, documentName, access);
        connection.close(access === 'no_session' ? Unauthorized : Forbidden);
      }
      return Promise.resolve();
    },
  });
}

/**
 * Creates the document server. Call it before the WebSocket plugin registers, so that on
 * shutdown its sockets close with 1001 before the plugin closes the rest without a code.
 */
export function registerCollab(app: FastifyInstance, options: CollabOptions): Collab {
  const collab: Collab = { hocuspocus: createHocuspocus(options, app.log), sockets: new Set() };
  app.addHook('preClose', (done) => {
    for (const socket of collab.sockets) socket.close(1001, 'server shutting down');
    collab.sockets.clear();
    done();
  });
  return collab;
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

/** `/ws/collab`: the Hocuspocus protocol on the app's port, session-authenticated on upgrade. */
export function collabSocket({ app, config, collab }: AppContext): void {
  app.get(
    '/ws/collab',
    { websocket: true, preValidation: upgradeGuard(config) },
    (socket, request) => {
      const sessionToken = request.cookies[SESSION_COOKIE];
      const userId = request.session?.user.id;
      if (!sessionToken || !userId) {
        socket.close(Unauthorized.code, Unauthorized.reason);
        return;
      }
      collab.sockets.add(socket);
      // Hocuspocus reads only the URL; the context carries who connected.
      const connection = collab.hocuspocus.handleConnection(
        socket,
        new Request(new URL(request.url, config.publicUrl)),
        { userId, sessionToken },
      );
      socket.on('message', (data) => {
        connection.handleMessage(toBytes(data));
      });
      socket.on('pong', () => {
        connection.touch();
      });
      socket.on('close', (code, reason) => {
        collab.sockets.delete(socket);
        connection.handleClose({ code, reason: reason.toString() });
      });
    },
  );
}
