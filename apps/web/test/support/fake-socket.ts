import { vi } from 'vitest';

/** A WebSocket the test drives: it opens, receives and drops only when told to. */
export class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly OPEN = 1;

  readyState: number = FakeSocket.CONNECTING;
  /** Every frame the client sent, parsed. */
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    super();
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000): void {
    this.drop(code);
  }

  /** The server accepted the connection. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  /** A frame from the server. */
  receive(event: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  }

  /** The connection closed, e.g. the server went away (1006) or the session ended (4401). */
  drop(code = 1006): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code }));
  }
}

/** Replaces the global WebSocket; returns the sockets the app opens, newest last. */
export function fakeWebSocket(): FakeSocket[] {
  const sockets: FakeSocket[] = [];
  vi.stubGlobal(
    'WebSocket',
    class extends FakeSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    },
  );
  return sockets;
}

let counter = 0;

/** A server event envelope. */
export function serverEvent(event: Record<string, unknown>): Record<string, unknown> {
  counter += 1;
  return { v: 1, id: `srv-${String(counter)}`, ...event };
}
