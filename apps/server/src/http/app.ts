import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Incoming request ids are reused only if they are short and log-safe. */
const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

export interface AppOptions {
  logger: FastifyBaseLogger;
}

/** Builds the Fastify application. Routes are registered by later tasks. */
export function buildApp({ logger }: AppOptions): FastifyInstance {
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

  return app;
}
