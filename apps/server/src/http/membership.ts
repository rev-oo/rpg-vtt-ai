import type { FastifyRequest } from 'fastify';

import type { TableRole } from '@vtt/shared';

import type { Db } from '../db/client.js';
import { findMembership, findTable, type GameTable, type Member } from '../domain/tables.js';
import { forbidden, notFound } from '../errors.js';

import { requireSession } from './auth.js';

export interface TableAccess {
  table: GameTable;
  membership: Member;
}

/**
 * Resolves the caller's membership of a table. Non-members get 404 rather than 403, so table
 * ids cannot be probed; instance admins get no special access (FR-AUTH-08).
 */
export function requireMember(
  db: Db,
  request: FastifyRequest,
  tableId: string,
  /** A `@vtt/shared` permission check, e.g. `canManageTable`; 403 if it fails. */
  isAllowed?: (role: TableRole) => boolean,
): TableAccess {
  const session = requireSession(request);
  const membership = findMembership(db, tableId, session.user.id);
  const table = membership && findTable(db, tableId);
  if (!membership || !table) throw notFound('Table not found.');
  if (isAllowed && !isAllowed(membership.role)) throw forbidden();
  return { table, membership };
}
