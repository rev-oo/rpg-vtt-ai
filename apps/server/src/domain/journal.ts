import { canEditJournal, canViewJournal, type Subject } from '@vtt/shared';
import type { JournalEntryView } from '@vtt/shared/api';

import type { JournalEntry } from '../db/repositories/index.js';

import { definedLevels, iso, type EntityAccess } from './entities.js';

/**
 * What a member may do with a journal entry, or `null` if they may not see it: hidden entries
 * are for GMs and assistants only (FR-JOURNAL-02, 03).
 */
export function journalEntryAccess(subject: Subject, entry: JournalEntry): EntityAccess | null {
  if (!canViewJournal(subject, entry)) return null;
  return canEditJournal(subject, entry) ? 'owner' : 'observer';
}

export function toJournalView(entry: JournalEntry, access: EntityAccess): JournalEntryView {
  return {
    id: entry.id,
    tableId: entry.tableId,
    title: entry.title,
    hidden: entry.hidden,
    ownership: { default: entry.ownership.default, users: definedLevels(entry.ownership.users) },
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    deletedAt: iso(entry.softDeletedAt),
    access,
  };
}
