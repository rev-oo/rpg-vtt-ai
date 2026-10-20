import { and, asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { canManageMembers } from '@vtt/shared';
import { updateMemberBody, type MemberView } from '@vtt/shared/api';

import type { DbOrTx } from '../../db/client.js';
import { findActor, removeEntityOwner } from '../../db/repositories/index.js';
import { members, users } from '../../db/schema.js';
import { actorAccess } from '../../domain/entities.js';
import { findMembership, type Member } from '../../domain/tables.js';
import { badRequest, conflict, forbidden, notFound } from '../../errors.js';
import type { AppContext } from '../app.js';
import { requireMember } from '../membership.js';
import { parseInput } from '../validation.js';

const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });
const tableParams = z.object({ id: z.uuid() });

function countGms(db: DbOrTx, tableId: string): number {
  return (
    db
      .select({ n: count() })
      .from(members)
      .where(and(eq(members.tableId, tableId), eq(members.role, 'gm')))
      .get()?.n ?? 0
  );
}

/** GM first, then assistants, players and spectators. */
const roleRank = sql`case ${members.role} when 'gm' then 0 when 'assistant' then 1 when 'player' then 2 else 3 end`;

const lastGm = () => conflict('last_gm', 'A table needs a GM. Make someone else GM first.');

/** Members, roles and default characters (FR-TABLE-04, 05, 07). */
export function memberRoutes({ app, db }: AppContext): void {
  /** A default character must be a live actor of this table that the member owns. */
  const requireOwnCharacter = (tableId: string, member: Member, actorId: string): void => {
    const actor = findActor(db, actorId);
    const subject = { userId: member.userId, role: member.role };
    if (actor?.tableId !== tableId || actorAccess(subject, actor) !== 'owner') {
      throw badRequest('invalid_character', 'Pick one of your own characters on this table.');
    }
  };

  const findTarget = (tableId: string, userId: string): Member => {
    const target = findMembership(db, tableId, userId);
    if (!target) throw notFound('Member not found.');
    return target;
  };

  app.get('/api/v1/tables/:id/members', (request) => {
    const { id } = parseInput(tableParams, request.params);
    requireMember(db, request, id);
    const rows = db
      .select({
        userId: members.userId,
        username: users.username,
        displayName: users.displayName,
        role: members.role,
        defaultCharacterId: members.defaultCharacterId,
        joinedAt: members.joinedAt,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.tableId, id))
      .orderBy(asc(roleRank), asc(users.displayName), asc(users.username))
      .all();
    const list: MemberView[] = rows.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }));
    return { members: list };
  });

  app.patch('/api/v1/tables/:id/members/:userId', (request) => {
    const { id, userId } = parseInput(memberParams, request.params);
    const { membership } = requireMember(db, request, id);
    const body = parseInput(updateMemberBody, request.body);
    const target = findTarget(id, userId);
    const isSelf = target.userId === membership.userId;

    // Only the GM changes roles (FR-TABLE-07); each member picks their own default character.
    if (body.role !== undefined && !canManageMembers(membership.role)) throw forbidden();
    if (body.defaultCharacterId !== undefined && !isSelf) {
      throw badRequest('not_own_member', 'You can only set your own default character.');
    }
    if (body.defaultCharacterId) requireOwnCharacter(id, membership, body.defaultCharacterId);

    const updated = db.transaction((tx) => {
      if (target.role === 'gm' && body.role !== undefined && body.role !== 'gm') {
        if (countGms(tx, id) <= 1) throw lastGm();
      }
      return tx
        .update(members)
        .set(body)
        .where(and(eq(members.tableId, id), eq(members.userId, userId)))
        .returning()
        .get();
    });
    return {
      member: {
        userId: updated.userId,
        role: updated.role,
        defaultCharacterId: updated.defaultCharacterId,
      },
    };
  });

  app.delete('/api/v1/tables/:id/members/:userId', (request, reply) => {
    const { id, userId } = parseInput(memberParams, request.params);
    const { membership } = requireMember(db, request, id);
    const target = findTarget(id, userId);
    // The GM removes members; anyone may leave.
    if (!canManageMembers(membership.role) && target.userId !== membership.userId) {
      throw forbidden();
    }

    db.transaction((tx) => {
      if (target.role === 'gm' && countGms(tx, id) <= 1) throw lastGm();
      tx.delete(members)
        .where(and(eq(members.tableId, id), eq(members.userId, userId)))
        .run();
      // Their actors and journal entries stay on the table, without their level (FR-TABLE-04).
      removeEntityOwner(tx, id, userId);
    });
    return reply.code(204).send();
  });
}
