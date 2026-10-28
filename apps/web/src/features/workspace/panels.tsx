import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import type { JournalListQuery } from '@vtt/shared/api';

import { api } from '../../api/endpoints.js';
import { t } from '../../i18n/index.js';
import { ChatPanel } from '../chat/ChatPanel.js';
import { CombatTracker } from '../combat/CombatTracker.js';
import { ActorList } from '../entities/ActorList.js';
import { ActorSheetPanel } from '../entities/ActorSheet.js';
import { readFilters, toListQuery, type EntityFilters } from '../entities/filters.js';
import { ItemList } from '../entities/ItemList.js';
import { LIST_PAGE } from '../entities/paging.js';
import { JournalEntryPanel } from '../journal/JournalEntryPanel.js';
import { JournalList } from '../journal/JournalList.js';
import { MembersPanel } from '../members/MembersPanel.js';
import { TableSettings } from '../settings/TableSettings.js';
import { DicePane } from '../table/DicePane.js';
import { useTableData } from '../table/table-data.js';

import { useDock } from './dock-context.js';
import { usePanelList } from './use-panel-list.js';

/** A panel's scrolling body; dockview names its tab panel after the tab (ADR-059). */
function Body({
  scroll = true,
  children,
}: {
  scroll?: boolean;
  children: ReactNode;
}): ReactElement {
  return <div className={scroll ? 'h-full overflow-y-auto p-3' : 'h-full p-3'}>{children}</div>;
}

const param = (params: unknown, key: string): unknown =>
  typeof params === 'object' && params ? Reflect.get(params, key) : undefined;

const stringParam = (params: unknown, key: string): string => {
  const value = param(params, key);
  return typeof value === 'string' ? value : '';
};

/** A list's filters, kept in its panel's parameters and so saved with the layout. */
function usePanelFilters({ params, api: panel }: IDockviewPanelProps) {
  const { save } = useDock();
  const [filters, setFilters] = useState<EntityFilters>(() =>
    readFilters(param(params, 'filters')),
  );
  const onFilters = (next: EntityFilters) => {
    setFilters(next);
    panel.updateParameters({ filters: next });
    save();
  };
  return [filters, onFilters] as const;
}

const Loading = (): ReactElement => <p className="text-muted">{t('app.loading')}</p>;

export function ActorsPanel(props: IDockviewPanelProps): ReactElement {
  const data = useTableData();
  const [filters, onFilters] = usePanelFilters(props);
  const query = { ...toListQuery(filters), limit: LIST_PAGE };
  const list = usePanelList(
    () => api.actorsPage(data.table.id, query),
    JSON.stringify(query),
    data,
  );
  return (
    <Body>
      {list.loaded ? (
        <ActorList
          data={data}
          actors={list.rows}
          nextCursor={list.nextCursor}
          fetchPage={(cursor) => api.actorsPage(data.table.id, { ...query, cursor })}
          filters={filters}
          onFilters={onFilters}
          error={list.error}
        />
      ) : (
        <Loading />
      )}
    </Body>
  );
}

export function ItemsPanel(props: IDockviewPanelProps): ReactElement {
  const data = useTableData();
  const [filters, onFilters] = usePanelFilters(props);
  const query = { ...toListQuery(filters), limit: LIST_PAGE };
  const list = usePanelList(() => api.itemsPage(data.table.id, query), JSON.stringify(query), data);
  return (
    <Body>
      {list.loaded ? (
        <ItemList
          data={data}
          items={list.rows}
          nextCursor={list.nextCursor}
          fetchPage={(cursor) => api.itemsPage(data.table.id, { ...query, cursor })}
          filters={filters}
          onFilters={onFilters}
          error={list.error}
        />
      ) : (
        <Loading />
      )}
    </Body>
  );
}

export function JournalPanel(props: IDockviewPanelProps): ReactElement {
  const data = useTableData();
  const [filters, onFilters] = usePanelFilters(props);
  const query: JournalListQuery = {
    ...(filters.search.trim() && { search: filters.search.trim() }),
    trash: filters.trash ? 'restorable' : 'live',
    limit: LIST_PAGE,
  };
  const list = usePanelList(
    () => api.journalPage(data.table.id, query),
    JSON.stringify(query),
    data,
  );
  return (
    <Body>
      {list.loaded ? (
        <JournalList
          data={data}
          entries={list.rows}
          nextCursor={list.nextCursor}
          fetchPage={(cursor) => api.journalPage(data.table.id, { ...query, cursor })}
          filters={filters}
          onFilters={onFilters}
          error={list.error}
        />
      ) : (
        <Loading />
      )}
    </Body>
  );
}

export function SheetPanel({ params, api: panel }: IDockviewPanelProps): ReactElement {
  const { actors } = useTableData();
  const actorId = stringParam(params, 'actorId');
  const name = actors.find((actor) => actor.id === actorId)?.name ?? t('sheet.notFound');
  useEffect(() => {
    panel.setTitle(name);
  }, [panel, name]);
  return (
    <Body>
      <ActorSheetPanel actorId={actorId} />
    </Body>
  );
}

export function EntryPanel({ params, api: panel }: IDockviewPanelProps): ReactElement {
  return (
    <Body>
      <JournalEntryPanel
        entryId={stringParam(params, 'entryId')}
        onTitle={(next) => {
          panel.setTitle(next);
        }}
      />
    </Body>
  );
}

export function OverviewPanel(): ReactElement {
  const { table } = useTableData();
  return (
    <Body>
      <div className="mx-auto flex max-w-2xl flex-col gap-3 py-3">
        <h2 className="text-2xl font-bold">{t('workspace.about')}</h2>
        <p className="text-sm text-muted">
          {t(`tables.role.${table.role}`)} ·{' '}
          {t('tables.system', { name: table.systemName, version: table.systemVersion })}
        </p>
        {table.description && <p>{table.description}</p>}
        <p className="text-muted">{t('workspace.hint')}</p>
      </div>
    </Body>
  );
}

export function MembersDockPanel(): ReactElement {
  return (
    <Body>
      <MembersPanel />
    </Body>
  );
}

export function SettingsPanel(): ReactElement {
  return (
    <Body>
      <TableSettings />
    </Body>
  );
}

export function CombatPanel(): ReactElement {
  const { table, actors } = useTableData();
  return (
    <Body>
      <CombatTracker table={table} actors={actors} />
    </Body>
  );
}

export function ChatDockPanel(): ReactElement {
  const { table, members, actors, chat } = useTableData();
  const { userId } = useDock();
  return (
    <Body scroll={false}>
      <ChatPanel
        table={table}
        members={members}
        userId={userId}
        speakers={actors.filter((actor) => actor.access === 'owner')}
        initialPage={chat}
      />
    </Body>
  );
}

export function DicePanel(): ReactElement {
  const { table, actors } = useTableData();
  const { diceActorId } = useDock();
  return (
    <Body>
      <DicePane table={table} actor={actors.find((actor) => actor.id === diceActorId)} />
    </Body>
  );
}
