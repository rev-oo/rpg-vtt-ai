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
import {
  hasSecretLayer,
  loadDocument,
  storeDocument,
  type DefinitionOf,
} from '../domain/documents.js';
import { isSystemWritable } from '../domain/entities.js';
import { findMembership, findTable } from '../domain/tables.js';
import type { AppContext } from '../http/app.js';
import { SESSION_COOKIE } from '../http/cookies.js';

import { upgradeGuard } from './upgrade.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The Yjs document server behind `/ws/collab` (specs §10.3). */
    collab: Collab;
  }
}

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
 * An actor has a secret document only if its type declares secret fields (§9.1).
 */
export function documentAccess(
  db: DbOrTx,
  userId: string,
  ref: DocumentRef,
  definition: DefinitionOf,
): DocumentAccess {
  if (ref.kind === 'actor') {
    const actor = findActor(db, ref.id);
    if (!actor) return 'none';
    if (ref.layer === 'secret' && !hasSecretLayer(db, actor, definition)) return 'none';
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

/** How long documents wait before they are stored and unloaded (specs §9.6). */
export interface CollabTiming {
  /** Quiet time after a change before the document is stored. */
  debounceMs: number;
  /** The longest a stream of changes delays a store. */
  maxDebounceMs: number;
  /** How long a document with no connections stays in memory. */
  unloadDelayMs: number;
}

export const COLLAB_TIMING: CollabTiming = {
  debounceMs: 2000,
  maxDebounceMs: 10_000,
  unloadDelayMs: 60_000,
};

interface CollabOptions {
  db: DbOrTx;
  sessions: Pick<SessionService, 'validate'>;
  definition: DefinitionOf;
  now: () => Date;
  timing?: CollabTiming | undefined;
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
  { db, sessions, definition, now, timing = COLLAB_TIMING }: CollabOptions,
  logger: FastifyBaseLogger,
  unloads: DelayedUnloads,
): Hocuspocus<CollabContext> {
  function check(context: CollabContext, documentName: string): DocumentAccess | 'no_session' {
    if (!sessions.validate(context.sessionToken)) return 'no_session';
    const ref = parseDocumentName(documentName);
    return ref ? documentAccess(db, context.userId, ref, definition) : 'none';
  }
  function deny(context: CollabContext, documentName: string, reason: string): void {
    logger.warn({ userId: context.userId, documentName, reason }, 'collab access denied');
  }

  /** Hooks run only for names that passed `onAuthenticate`, so the name parses. */
  function refOf(documentName: string): DocumentRef {
    const ref = parseDocumentName(documentName);
    if (!ref) throw new Error(`Not a document name: ${documentName}`);
    return ref;
  }

  return new Hocuspocus<CollabContext>({
    quiet: true,
    debounce: timing.debounceMs,
    maxDebounce: timing.maxDebounceMs,
    onLoadDocument: ({ documentName, document }) => {
      loadDocument(db, refOf(documentName), document, definition);
      return Promise.resolve();
    },
    onStoreDocument: ({ documentName, document, instance }) => {
      storeDocument(db, refOf(documentName), document, {
        definition,
        live: (name) => instance.documents.get(name),
        now: now(),
      });
      return Promise.resolve();
    },
    connected: ({ documentName }) => {
      unloads.cancel(documentName);
      return Promise.resolve();
    },
    beforeUnloadDocument: ({ documentName, document, instance }) =>
      unloads.due(documentName, () => void instance.unloadDocument(document), timing.unloadDelayMs)
        ? Promise.resolve()
        : Promise.reject(new Denied({ code: 0, reason: 'unload delayed' })),
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
 * Keeps documents in memory for a while after their last connection leaves (specs §9.6).
 * Hocuspocus asks before it unloads; the first ask schedules a retry once the delay is over.
 */
class DelayedUnloads {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly ready = new Set<string>();
  private closing = false;

  /** Whether a document may unload now; otherwise `retry` runs once the delay is over. */
  due(name: string, retry: () => void, delayMs: number): boolean {
    if (this.closing || this.ready.delete(name)) return true;
    if (!this.timers.has(name)) {
      const timer = setTimeout(() => {
        this.timers.delete(name);
        this.ready.add(name);
        retry();
      }, delayMs);
      this.timers.set(name, timer.unref());
    }
    return false;
  }

  /** A client opened the document again. */
  cancel(name: string): void {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
    this.ready.delete(name);
  }

  /** On shutdown documents unload at once. */
  close(): void {
    this.closing = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

/**
 * Creates the document server. Call it before the WebSocket plugin registers, so that on
 * shutdown its sockets close with 1001 before the plugin closes the rest without a code.
 * Shutdown waits until every changed document is stored.
 */
export function registerCollab(app: FastifyInstance, options: CollabOptions): Collab {
  const unloads = new DelayedUnloads();
  const hocuspocus = createHocuspocus(options, app.log, unloads);
  const collab: Collab = { hocuspocus, sockets: new Set() };
  app.decorate('collab', collab);
  app.addHook('preClose', async () => {
    unloads.close();
    for (const socket of collab.sockets) socket.close(1001, 'server shutting down');
    collab.sockets.clear();
    hocuspocus.flushPendingStores();
    await Promise.all(
      [...hocuspocus.documents.values()].map((document) => document.saveMutex.waitForUnlock()),
    );
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
