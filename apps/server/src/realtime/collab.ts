import { Forbidden, Unauthorized, type CloseEvent } from '@hocuspocus/common';
import {
  Hocuspocus,
  type Connection,
  type Document,
  type TransactionOrigin,
} from '@hocuspocus/server';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';

import { copyInto } from '@vtt/plugin-engine';
import {
  actorLayerAccess,
  itemLayerAccess,
  documentName,
  journalAccess,
  parseDocumentName,
  type DocumentAccess,
  type DocumentRef,
  type Subject,
} from '@vtt/shared';
import {
  collabClientMessage,
  type CollabClientMessage,
  type CollabServerMessage,
} from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { findActor, findItem, findJournalEntry } from '../db/repositories/index.js';
import type { Actor } from '../db/repositories/index.js';
import type { SessionService } from '../domain/auth/sessions.js';
import {
  adjustDocument,
  DATA_MAP,
  hasSecretLayer,
  liveActorData,
  liveHeldItems,
  type LiveHeldItem,
  loadDocument,
  repairDocument,
  storeDocument,
  type DefinitionOf,
} from '../domain/documents.js';
import { isTableWritable } from '../domain/entities.js';
import { decodeSnapshot, recordSnapshot, type SnapshotRow } from '../domain/history.js';
import type { AdjustCounter } from '../domain/rolls.js';
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
  return table && isTableWritable(db, table) ? 'write' : 'read';
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
  if (ref.kind === 'item') {
    const item = findItem(db, ref.id);
    if (!item) return 'none';
    // Items of an actor in the trash are out of reach with it (ADR-015).
    const actor = item.actorId === null ? undefined : findActor(db, item.actorId);
    if (item.actorId !== null && !actor) return 'none';
    if (ref.layer === 'secret' && !hasSecretLayer(db, item, definition, 'item')) return 'none';
    return entityAccess(db, userId, item.tableId, (subject) =>
      itemLayerAccess(subject, actor?.ownership, ref.layer),
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

const send = (connection: Connection, message: CollabServerMessage) => {
  connection.sendStateless(JSON.stringify(message));
};

/** A stateless message from a client, or `undefined` when it is not one. */
function parseClientMessage(payload: string): CollabClientMessage | undefined {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return undefined;
  }
  const parsed = collabClientMessage.safeParse(json);
  return parsed.success ? parsed.data : undefined;
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
  /** Re-checks every open document connection now (§9.3). */
  recheck: () => void;
}

/** How often open connections are re-checked without a change, e.g. for expired sessions. */
export const RECHECK_INTERVAL_MS = 30_000;

/**
 * The Yjs document server (ADR-002, specs §10.3). Every document is authorised when a client
 * opens it, and again before each message, so lost access takes effect on the next update.
 * Read access opens the document read-only: Hocuspocus then drops the client's updates.
 */
function createHocuspocus(
  { db, sessions, definition, now, timing = COLLAB_TIMING }: CollabOptions,
  logger: FastifyBaseLogger,
  unloads: DelayedUnloads,
): { hocuspocus: Hocuspocus<CollabContext>; recheck: () => void } {
  function check(context: CollabContext, documentName: string): DocumentAccess | 'no_session' {
    if (!sessions.validate(context.sessionToken)) return 'no_session';
    const ref = parseDocumentName(documentName);
    return ref ? documentAccess(db, context.userId, ref, definition) : 'none';
  }
  function deny(context: CollabContext, documentName: string, reason: string): void {
    logger.warn({ userId: context.userId, documentName, reason }, 'collab access denied');
  }

  /**
   * Applies a connection's current access: closes the document when it is gone, and tells
   * the client when it moved between read and write. Read-only drops its updates.
   */
  function enforce(connection: Connection, context: CollabContext, documentName: string): void {
    const access = check(context, documentName);
    if (access === 'no_session' || access === 'none') {
      deny(context, documentName, access);
      connection.readOnly = true;
      connection.close(access === 'no_session' ? Unauthorized : Forbidden);
      return;
    }
    const readOnly = access !== 'write';
    if (connection.readOnly === readOnly) return;
    connection.readOnly = readOnly;
    send(connection, { type: 'access', readOnly });
  }

  /** Hooks run only for names that passed `onAuthenticate`, so the name parses. */
  function refOf(documentName: string): DocumentRef {
    const ref = parseDocumentName(documentName);
    if (!ref) throw new Error(`Not a document name: ${documentName}`);
    return ref;
  }

  /** Who changed each document since it was last stored: they hear about repairs. */
  const editors = new WeakMap<Document, Set<Connection>>();
  /** Repairs are stored with the store that makes them, not by a store of their own. */
  const repairOrigin: TransactionOrigin = { source: 'local', skipStoreHooks: true };

  const hocuspocus = new Hocuspocus<CollabContext>({
    quiet: true,
    debounce: timing.debounceMs,
    maxDebounce: timing.maxDebounceMs,
    onLoadDocument: ({ documentName, document }) => {
      loadDocument(db, refOf(documentName), document, definition);
      return Promise.resolve();
    },
    onChange: ({ document, connection }) => {
      if (connection) editors.set(document, (editors.get(document) ?? new Set()).add(connection));
      return Promise.resolve();
    },
    onStoreDocument: ({ documentName, document, instance }) => {
      const ref = refOf(documentName);
      const issues = repairDocument(db, ref, document, { definition, origin: repairOrigin });
      if (issues.length > 0) {
        logger.warn({ documentName, issues }, 'collab data repaired');
        for (const editor of editors.get(document) ?? []) {
          send(editor, { type: 'validation', issues });
        }
      }
      editors.delete(document);
      storeDocument(db, ref, document, {
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
    onStateless: ({ connection, documentName, document, payload }) => {
      const message = parseClientMessage(payload);
      if (!message) {
        send(connection, { type: 'error', id: null, code: 'invalid_message' });
      } else if (connection.readOnly) {
        send(connection, { type: 'error', id: message.id, code: 'read_only' });
      } else {
        const origin: TransactionOrigin = { source: 'connection', connection };
        const result = adjustDocument(db, refOf(documentName), document, message, {
          definition,
          origin,
        });
        send(
          connection,
          result
            ? { type: 'adjusted', id: message.id, ...result }
            : { type: 'error', id: message.id, code: 'not_a_counter' },
        );
      }
      return Promise.resolve();
    },
    beforeHandleMessage: ({ context, documentName, connection }) => {
      enforce(connection, context, documentName);
      return Promise.resolve();
    },
  });

  /** Connections that only listen send nothing, so changes of access are pushed to them. */
  const recheck = () => {
    for (const document of hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        enforce(connection, connection.context as CollabContext, document.name);
      }
    }
  };
  return { hocuspocus, recheck };
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
  const { hocuspocus, recheck } = createHocuspocus(options, app.log, unloads);
  const collab: Collab = { hocuspocus, sockets: new Set(), recheck };
  app.decorate('collab', collab);

  // Membership, roles, ownership, deletions, sessions and plugins all change through the API:
  // after any successful change, every open connection is checked again, once per tick.
  let pending = false;
  app.addHook('onResponse', (request, reply, done) => {
    if (request.method !== 'GET' && request.method !== 'HEAD' && reply.statusCode < 400) {
      if (!pending) {
        pending = true;
        setImmediate(() => {
          pending = false;
          recheck();
        });
      }
    }
    done();
  });
  const sweep = setInterval(recheck, RECHECK_INTERVAL_MS).unref();

  app.addHook('preClose', async () => {
    clearInterval(sweep);
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

/** Reads an actor's data from its live documents, for rolls (specs §9.6). */
export function liveDataOf(
  { collab, db }: Pick<AppContext, 'collab' | 'db'>,
  definition: DefinitionOf,
): (actor: Actor) => Record<string, unknown> | undefined {
  return (actor) =>
    liveActorData(db, actor, definition, (name) => collab.hocuspocus.documents.get(name));
}

/** Reads the items an actor holds, live, for `@items` (ADR-063). */
export function heldItemsOf(
  { collab, db }: Pick<AppContext, 'collab' | 'db'>,
  definition: DefinitionOf,
): (actor: Actor) => LiveHeldItem[] {
  return (actor) =>
    liveHeldItems(db, actor, definition, (name) => collab.hocuspocus.documents.get(name));
}

/**
 * Steps a counter of an actor's document for plugin server code (ADR-047), through a direct
 * connection, so open sheets see the change at once. The caller checks who may do it.
 */
export function adjustActorCounter(
  { collab, db }: Pick<AppContext, 'collab' | 'db'>,
  definition: DefinitionOf,
): AdjustCounter {
  return async (actor, layer, path, delta) => {
    if (layer === 'secret' && !hasSecretLayer(db, actor, definition)) return undefined;
    const ref: DocumentRef = { kind: 'actor', id: actor.id, layer };
    const connection = await collab.hocuspocus.openDirectConnection(documentName(ref));
    try {
      let value: number | undefined;
      await connection.transact((document) => {
        const origin: TransactionOrigin = { source: 'local' };
        value = adjustDocument(db, ref, document, { path, delta }, { definition, origin })?.value;
      });
      return value;
    } finally {
      await connection.disconnect();
    }
  };
}

/**
 * Puts a sheet history snapshot back into its actor document (FR-SHEET-11, ADR-053), through
 * a direct connection, so open sheets change at once. What it replaces is kept as a snapshot
 * first, so a restore can be undone. The caller checks who may do it.
 */
export async function restoreActorSnapshot(
  { collab, db }: Pick<AppContext, 'collab' | 'db'>,
  snapshot: SnapshotRow,
  now: Date,
): Promise<void> {
  const ref: DocumentRef = { kind: 'actor', id: snapshot.actorId, layer: snapshot.layer };
  const connection = await collab.hocuspocus.openDirectConnection(documentName(ref));
  const saved = decodeSnapshot(snapshot.state);
  try {
    await connection.transact((document) => {
      const data = document.getMap(DATA_MAP);
      recordSnapshot(db, { actorId: snapshot.actorId, layer: snapshot.layer }, data, now, {
        force: true,
      });
      copyInto(data, saved.data);
    });
  } finally {
    saved.doc.destroy();
    await connection.disconnect();
  }
}
