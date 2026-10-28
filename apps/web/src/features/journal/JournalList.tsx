import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { canCreateJournal, canSetOwnership } from '@vtt/shared';
import type { JournalEntryView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api, type ListPage } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import type { EntityFilters } from '../entities/filters.js';
import { ListFilters } from '../entities/ListFilters.js';
import { LoadMore } from '../entities/LoadMore.js';
import { OwnershipDialog } from '../entities/OwnershipDialog.js';
import { usePagedList } from '../entities/paging.js';
import type { TableData } from '../table/table-data.js';
import { DocumentLink } from '../workspace/DocumentLink.js';
import { entryPanelId } from '../workspace/panel-ids.js';

import { CreateJournalDialog } from './CreateJournalDialog.js';

export interface JournalListProps {
  data: TableData;
  /** The filtered list from the route loader. */
  entries: readonly JournalEntryView[];
  /** The page after the loader's, if any (ADR-057). */
  nextCursor: string | null;
  fetchPage: (cursor: string) => Promise<ListPage<JournalEntryView>>;
  filters: EntityFilters;
  onFilters: (filters: EntityFilters) => void;
  error: string | null;
}

/**
 * The table's journal (FR-JOURNAL-01..03). GMs and assistants create entries, which start
 * hidden, and reveal them when the players should read them.
 */
export function JournalList({
  data,
  entries: firstPage,
  nextCursor,
  fetchPage,
  filters,
  onFilters,
  error,
}: JournalListProps): ReactElement {
  const { trash } = filters;
  const paged = usePagedList(firstPage, nextCursor, fetchPage);
  const entries = paged.rows;
  const { table, members } = data;
  const revalidator = useRevalidator();
  const [creating, setCreating] = useState(false);
  const [editingOwnership, setEditingOwnership] = useState<JournalEntryView | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const manages = canSetOwnership(table.role);

  /** Runs an action, reports it and reloads the list. */
  const run = async (action: () => Promise<string>) => {
    setFailure(null);
    try {
      setStatus(await action());
      await revalidator.revalidate();
    } catch (caught) {
      setStatus(null);
      setFailure(errorMessage(caught));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <ListFilters searchLabel={t('journal.search')} value={filters} onChange={onFilters} />
        </div>
        {canCreateJournal(table.role) && (
          <Button
            variant="primary"
            onClick={() => {
              setCreating(true);
            }}
          >
            {t('journal.new')}
          </Button>
        )}
      </div>

      {(error ?? failure) && <Alert tone="error">{error ?? failure}</Alert>}
      {status && (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      )}
      {entries.length === 0 && !error && (
        <p className="text-muted">{t(trash ? 'journal.trashEmpty' : 'journal.empty')}</p>
      )}

      <ul className="flex list-none flex-col gap-2 p-0" aria-label={t('journal.title')}>
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="truncate font-semibold">{entry.title}</h3>
              <p className="flex flex-wrap gap-x-2 text-sm text-muted">
                {entry.hidden && <span>{t('journal.hidden')}</span>}
                {entry.hidden && <span aria-hidden="true">·</span>}
                <span>{t(`entities.access.${entry.access}`)}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {trash ? (
                <Button
                  onClick={() =>
                    void run(async () => {
                      await api.restoreJournalEntry(entry.id);
                      return t('entities.restored', { name: entry.title });
                    })
                  }
                >
                  {t('entities.restore')}
                </Button>
              ) : (
                <>
                  <DocumentLink
                    tableId={table.id}
                    target={{ kind: 'entry', id: entryPanelId(entry.id), entryId: entry.id }}
                    className="self-center"
                    label={`${t('journal.open')}: ${entry.title}`}
                  >
                    {t('journal.open')}
                  </DocumentLink>
                  {manages && (
                    <Button
                      onClick={() =>
                        void run(async () => {
                          await api.updateJournalEntry(entry.id, { hidden: !entry.hidden });
                          return t(entry.hidden ? 'journal.revealed' : 'journal.hiddenNow', {
                            name: entry.title,
                          });
                        })
                      }
                    >
                      {t(entry.hidden ? 'journal.reveal' : 'journal.hide')}
                    </Button>
                  )}
                  {manages && (
                    <Button
                      onClick={() => {
                        setEditingOwnership(entry);
                      }}
                    >
                      {t('ownership.open')}
                    </Button>
                  )}
                  {entry.access === 'owner' && (
                    <Button
                      onClick={() =>
                        void run(async () => {
                          await api.deleteJournalEntry(entry.id);
                          return t('entities.deleted', { name: entry.title });
                        })
                      }
                    >
                      {t('entities.delete')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {paged.error && <Alert tone="error">{paged.error}</Alert>}
      {paged.more && <LoadMore loading={paged.loading} onLoad={paged.loadMore} />}

      <CreateJournalDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
        onCreate={async (input) => {
          const entry = await api.createJournalEntry(table.id, input);
          setCreating(false);
          setStatus(t('entities.created', { name: entry.title }));
          await revalidator.revalidate();
        }}
      />
      <OwnershipDialog
        target={
          editingOwnership && {
            id: editingOwnership.id,
            name: editingOwnership.title,
            ownership: editingOwnership.ownership,
          }
        }
        members={members}
        onClose={() => {
          setEditingOwnership(null);
        }}
        onSave={async (ownership) => {
          if (!editingOwnership) return;
          const entry = await api.updateJournalEntry(editingOwnership.id, { ownership });
          setEditingOwnership(null);
          setStatus(t('ownership.saved', { name: entry.title }));
          void revalidator.revalidate();
        }}
      />
    </div>
  );
}
