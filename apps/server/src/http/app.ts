import { randomUUID } from 'node:crypto';
import path from 'node:path';

import fastifyCookie from '@fastify/cookie';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import type { Rng } from '@vtt/formula';
import type { InstanceSettings } from '@vtt/shared/api';

import type { Config } from '../config/index.js';
import type { Db } from '../db/client.js';
import { LoginThrottle } from '../domain/auth/login-throttle.js';
import { SessionService } from '../domain/auth/sessions.js';
import { instanceDefaults, readInstanceSettings } from '../domain/instance.js';
import { secureRng } from '../domain/rolls.js';
import { AppError } from '../errors.js';
import { PluginRegistry } from '../plugins/registry.js';
import {
  collabSocket,
  registerCollab,
  type Collab,
  type CollabTiming,
} from '../realtime/collab.js';
import { eventsSocket, registerEvents } from '../realtime/events-socket.js';
import type { EventHub } from '../realtime/hub.js';

import { registerAuth } from './auth.js';
import { actorRoutes } from './routes/actors.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { instanceRoutes } from './routes/instance.js';
import { inviteRoutes } from './routes/invites.js';
import { itemRoutes } from './routes/items.js';
import { journalRoutes } from './routes/journal.js';
import { memberRoutes } from './routes/members.js';
import { pluginAssetRoutes } from './routes/plugin-assets.js';
import { pluginRoutes } from './routes/plugins.js';
import { rollRoutes } from './routes/rolls.js';
import { setupRoutes } from './routes/setup.js';
import { systemRoutes } from './routes/systems.js';
import { tableRoutes } from './routes/tables.js';
import { userRoutes } from './routes/users.js';
import { scheduleTrashPurge } from './trash-purge.js';
import { installValidationMessages } from './validation.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Incoming request ids are reused only if they are short and log-safe. */
const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

export interface AppOptions {
  logger: FastifyBaseLogger;
  db: Db;
  config: Config;
  /** Clock override for tests. */
  now?: () => Date;
  /** Login rate limiter override for tests. */
  loginThrottle?: LoginThrottle;
  /** Dice RNG override for tests; rolls are cryptographically random otherwise. */
  rng?: Rng;
  /** The plugin registry; by default one over `DATA_DIR/plugins` that has not scanned yet. */
  plugins?: PluginRegistry;
  /** Document store and unload delays; tests shorten them. */
  collabTiming?: CollabTiming;
}

/** Everything a route module needs. */
export interface AppContext {
  app: FastifyInstance;
  db: Db;
  config: Config;
  sessions: SessionService;
  loginThrottle: LoginThrottle;
  /** Event socket fan-out (specs §10.2). */
  events: EventHub;
  /** The application clock; routes use it instead of `new Date()` so tests can move time. */
  now: () => Date;
  /** The dice RNG (FR-CHAT-04). */
  rng: Rng;
  plugins: PluginRegistry;
  /** The Yjs document server behind `/ws/collab` (specs §10.3). */
  collab: Collab;
  /** The current instance settings (FR-ADMIN-01). */
  instance: () => InstanceSettings;
}

/** Builds the Fastify application with every route registered. */
export async function buildApp({
  logger,
  db,
  config,
  now = () => new Date(),
  loginThrottle = new LoginThrottle(),
  rng = secureRng,
  plugins = new PluginRegistry({
    db,
    dir: path.join(config.dataDir, 'plugins'),
    logger,
    now,
  }),
  collabTiming,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: toTrustProxyOption(config.trustProxy),
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
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

  installValidationMessages();
  registerErrorHandling(app);
  // JSON is the only accepted body type. A cross-site HTML form can send text/plain without a
  // CORS preflight, which would bypass the CSRF reasoning in ./auth.ts.
  app.removeContentTypeParser('text/plain');
  await app.register(fastifyCookie);

  const defaults = instanceDefaults(config.sessionTtlSeconds);
  const instance = () => readInstanceSettings(db, defaults);
  const sessions = new SessionService({
    db,
    ttlSeconds: () => instance().sessionLifetimeSeconds,
    now,
  });
  registerAuth(app, sessions);
  const collab = registerCollab(app, {
    db,
    sessions,
    definition: (id) => plugins.definition(id),
    now,
    timing: collabTiming,
  });
  const events = await registerEvents(app, { db, sessions });

  const context: AppContext = {
    app,
    db,
    config,
    sessions,
    loginThrottle,
    events,
    now,
    rng,
    plugins,
    collab,
    instance,
  };
  setupRoutes(context);
  instanceRoutes(context);
  authRoutes(context);
  userRoutes(context);
  systemRoutes(context);
  pluginRoutes(context);
  pluginAssetRoutes(context);
  tableRoutes(context);
  memberRoutes(context);
  inviteRoutes(context);
  actorRoutes(context);
  itemRoutes(context);
  journalRoutes(context);
  chatRoutes(context);
  rollRoutes(context);
  eventsSocket(context);
  collabSocket(context);

  scheduleTrashPurge(app, { db, retentionMs: config.softDeleteRetentionMs, now });

  return app;
}

/** Fastify's types omit the numeric "trust N hops" form, so express it as a function. */
function toTrustProxyOption(
  trustProxy: boolean | number,
): boolean | ((address: string, hop: number) => boolean) {
  if (typeof trustProxy === 'boolean') return trustProxy;
  return (_address, hop) => hop < trustProxy;
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
