import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { canManageInvites, INVITE_ROLES } from '@vtt/shared';

import { gameTables, invites, members } from '../../db/schema.js';
import { generateId, generateToken, hashToken } from '../../domain/auth/tokens.js';
import { findMembership, toTableView } from '../../domain/tables.js';
import { gone, notFound } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireSession } from '../auth.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const DAY_SECONDS = 24 * 60 * 60;

const tableParams = z.object({ id: z.uuid() });
const inviteParams = z.object({ id: z.uuid(), inviteId: z.uuid() });
const tokenParams = z.object({ token: z.string().regex(/^[\w-]{43}$/) });

const createInviteBody = z.object({
  role: z.enum(INVITE_ROLES),
  /** Lifetime in seconds; `null` never expires. Default: 7 days. */
  expiresInSeconds: z
    .number()
    .int()
    .min(60)
    .max(90 * DAY_SECONDS)
    .nullable()
    .default(7 * DAY_SECONDS),
});

type Invite = typeof invites.$inferSelect;

function toInviteView(invite: Invite, now: Date) {
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

/** Table invite links with a role, expiry and revocation (FR-TABLE-03). */
export function inviteRoutes({ app, db, config, now }: AppContext): void {
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
    requireSession(request);
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
        table: toTableView(table, existing?.role ?? invite.role),
        joined: !existing,
      };
    });
  });
}

function withTrailingSlash(url: URL): URL {
  return url.pathname.endsWith('/') ? url : new URL(`${url.pathname}/`, url);
}
