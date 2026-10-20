import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { createUserBody, updateUserBody } from '@vtt/shared/api';

import { users } from '../../db/schema.js';
import { generatePassword, hashPassword } from '../../domain/auth/password.js';
import { insertUser, prepareUser, type User } from '../../domain/users.js';
import { badRequest, notFound } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../auth.js';
import { parseInput } from '../validation.js';

const userIdParams = z.object({ id: z.uuid() });

/** What admins see about a user. */
function toAdminUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    mustChangePassword: user.mustChangePassword,
    disabled: user.disabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

const notOnYourself = () =>
  badRequest('cannot_modify_self', 'You cannot disable, demote or delete your own account.');

/** Instance user administration (FR-AUTH-02, FR-AUTH-06). Admin only. */
export function userRoutes({ app, db, sessions }: AppContext): void {
  const findUser = (id: string): User => {
    const user = db.select().from(users).where(eq(users.id, id)).get();
    if (!user) throw notFound('User not found.');
    return user;
  };

  app.get('/api/v1/users', (request) => {
    requireAdmin(request);
    const all = db.select().from(users).orderBy(asc(users.createdAt), asc(users.username)).all();
    return { users: all.map(toAdminUser) };
  });

  app.post('/api/v1/users', async (request, reply) => {
    requireAdmin(request);
    const body = parseInput(createUserBody, request.body);
    const oneTimePassword = generatePassword();
    const user = insertUser(
      db,
      await prepareUser({ ...body, password: oneTimePassword, mustChangePassword: true }),
    );
    return reply.code(201).send({ user: toAdminUser(user), oneTimePassword });
  });

  app.patch('/api/v1/users/:id', async (request) => {
    const session = requireAdmin(request);
    const { id } = parseInput(userIdParams, request.params);
    const body = parseInput(updateUserBody, request.body);
    const user = findUser(id);
    const isSelf = user.id === session.user.id;
    if (isSelf && (body.disabled === true || body.isAdmin === false)) throw notOnYourself();

    const oneTimePassword = body.resetPassword ? generatePassword() : undefined;
    const updated = db
      .update(users)
      .set({
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.isAdmin !== undefined && { isAdmin: body.isAdmin }),
        ...(body.disabled !== undefined && {
          disabledAt: body.disabled ? (user.disabledAt ?? new Date()) : null,
        }),
        ...(oneTimePassword !== undefined && {
          passwordHash: await hashPassword(oneTimePassword),
          mustChangePassword: true,
        }),
      })
      .where(eq(users.id, id))
      .returning()
      .get();

    // A disabled user or a reset password ends every session of that user.
    if (body.disabled === true || oneTimePassword !== undefined) {
      sessions.revokeAllForUser(id, isSelf ? session.id : undefined);
    }
    return {
      user: toAdminUser(updated),
      ...(oneTimePassword !== undefined && { oneTimePassword }),
    };
  });

  app.delete('/api/v1/users/:id', (request, reply) => {
    const session = requireAdmin(request);
    const { id } = parseInput(userIdParams, request.params);
    const user = findUser(id);
    if (user.id === session.user.id) throw notOnYourself();
    // Sessions and memberships cascade; tables and invites they created keep a null creator.
    // Chat messages (T-0205) keep their author name snapshot.
    db.delete(users).where(eq(users.id, id)).run();
    return reply.code(204).send();
  });
}
