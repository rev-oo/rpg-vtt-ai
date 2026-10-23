import type { FastifyRequest } from 'fastify';

import type { Subject } from '@vtt/shared';

import type { Db } from '../db/client.js';
import {
  findActor,
  findItem,
  findJournalEntry,
  type Actor,
  type Item,
  type JournalEntry,
} from '../db/repositories/index.js';
import {
  actorAccess,
  itemAccess,
  requireWritableSystem,
  type EntityAccess,
} from '../domain/entities.js';
import { journalEntryAccess } from '../domain/journal.js';
import { findMembership, findTable, type GameTable, type Member } from '../domain/tables.js';
import { forbidden, notFound } from '../errors.js';

import { requireSession } from './auth.js';

interface EntityContext {
  table: GameTable;
  membership: Member;
  subject: Subject;
}

/** Membership of the table an entity belongs to, or `undefined` for non-members. */
function memberOf(db: Db, request: FastifyRequest, tableId: string): EntityContext | undefined {
  const session = requireSession(request);
  const membership = findMembership(db, tableId, session.user.id);
  const table = membership && findTable(db, tableId);
  if (!membership || !table) return undefined;
  return { table, membership, subject: { userId: membership.userId, role: membership.role } };
}

export interface ActorAccess extends EntityContext {
  actor: Actor;
  access: EntityAccess;
}

interface LookupOptions {
  /** Also find the entity in the trash (for restore). */
  includeDeleted?: boolean;
  /** Require edit access (403 if the caller can only read) and a writable table (409). */
  edit?: boolean;
}

/**
 * Resolves an actor the caller may see. Non-members and members without access get 404, so
 * actor ids cannot be probed (like tables, FR-AUTH-08).
 */
export function requireActor(
  db: Db,
  request: FastifyRequest,
  id: string,
  { includeDeleted = false, edit = false }: LookupOptions = {},
): ActorAccess {
  const actor = findActor(db, id, { includeDeleted });
  const context = actor && memberOf(db, request, actor.tableId);
  const access = context && actorAccess(context.subject, actor);
  if (!actor || !context || !access) throw notFound('Actor not found.');
  if (edit && access !== 'owner') throw forbidden();
  if (edit) requireWritableSystem(db, context.table);
  return { ...context, actor, access };
}

export interface ItemAccess extends EntityContext {
  item: Item;
  /** The owning actor, for owned items. */
  actor: Actor | undefined;
  access: EntityAccess;
}

/** Resolves an item the caller may see; owned items follow their actor's ownership. */
export function requireItem(
  db: Db,
  request: FastifyRequest,
  id: string,
  { includeDeleted = false, edit = false }: LookupOptions = {},
): ItemAccess {
  const item = findItem(db, id, { includeDeleted });
  const context = item && memberOf(db, request, item.tableId);
  // An owned item is only reachable while its actor is live.
  const actor = item?.actorId ? findActor(db, item.actorId) : undefined;
  const orphaned = item?.actorId !== null && !actor;
  const access = context && !orphaned ? itemAccess(context.subject, actor) : null;
  if (!item || !context || !access) throw notFound('Item not found.');
  if (edit && access !== 'owner') throw forbidden();
  if (edit) requireWritableSystem(db, context.table);
  return { ...context, item, actor, access };
}

export interface JournalEntryAccess extends EntityContext {
  entry: JournalEntry;
  access: EntityAccess;
}

/**
 * Resolves a journal entry the caller may see. Hidden entries are not found for players, like
 * entries of other tables, so their ids cannot be probed (FR-JOURNAL-03).
 */
export function requireJournalEntry(
  db: Db,
  request: FastifyRequest,
  id: string,
  { includeDeleted = false, edit = false }: LookupOptions = {},
): JournalEntryAccess {
  const entry = findJournalEntry(db, id, { includeDeleted });
  const context = entry && memberOf(db, request, entry.tableId);
  const access = context && journalEntryAccess(context.subject, entry);
  if (!entry || !context || !access) throw notFound('Journal entry not found.');
  if (edit && access !== 'owner') throw forbidden();
  if (edit) requireWritableSystem(db, context.table);
  return { ...context, entry, access };
}
