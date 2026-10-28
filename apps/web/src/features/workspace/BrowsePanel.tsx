import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import type { JournalListQuery } from '@vtt/shared/api';
import { cn } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { t } from '../../i18n/index.js';
import { ActorList } from '../entities/ActorList.js';
import { readFilters, toListQuery } from '../entities/filters.js';
import { ItemList } from '../entities/ItemList.js';
import { LIST_PAGE } from '../entities/paging.js';
import { JournalList } from '../journal/JournalList.js';
import type { TableData } from '../table/table-data.js';

import { PANEL_TABS, type PanelTab } from './layout-store.js';
import { usePanelList } from './use-panel-list.js';

const TAB_LABEL = {
  actors: 'actors.title',
  items: 'items.title',
  journal: 'journal.title',
} as const satisfies Record<PanelTab, string>;

export interface BrowsePanelProps {
  data: TableData;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
}

/** The workspace's lists: actors, items and journal, with their filters (ADR-059). */
export function BrowsePanel({ data, tab, onTab }: BrowsePanelProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label={t('workspace.browse')} className="flex flex-wrap gap-1">
        {PANEL_TABS.map((which) => (
          <button
            key={which}
            type="button"
            role="tab"
            id={`browse-tab-${which}`}
            aria-selected={tab === which}
            aria-controls="browse-tabpanel"
            className={cn(
              'rounded-lg px-3 py-1',
              tab === which ? 'bg-info-soft text-fg' : 'text-muted hover:text-fg',
            )}
            onClick={() => {
              onTab(which);
            }}
          >
            {t(TAB_LABEL[which])}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="browse-tabpanel" aria-labelledby={`browse-tab-${tab}`}>
        {tab === 'actors' && <ActorsTab data={data} />}
        {tab === 'items' && <ItemsTab data={data} />}
        {tab === 'journal' && <JournalTab data={data} />}
      </div>
    </div>
  );
}

const Loading = (): ReactElement => <p className="text-muted">{t('app.loading')}</p>;

function ActorsTab({ data }: { data: TableData }): ReactElement {
  const [params] = useSearchParams();
  const filters = readFilters(params);
  const query = { ...toListQuery(filters), limit: LIST_PAGE };
  const list = usePanelList(
    () => api.actorsPage(data.table.id, query),
    JSON.stringify(query),
    data,
  );
  if (!list.loaded) return <Loading />;
  return (
    <ActorList
      data={data}
      actors={list.rows}
      nextCursor={list.nextCursor}
      fetchPage={(cursor) => api.actorsPage(data.table.id, { ...query, cursor })}
      trash={filters.trash}
      error={list.error}
    />
  );
}

function ItemsTab({ data }: { data: TableData }): ReactElement {
  const [params] = useSearchParams();
  const filters = readFilters(params);
  const query = { ...toListQuery(filters), limit: LIST_PAGE };
  const list = usePanelList(() => api.itemsPage(data.table.id, query), JSON.stringify(query), data);
  if (!list.loaded) return <Loading />;
  return (
    <ItemList
      data={data}
      items={list.rows}
      nextCursor={list.nextCursor}
      fetchPage={(cursor) => api.itemsPage(data.table.id, { ...query, cursor })}
      trash={filters.trash}
      error={list.error}
    />
  );
}

function JournalTab({ data }: { data: TableData }): ReactElement {
  const [params] = useSearchParams();
  const { search, trash } = readFilters(params);
  const query: JournalListQuery = {
    ...(search.trim() && { search: search.trim() }),
    trash: trash ? 'restorable' : 'live',
    limit: LIST_PAGE,
  };
  const list = usePanelList(
    () => api.journalPage(data.table.id, query),
    JSON.stringify(query),
    data,
  );
  if (!list.loaded) return <Loading />;
  return (
    <JournalList
      data={data}
      entries={list.rows}
      nextCursor={list.nextCursor}
      fetchPage={(cursor) => api.journalPage(data.table.id, { ...query, cursor })}
      trash={trash}
      error={list.error}
    />
  );
}
