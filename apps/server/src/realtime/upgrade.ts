import type { preValidationHookHandler } from 'fastify';

import type { Config } from '../config/index.js';

/**
 * Whether a browser opened the socket from this instance's own page. Cookies ride along on
 * cross-site upgrades too, so the Origin is checked (cross-site WebSocket hijacking).
 * Clients that send no Origin are not browsers.
 */
function isSameOrigin(origin: string | undefined, host: string | undefined, publicUrl: URL) {
  if (origin === undefined) return true;
  if (origin === publicUrl.origin) return true;
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Accepts a WebSocket upgrade only with a session, from this instance's own pages. */
export function upgradeGuard(config: Pick<Config, 'publicUrl'>): preValidationHookHandler {
  return (request, reply, done) => {
    if (!request.session) {
      void reply
        .code(401)
        .send({ error: { code: 'unauthenticated', message: 'Authentication required.' } });
      return;
    }
    if (!isSameOrigin(request.headers.origin, request.headers.host, config.publicUrl)) {
      void reply.code(403).send({ error: { code: 'forbidden', message: 'Bad origin.' } });
      return;
    }
    done();
  };
}
