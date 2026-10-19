import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { loadConfig, type Config } from '../../src/config/index.js';
import type { Db } from '../../src/db/client.js';
import type { LoginThrottle } from '../../src/domain/auth/login-throttle.js';
import { buildApp } from '../../src/http/app.js';
import { CSRF_HEADER } from '../../src/http/auth.js';
import { SESSION_COOKIE } from '../../src/http/cookies.js';
import { createLogger } from '../../src/logger/index.js';

import { createTestDb } from './db.js';
import { captureLogs } from './log-capture.js';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  config: Config;
  logs: ReturnType<typeof captureLogs>;
}

export async function createTestApp(
  options: { env?: Record<string, string>; now?: () => Date; loginThrottle?: LoginThrottle } = {},
): Promise<TestApp> {
  const db = createTestDb();
  const config = loadConfig(options.env ?? {});
  const logs = captureLogs();
  const app = await buildApp({
    logger: createLogger('info', logs),
    db,
    config,
    ...(options.now && { now: options.now }),
    ...(options.loginThrottle && { loginThrottle: options.loginThrottle }),
  });
  return { app, db, config, logs };
}

/** Credentials of a logged-in test client. */
export interface Client {
  cookie: string;
  csrfToken: string;
}

/** Extracts the session cookie and CSRF token from a login or setup response. */
export function clientFrom(res: LightMyRequestResponse): Client {
  const setCookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!setCookie) throw new Error(`No session cookie in response (${String(res.statusCode)})`);
  const body = res.json<{ csrfToken: string }>();
  return { cookie: `${SESSION_COOKIE}=${setCookie.value}`, csrfToken: body.csrfToken };
}

/** Headers for an authenticated request; pass `csrf: false` to omit the CSRF token. */
export function authHeaders(client: Client, { csrf = true } = {}): Record<string, string> {
  return { cookie: client.cookie, ...(csrf && { [CSRF_HEADER]: client.csrfToken }) };
}

export const ADMIN = { username: 'admin', displayName: 'Admin', password: 'admin-password-1' };

export async function login(
  app: FastifyInstance,
  credentials: { username: string; password: string },
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: credentials, headers });
}

/** Runs first-run setup and returns the admin's client. */
export async function setupAdmin(app: FastifyInstance): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/setup/admin', payload: ADMIN });
  if (res.statusCode !== 201) throw new Error(`setup failed: ${res.body}`);
  return clientFrom(res);
}

/** Has the admin create a user, then logs that user in with the one-time password. */
export async function createUserClient(
  app: FastifyInstance,
  admin: Client,
  username: string,
  extra: { isAdmin?: boolean } = {},
): Promise<{ client: Client; userId: string; password: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: authHeaders(admin),
    payload: { username, displayName: username, ...extra },
  });
  if (res.statusCode !== 201) throw new Error(`create user failed: ${res.body}`);
  const { user, oneTimePassword } = res.json<{ user: { id: string }; oneTimePassword: string }>();
  const client = clientFrom(await login(app, { username, password: oneTimePassword }));
  return { client, userId: user.id, password: oneTimePassword };
}
