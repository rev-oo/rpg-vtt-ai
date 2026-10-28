import { z } from 'zod';

import {
  canCreateJournal,
  canSetOwnership,
  DEFAULT_JOURNAL_OWNERSHIP,
  isGmLike,
} from '@vtt/shared';
import { createJournalBody, journalListQuery, updateJournalBody } from '@vtt/shared/api';

import {
  createJournalEntry,
  findJournalEntry,
  listJournalEntries,
  restoreJournalEntry,
  softDeleteJournalEntry,
  updateJournalEntry,
  type Retention,
} from '../../db/repositories/index.js';
import { requireWritableTable } from '../../domain/entities.js';
import { journalEntryAccess, toJournalView } from '../../domain/journal.js';
import { conflict, forbidden, gone, notFound } from '../../errors.js';
import { publishJournalChanged } from '../../realtime/notify.js';
import type { AppContext } from '../app.js';
import { requireJournalEntry } from '../entities.js';
import { requireMember } from '../membership.js';
import { listPage, nameKey } from '../pages.js';
import { parseInput } from '../validation.js';

const idParams = z.object({ id: z.uuid() });

/**
 * Journal entry metadata (FR-JOURNAL-01..03): GMs and assistants create, hide and reveal
 * entries; owners may rename them. The body is the collaborative document `journal:<id>:main`.
 */
export function journalRoutes({ app, db, config, events, now }: AppContext): void {
  const retention = (): Retention => ({ now: now(), retentionMs: config.softDeleteRetentionMs });

  app.get('/api/v1/tables/:id/journal', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { membership } = requireMember(db, request, id);
    const query = parseInput(journalListQuery, request.query);
    const subject = { userId: membership.userId, role: membership.role };

    // Hidden entries never leave the database for players (FR-JOURNAL-03).
    const filter = { ...query, includeHidden: isGmLike(membership.role) };
    const { views, nextCursor } = listPage(
      {
        fetch: (window) => listJournalEntries(db, id, filter, retention(), window),
        keyOf: (entry) => nameKey(entry.title, entry.id),
        view: (entry) => {
          const access = journalEntryAccess(subject, entry);
          // The trash lists what the caller could restore.
          if (!access || (query.trash === 'restorable' && access !== 'owner')) return undefined;
          return toJournalView(entry, access);
        },
      },
      query,
    );
    return { entries: views, nextCursor };
  });

  app.post('/api/v1/tables/:id/journal', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { table, membership } = requireMember(db, request, id, canCreateJournal);
    const body = parseInput(createJournalBody, request.body);
    requireWritableTable(db, table);

    const entry = createJournalEntry(
      db,
      {
        tableId: id,
        title: body.title,
        ownership: body.ownership ?? DEFAULT_JOURNAL_OWNERSHIP,
        hidden: body.hidden,
        createdBy: membership.userId,
      },
      now(),
    );
    publishJournalChanged(events, 'created', entry);
    return reply.code(201).send({ entry: toJournalView(entry, 'owner') });
  });

  app.get('/api/v1/journal/:id', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { entry, access } = requireJournalEntry(db, request, id);
    return { entry: toJournalView(entry, access) };
  });

  app.patch('/api/v1/journal/:id', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { entry, membership, subject } = requireJournalEntry(db, request, id, { edit: true });
    const body = parseInput(updateJournalBody, request.body);
    if ((body.ownership || body.hidden !== undefined) && !canSetOwnership(membership.role)) {
      throw forbidden('Only the GM can hide entries or change their ownership.');
    }

    const updated = updateJournalEntry(db, entry.id, body, now());
    if (!updated) throw notFound('Journal entry not found.');
    publishJournalChanged(events, 'updated', updated, entry);
    // Only GMs hide entries or change ownership, and they keep access (FR-JOURNAL-02).
    return { entry: toJournalView(updated, journalEntryAccess(subject, updated) ?? 'owner') };
  });

  app.delete('/api/v1/journal/:id', (request, reply) => {
    const { id } = parseInput(idParams, request.params);
    const { entry } = requireJournalEntry(db, request, id, { edit: true });
    softDeleteJournalEntry(db, id, now());
    publishJournalChanged(events, 'deleted', entry);
    return reply.code(204).send();
  });

  app.post('/api/v1/journal/:id/restore', (request) => {
    const { id } = parseInput(idParams, request.params);
    const { access } = requireJournalEntry(db, request, id, { includeDeleted: true, edit: true });
    const result = restoreJournalEntry(db, id, retention());
    if (result === 'not_deleted') throw conflict('not_deleted', 'The entry is not deleted.');
    if (result === 'expired') {
      throw gone('restore_expired', 'The entry was deleted too long ago to restore.');
    }
    const restored = findJournalEntry(db, id);
    if (!restored) throw notFound('Journal entry not found.');
    publishJournalChanged(events, 'restored', restored);
    return { entry: toJournalView(restored, access) };
  });
}
