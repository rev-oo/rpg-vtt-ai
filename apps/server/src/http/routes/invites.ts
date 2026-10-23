import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { canManageInvites } from '@vtt/shared';
import { createInviteBody, signupBody, type InviteView } from '@vtt/shared/api';

import { gameTables, invites, members } from '../../db/schema.js';
import { generateId, generateToken, hashToken } from '../../domain/auth/tokens.js';
import { findMembership, toTableView } from '../../domain/tables.js';
import { insertUser, prepareUser, toPublicUser } from '../../domain/users.js';
import { AppError, gone, notFound } from '../../errors.js';
import type { AppContext } from '../app.js';
import { rateLimited, requireSession, setSessionCookie } from '../auth.js';
import { SESSION_COOKIE } from '../cookies.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const tableParams = z.object({ id: z.uuid() });
const inviteParams = z.object({ id: z.uuid(), inviteId: z.uuid() });
const tokenParams = z.object({ token: z.string().regex(/^[\w-]{43}$/) });

type Invite = typeof invites.$inferSelect;

function toInviteView(invite: Invite, now: Date): InviteView {
  const status = invite.revokedAt
    ? 'revoked'
    : invite.expiresAt && invite.expiresAt <= now
      ? 'expired'
      : 'active';
  return {
    id: invite.id,
    role: invite.role,
    status,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Table invite links with a role, expiry and revocation (FR-TABLE-03). While the registration
 * policy is `invite`, a link also lets someone without an account sign up (FR-ADMIN-01).
 */
export function inviteRoutes({
  app,
  db,
  config,
  now,
  sessions,
  instance,
  signupLimit,
}: AppContext): void {
  /** Resolves a raw token to a usable invite: 404 if unknown, 410 if revoked or expired. */
  const findUsableInvite = (token: string): Invite => {
    const invite = db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(token)))
      .get();
    if (!invite) throw notFound('Invite not found.');
    if (invite.revokedAt) throw gone('invite_revoked', 'This invite link has been revoked.');
    if (invite.expiresAt && invite.expiresAt <= now()) {
      throw gone('invite_expired', 'This invite link has expired.');
    }
    return invite;
  };

  app.get('/api/v1/tables/:id/invites', (request) => {
    const { id } = parseInput(tableParams, request.params);
    requireMember(db, request, id, canManageInvites);
    const rows = db
      .select()
      .from(invites)
      .where(eq(invites.tableId, id))
      .orderBy(desc(invites.createdAt))
      .all();
    const at = now();
    return { invites: rows.map((invite) => toInviteView(invite, at)) };
  });

  app.post('/api/v1/tables/:id/invites', (request, reply) => {
    const { id } = parseInput(tableParams, request.params);
    const { membership } = requireMember(db, request, id, canManageInvites);
    const { role, expiresInSeconds } = parseInput(createInviteBody, request.body);

    const token = generateToken();
    const createdAt = now();
    const invite = db
      .insert(invites)
      .values({
        id: generateId(),
        tableId: id,
        tokenHash: hashToken(token),
        role,
        createdBy: membership.userId,
        createdAt,
        expiresAt:
          expiresInSeconds === null
            ? null
            : new Date(createdAt.getTime() + expiresInSeconds * 1000),
      })
      .returning()
      .get();

    // The raw token is only ever returned here; the server keeps its hash.
    const url = new URL(`invite/${token}`, withTrailingSlash(config.publicUrl)).toString();
    return reply.code(201).send({ invite: toInviteView(invite, createdAt), token, url });
  });

  app.delete('/api/v1/tables/:id/invites/:inviteId', (request, reply) => {
    const { id, inviteId } = parseInput(inviteParams, request.params);
    requireMember(db, request, id, canManageInvites);
    const revoked = db
      .update(invites)
      .set({ revokedAt: now() })
      .where(and(eq(invites.id, inviteId), eq(invites.tableId, id)))
      .returning({ id: invites.id })
      .all();
    if (revoked.length === 0) throw notFound('Invite not found.');
    return reply.code(204).send();
  });

  /** Lets the join page show which table and role a link is for before accepting. */
  app.get('/api/v1/invites/:token', (request) => {
    // Without an account, only someone who may sign up needs to know where a link leads.
    if (instance().registration !== 'invite') requireSession(request);
    const { token } = parseInput(tokenParams, request.params);
    const invite = findUsableInvite(token);
    const table = db
      .select({ id: gameTables.id, name: gameTables.name })
      .from(gameTables)
      .where(eq(gameTables.id, invite.tableId))
      .get();
    if (!table) throw notFound('Invite not found.');
    return { invite: { role: invite.role, table } };
  });

  app.post('/api/v1/invites/:token/accept', (request) => {
    const session = requireSession(request);
    const { token } = parseInput(tokenParams, request.params);

    return db.transaction((tx) => {
      const invite = findUsableInvite(token);
      // Accepting twice, or as an existing member, changes nothing (never downgrades a GM).
      const existing = findMembership(tx, invite.tableId, session.user.id);
      if (!existing) {
        tx.insert(members)
          .values({ tableId: invite.tableId, userId: session.user.id, role: invite.role })
          .run();
      }
      const table = tx.select().from(gameTables).where(eq(gameTables.id, invite.tableId)).get();
      if (!table) throw notFound('Invite not found.');
      return {
        table: toTableView(tx, table, existing?.role ?? invite.role),
        joined: !existing,
      };
    });
  });

  app.post('/api/v1/invites/:token/signup', async (request, reply) => {
    if (instance().registration !== 'invite') {
      throw new AppError(403, 'registration_closed', 'Sign-up is closed on this instance.');
    }
    // Each sign-up costs a password hash and makes an account; a shared link must not let
    // one client make them in bulk.
    const retryAfterMs = signupLimit.retryAfterMs(request.ip);
    if (retryAfterMs > 0) throw rateLimited(reply, retryAfterMs, 'Too many sign-ups.');
    const { token } = parseInput(tokenParams, request.params);
    findUsableInvite(token);
    const input = parseInput(signupBody, request.body);
    signupLimit.record(request.ip);
    const prepared = await prepareUser(input);

    const { user, table } = db.transaction((tx) => {
      // Checked again: the link may have been revoked while the password was hashed.
      const invite = findUsableInvite(token);
      const user = insertUser(tx, prepared);
      tx.insert(members)
        .values({ tableId: invite.tableId, userId: user.id, role: invite.role })
        .run();
      const table = tx.select().from(gameTables).where(eq(gameTables.id, invite.tableId)).get();
      if (!table) throw notFound('Invite not found.');
      return { user, table: toTableView(tx, table, invite.role) };
    });

    const issued = sessions.rotate(request.cookies[SESSION_COOKIE], user.id);
    setSessionCookie(reply, config.publicUrl, issued);
    return reply.code(201).send({ user: toPublicUser(user), csrfToken: issued.csrfToken, table });
  });
}

function withTrailingSlash(url: URL): URL {
  return url.pathname.endsWith('/') ? url : new URL(`${url.pathname}/`, url);
}
