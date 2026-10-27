import { vi } from 'vitest';

export interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Handler = FakeResponse | ((body: unknown, headers: Headers) => FakeResponse);

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

/**
 * Replaces `fetch` with handlers keyed by `"METHOD /path"` (relative to /api/v1). Unhandled
 * requests fail the test with a 599.
 */
export function fakeApi(handlers: Record<string, Handler>): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = input.replace(/^\/api\/v1/, '');
      const headers = new Headers(init.headers);
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body, headers });
      const handler = handlers[`${method} ${path}`];
      const res =
        typeof handler === 'function'
          ? handler(body, headers)
          : (handler ?? { status: 599, body: { error: { code: 'unhandled', message: path } } });
      const status = res.status ?? 200;
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(res.body ?? {}), {
          status,
          headers: { 'content-type': 'application/json', ...res.headers },
        }),
      );
    }),
  );
  return { calls };
}

export const USER = {
  id: 'u1',
  username: 'alice',
  displayName: 'Alice',
  isAdmin: false,
  mustChangePassword: false,
};

export const SESSION = { user: USER, csrfToken: 'csrf-123' };

export const UNAUTHENTICATED: FakeResponse = {
  status: 401,
  body: { error: { code: 'unauthenticated', message: 'Authentication required.' } },
};

export const TABLE = {
  id: 't1',
  name: 'Crimson Throne',
  description: 'Weekly game',
  systemId: 'tiny-d20',
  systemName: 'Tiny d20',
  systemVersion: '1.0.0',
  settings: {},
  playersMayCreateAnyActorType: false,
  systemAvailable: true,
  archivedAt: null,
  role: 'gm',
  createdAt: '2026-10-19T00:00:00.000Z',
};
