import { eq } from 'drizzle-orm';

import { changePasswordBody, loginBody, updateMeBody } from '@vtt/shared/api';

import { users } from '../../db/schema.js';
import { hashPassword, verifyPassword } from '../../domain/auth/password.js';
import { findUserByUsername, toPublicUser } from '../../domain/users.js';
import { AppError, badRequest } from '../../errors.js';
import type { AppContext } from '../app.js';
import { clearSessionCookie, requireSession, setSessionCookie } from '../auth.js';
import { SESSION_COOKIE } from '../cookies.js';
import { parseInput } from '../validation.js';

const invalidCredentials = () =>
  new AppError(401, 'invalid_credentials', 'Wrong username or password.');

/** Login, logout, current user and password change (FR-AUTH-03..05, FR-AUTH-07). */
export function authRoutes({ app, db, config, sessions, loginThrottle }: AppContext): void {
  // Verifying against a real hash when the user does not exist keeps response times equal,
  // so timing does not reveal which usernames exist.
  const dummyHash = hashPassword('timing-equaliser-not-a-password');

  app.post('/api/v1/auth/login', async (request, reply) => {
    const { username, password } = parseInput(loginBody, request.body);

    const retryAfterMs = loginThrottle.retryAfterMs(request.ip, username);
    if (retryAfterMs > 0) {
      reply.header('retry-after', String(Math.ceil(retryAfterMs / 1000)));
      throw new AppError(429, 'rate_limited', 'Too many failed login attempts. Try again later.');
    }

    const user = findUserByUsername(db, username);
    const valid = await verifyPassword(user?.passwordHash ?? (await dummyHash), password);
    if (!user || !valid) {
      loginThrottle.recordFailure(request.ip, username);
      throw invalidCredentials();
    }
    if (user.disabledAt) {
      throw new AppError(403, 'account_disabled', 'This account has been disabled.');
    }

    loginThrottle.recordSuccess(username);
    const issued = sessions.rotate(request.cookies[SESSION_COOKIE], user.id);
    setSessionCookie(reply, config.publicUrl, issued);
    return { user: toPublicUser(user), csrfToken: issued.csrfToken };
  });

  app.post('/api/v1/auth/logout', (request, reply) => {
    requireSession(request);
    const token = request.cookies[SESSION_COOKIE];
    if (token) sessions.revoke(token);
    clearSessionCookie(reply, config.publicUrl);
    return reply.code(204).send();
  });

  app.get('/api/v1/me', (request) => {
    const session = requireSession(request);
    return { user: toPublicUser(session.user), csrfToken: session.csrfToken };
  });

  app.patch('/api/v1/me', (request) => {
    const session = requireSession(request);
    const { displayName } = parseInput(updateMeBody, request.body);
    const updated = db
      .update(users)
      .set({ displayName })
      .where(eq(users.id, session.user.id))
      .returning()
      .get();
    return { user: toPublicUser(updated) };
  });

  app.post('/api/v1/me/password', async (request, reply) => {
    const session = requireSession(request);
    const { currentPassword, newPassword } = parseInput(changePasswordBody, request.body);
    const user = db.select().from(users).where(eq(users.id, session.user.id)).get();
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw badRequest('wrong_password', 'The current password is wrong.');
    }

    db.update(users)
      .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false })
      .where(eq(users.id, user.id))
      .run();
    // Sign out every other device; this one stays logged in.
    sessions.revokeAllForUser(user.id, session.id);
    return reply.code(204).send();
  });
}
