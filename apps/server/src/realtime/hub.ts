import { randomUUID } from 'node:crypto';

import type { WebSocket } from 'ws';

import type { Subject, TableRole } from '@vtt/shared';
import { EVENTS_PROTOCOL_VERSION, type ServerEvent } from '@vtt/shared/api';

/** A server event before the hub stamps the version and id. */
export type OutgoingEvent = ServerEvent extends infer E
  ? E extends ServerEvent
    ? Omit<E, 'v' | 'id'>
    : never
  : never;

/** One open `/ws/events` socket and the tables it listens to. */
export interface Connection {
  readonly socket: WebSocket;
  readonly userId: string;
  /** Raw session token, re-validated on every heartbeat. */
  readonly sessionToken: string;
  readonly tables: Set<string>;
  /** Cleared on each heartbeat, set again by the client's pong. */
  alive: boolean;
}

/** Close code for a socket whose session ended (logout, expiry, password change). */
export const SESSION_ENDED = 4401;

export interface EventHubOptions {
  /** The current members of a table and their roles. */
  membersOf: (tableId: string) => ReadonlyMap<string, TableRole>;
  /** Whether a session token is still valid. */
  isSessionValid: (token: string) => boolean;
}

/**
 * Tracks event sockets and fans server events out per table (specs §10.2). Audience checks
 * run here, against the current membership, before anything is sent.
 */
export class EventHub {
  private readonly connections = new Set<Connection>();
  private readonly subscribers = new Map<string, Set<Connection>>();

  constructor(private readonly options: EventHubOptions) {}

  add(connection: Connection): void {
    this.connections.add(connection);
  }

  remove(connection: Connection): void {
    for (const tableId of connection.tables) this.unsubscribe(connection, tableId);
    this.connections.delete(connection);
  }

  subscribe(connection: Connection, tableId: string): void {
    connection.tables.add(tableId);
    let set = this.subscribers.get(tableId);
    if (!set) {
      set = new Set();
      this.subscribers.set(tableId, set);
    }
    set.add(connection);
  }

  unsubscribe(connection: Connection, tableId: string): void {
    connection.tables.delete(tableId);
    const set = this.subscribers.get(tableId);
    set?.delete(connection);
    if (set?.size === 0) this.subscribers.delete(tableId);
  }

  /**
   * Sends an event to the table's subscribers who may receive it. Subscribers who are no
   * longer members are unsubscribed instead.
   */
  publish(tableId: string, event: OutgoingEvent, canReceive: (subject: Subject) => boolean): void {
    const set = this.subscribers.get(tableId);
    if (!set) return;
    const members = this.options.membersOf(tableId);
    const data = serialize(event);
    for (const connection of [...set]) {
      const role = members.get(connection.userId);
      if (!role) {
        this.unsubscribe(connection, tableId);
        continue;
      }
      if (canReceive({ userId: connection.userId, role })) sendRaw(connection.socket, data);
    }
  }

  /** Sends an event to one socket. */
  send(connection: Connection, event: OutgoingEvent): void {
    sendRaw(connection.socket, serialize(event));
  }

  /**
   * One heartbeat (every 25 s): drops sockets that missed the last ping or whose session
   * ended, and pings the rest.
   */
  sweep(): void {
    for (const connection of [...this.connections]) {
      if (!this.options.isSessionValid(connection.sessionToken)) {
        connection.socket.close(SESSION_ENDED, 'session ended');
        this.remove(connection);
      } else if (!connection.alive) {
        connection.socket.terminate();
        this.remove(connection);
      } else {
        connection.alive = false;
        connection.socket.ping();
      }
    }
  }

  /** Closes every socket, for shutdown. */
  closeAll(): void {
    for (const connection of [...this.connections]) {
      connection.socket.close(1001, 'server shutting down');
      this.remove(connection);
    }
  }

  get size(): number {
    return this.connections.size;
  }
}

function serialize(event: OutgoingEvent): string {
  return JSON.stringify({ v: EVENTS_PROTOCOL_VERSION, id: randomUUID(), ...event });
}

function sendRaw(socket: WebSocket, data: string): void {
  if (socket.readyState === socket.OPEN) socket.send(data);
}
