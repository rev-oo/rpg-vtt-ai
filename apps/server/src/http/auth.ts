import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { ActiveSession, IssuedSession, SessionService } from '../domain/auth/sessions.js';
import { safeEqual } from '../domain/auth/tokens.js';
import { AppError, forbidden, unauthorized } from '../errors.js';

import { clearedSessionCookieOptions, SESSION_COOKIE, sessionCookieOptions } from './cookies.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The caller's session, resolved from the session cookie on every request. */
    session: ActiveSession | null;
  }
}

export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Resolves `request.session` and enforces CSRF (specs §10.1): every mutating request made with
 * a session must carry `X-CSRF-Token` matching that session. Requests without a session (login,
 * setup) only accept JSON bodies, which a cross-site form cannot send without a CORS preflight.
 */
export function registerAuth(app: FastifyInstance, sessions: SessionService): void {
  app.decorateRequest('session', null);

  app.addHook('onRequest', (request, _reply, done) => {
    const token = request.cookies[SESSION_COOKIE];
    request.session = token ? sessions.validate(token) : null;

    if (request.session && !SAFE_METHODS.has(request.method)) {
      const header = request.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !safeEqual(header, request.session.csrfToken)) {
        done(new AppError(403, 'csrf_failed', 'Missing or invalid CSRF token.'));
        return;
      }
    }
    done();
  });
}

export function requireSession(request: FastifyRequest): ActiveSession {
  if (!request.session) throw unauthorized();
  return request.session;
}

export function requireAdmin(request: FastifyRequest): ActiveSession {
  const session = requireSession(request);
  if (!session.user.isAdmin) throw forbidden();
  return session;
}

export function setSessionCookie(reply: FastifyReply, publicUrl: URL, issued: IssuedSession): void {
  reply.setCookie(SESSION_COOKIE, issued.token, sessionCookieOptions(publicUrl, issued.expiresAt));
}

export function clearSessionCookie(reply: FastifyReply, publicUrl: URL): void {
  reply.clearCookie(SESSION_COOKIE, clearedSessionCookieOptions(publicUrl));
}
