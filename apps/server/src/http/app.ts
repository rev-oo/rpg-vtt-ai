import { randomUUID } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import type { Config } from '../config/index.js';
import type { Db } from '../db/client.js';
import { SessionService } from '../domain/auth/sessions.js';
import { AppError } from '../errors.js';

import { registerAuth } from './auth.js';
import { setupRoutes } from './routes/setup.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Incoming request ids are reused only if they are short and log-safe. */
const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

export interface AppOptions {
  logger: FastifyBaseLogger;
  db: Db;
  config: Config;
  /** Clock override for tests. */
  now?: () => Date;
}

/** Everything a route module needs. */
export interface AppContext {
  app: FastifyInstance;
  db: Db;
  config: Config;
  sessions: SessionService;
}

/** Builds the Fastify application with every route registered. */
export async function buildApp({ logger, db, config, now }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: false,
    requestIdLogLabel: 'requestId',
    genReqId: (req) => {
      const incoming = req.headers[REQUEST_ID_HEADER];
      return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();
    },
  });

  // Propagate the request id to clients so they can quote it in bug reports (NFR-12).
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  registerErrorHandling(app);
  // JSON is the only accepted body type. A cross-site HTML form can send text/plain without a
  // CORS preflight, which would bypass the CSRF reasoning in ./auth.ts.
  app.removeContentTypeParser('text/plain');
  await app.register(fastifyCookie);

  const sessions = new SessionService({
    db,
    ttlSeconds: config.sessionTtlSeconds,
    ...(now && { now }),
  });
  registerAuth(app, sessions);

  const context: AppContext = { app, db, config, sessions };
  setupRoutes(context);

  return app;
}

/** Renders every error as `{ error: { code, message, details? } }` (specs §10.1). */
function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined && { details: error.details }),
        },
      });
    }
    // Fastify's own client errors (malformed JSON, unsupported media type, body too large).
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: { code: 'bad_request', message: (error as Error).message },
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } }),
  );
}
