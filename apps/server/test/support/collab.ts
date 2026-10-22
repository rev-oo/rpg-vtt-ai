import type { FastifyInstance } from 'fastify';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import type { Client } from './app.js';

const TIMEOUT_MS = 2000;

// Hocuspocus message types (@hocuspocus/server MessageType).
const SYNC = 0;
const AUTH = 2;
const SYNC_REPLY = 4;
const CLOSE = 7;
const SYNC_STATUS = 8;
// Auth sub-messages (@hocuspocus/common AuthMessageType).
const AUTH_TOKEN = 0;
const AUTH_DENIED = 1;
const AUTH_GRANTED = 2;

/** Where the server's own changes come from on the client copy. */
const SERVER = Symbol('server');

/** How the server answered a document's authentication. */
export type AuthAnswer = { scope: string } | { denied: string };

/** One document opened on a {@link CollabSocket}, with a local Yjs copy. */
export interface CollabDocument {
  name: string;
  doc: Y.Doc;
  auth: AuthAnswer;
  /** Changes the local copy and resolves with whether the server stored the update. */
  change: (edit: (doc: Y.Doc) => void) => Promise<boolean>;
  /** Resolves with the reason once the server closes the document. */
  closed: Promise<string>;
  /** Every frame received for this document, as sent. */
  frames: Uint8Array[];
}

/** A test client speaking the Hocuspocus protocol on `/ws/collab`. */
export interface CollabSocket {
  ws: WebSocket;
  /** Opens a document and resolves once it is denied, or granted and synced. */
  open: (name: string) => Promise<CollabDocument>;
  /**
   * Drops the connection and resolves once the server has seen it go. An injected socket
   * that closes cleanly never ends its stream, so the server would not notice the close.
   */
  drop: () => Promise<void>;
  closed: Promise<number>;
  /** Every frame the socket received, for any document, as sent. */
  received: Uint8Array[];
}

function waitFor<T>(what: string, register: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${what}`));
    }, TIMEOUT_MS);
    register((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function message(name: string, type: number, write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, name);
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export async function openCollab(
  app: FastifyInstance,
  client: Client | null,
  headers: Record<string, string> = {},
): Promise<CollabSocket> {
  const ws = await app.injectWS('/ws/collab', {
    headers: { ...(client && { cookie: client.cookie }), ...headers },
  });
  const documents = new Map<string, (frame: Uint8Array) => void>();
  const received: Uint8Array[] = [];
  ws.on('message', (data: Buffer) => {
    const frame = new Uint8Array(data);
    received.push(frame);
    const name = decoding.readVarString(decoding.createDecoder(frame));
    documents.get(name)?.(frame);
  });
  ws.on('ping', () => {
    ws.pong();
  });
  const closed = new Promise<number>((resolve) => ws.on('close', resolve));

  async function open(name: string): Promise<CollabDocument> {
    const doc = new Y.Doc();
    const frames: Uint8Array[] = [];
    const statuses: ((saved: boolean) => void)[] = [];
    // The status that answers the client's sync step 2, before any change.
    let handshake: () => void = () => undefined;
    const synced = waitFor<undefined>(`${name} sync`, (resolve) => {
      handshake = () => {
        resolve(undefined);
      };
    });
    let answer: (value: AuthAnswer) => void = () => undefined;
    let close: (reason: string) => void = () => undefined;
    const auth = waitFor<AuthAnswer>(`${name} auth`, (resolve) => {
      answer = resolve;
    });
    const closedDoc = new Promise<string>((resolve) => {
      close = resolve;
    });

    documents.set(name, (frame) => {
      frames.push(frame);
      const decoder = decoding.createDecoder(frame);
      decoding.readVarString(decoder);
      const type = decoding.readVarUint(decoder);
      if (type === AUTH) {
        const kind = decoding.readVarUint(decoder);
        if (kind === AUTH_GRANTED) answer({ scope: decoding.readVarString(decoder) });
        if (kind === AUTH_DENIED) answer({ denied: decoding.readVarString(decoder) });
      } else if (type === SYNC || type === SYNC_REPLY) {
        const reply = encoding.createEncoder();
        encoding.writeVarString(reply, name);
        encoding.writeVarUint(reply, SYNC);
        const empty = encoding.length(reply);
        syncProtocol.readSyncMessage(decoder, reply, doc, SERVER);
        if (encoding.length(reply) > empty) ws.send(encoding.toUint8Array(reply));
      } else if (type === SYNC_STATUS) {
        const saved = decoding.readVarUint(decoder) === 1;
        const waiter = statuses.shift();
        if (waiter) waiter(saved);
        else handshake();
      } else if (type === CLOSE) {
        close(decoding.readVarString(decoder));
      }
    });
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === SERVER) return;
      ws.send(
        message(name, SYNC, (encoder) => {
          syncProtocol.writeUpdate(encoder, update);
        }),
      );
    });

    ws.send(
      message(name, AUTH, (encoder) => {
        encoding.writeVarUint(encoder, AUTH_TOKEN);
        // The session cookie authenticates; the token is unused (specs §10.3).
        encoding.writeVarString(encoder, '');
      }),
    );
    ws.send(
      message(name, SYNC, (encoder) => {
        syncProtocol.writeSyncStep1(encoder, doc);
      }),
    );

    const answered = await auth;
    if ('scope' in answered) await synced;
    else synced.catch(() => undefined);
    return {
      name,
      doc,
      auth: answered,
      frames,
      closed: closedDoc,
      change: (edit) => {
        const saved = waitFor<boolean>(`${name} sync status`, (resolve) => statuses.push(resolve));
        doc.transact(() => {
          edit(doc);
        });
        return saved;
      },
    };
  }

  const drop = async () => {
    ws.terminate();
    await closed;
  };

  return { ws, open, drop, closed, received };
}
