import { serverEventSchema, type ServerEvent } from '@vtt/shared/api';

/**
 * `connecting` until the first connection opens, `reconnecting` while it is down after that,
 * and `ended` once the server closed the session (4401).
 */
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'ended';

type EventListener = (event: ServerEvent) => void;
type StatusListener = (status: ConnectionStatus) => void;

/** Close code the server uses for a socket whose session ended (ADR-016). */
const SESSION_ENDED = 4401;
const MAX_BACKOFF_MS = 30_000;

export interface EventsClientOptions {
  url: string;
  /** Opens a socket; tests pass a fake. */
  createSocket?: (url: string) => WebSocket;
  /** Delay before reconnection attempt `n` (from 0). */
  backoff?: (attempt: number) => number;
}

/** Exponential backoff with jitter, capped at 30 s (specs §10.2). */
export function defaultBackoff(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

/**
 * The `/ws/events` connection (specs §10.2): reconnects with backoff and subscribes again to
 * every table someone listens to. Events missed while disconnected are recovered over REST
 * by the listeners, which see the status return to `open`.
 */
export class EventsClient {
  private socket: WebSocket | null = null;
  private readonly tables = new Map<string, number>();
  private readonly listeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private everOpened = false;
  status: ConnectionStatus = 'connecting';

  private readonly createSocket: (url: string) => WebSocket;
  private readonly backoff: (attempt: number) => number;

  constructor(private readonly options: EventsClientOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.backoff = options.backoff ?? defaultBackoff;
    this.connect();
  }

  /** Listens to a table until the returned function is called (once; later calls do nothing). */
  subscribe(tableId: string): () => void {
    const count = this.tables.get(tableId) ?? 0;
    this.tables.set(tableId, count + 1);
    if (count === 0) this.send({ type: 'subscribe', tableId });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const left = (this.tables.get(tableId) ?? 1) - 1;
      if (left > 0) {
        this.tables.set(tableId, left);
        return;
      }
      this.tables.delete(tableId);
      this.send({ type: 'unsubscribe', tableId });
    };
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Closes the socket for good (logout). */
  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close(1000);
    this.socket = null;
  }

  private connect(): void {
    this.setStatus(this.everOpened ? 'reconnecting' : 'connecting');
    const socket = this.createSocket(this.options.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.everOpened = true;
      for (const tableId of this.tables.keys()) this.send({ type: 'subscribe', tableId });
      this.setStatus('open');
    });
    socket.addEventListener('message', (message: MessageEvent) => {
      if (typeof message.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(message.data);
      } catch {
        return;
      }
      // Events from a newer server that this client does not know are skipped.
      const parsed = serverEventSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const listener of this.listeners) listener(parsed.data);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      if (event.code === SESSION_ENDED) {
        this.setStatus('ended');
        return;
      }
      this.setStatus(this.everOpened ? 'reconnecting' : 'connecting');
      this.timer = setTimeout(() => {
        this.connect();
      }, this.backoff(this.attempt));
      this.attempt += 1;
    });
  }

  private send(event: { type: 'subscribe' | 'unsubscribe'; tableId: string }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ v: 1, ...event }));
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

let shared: EventsClient | null = null;

/** The app's one events connection, opened on first use. */
export function eventsClient(): EventsClient {
  if (!shared) {
    const url = new URL('/ws/events', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    shared = new EventsClient({ url: url.toString() });
  }
  return shared;
}

/** Closes the connection, e.g. on logout; the next `eventsClient()` opens a new one. */
export function closeEventsClient(): void {
  shared?.close();
  shared = null;
}
