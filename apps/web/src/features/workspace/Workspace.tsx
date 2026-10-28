import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useSearchParams } from 'react-router';

import { canManageTable } from '@vtt/shared';
import { cn } from '@vtt/ui';

import { t } from '../../i18n/index.js';
import { ChatPanel } from '../chat/ChatPanel.js';
import { CombatTracker } from '../combat/CombatTracker.js';
import { DicePane } from '../table/DicePane.js';
import type { TableData } from '../table/table-data.js';

import { BrowsePanel } from './BrowsePanel.js';
import { PANEL_TABS, useWorkspaceLayout, type PanelTab } from './layout-store.js';
import { Resizer } from './Resizer.js';
import { useStageLink } from './stage-link.js';

/** The phone layout's panes; on a sheet, the dice too (T-0511). */
type Pane = 'browse' | 'stage' | 'chat' | 'dice';

const isPanelTab = (value: string | null): value is PanelTab =>
  PANEL_TABS.some((tab) => tab === value);

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  isActive
    ? 'rounded-lg bg-info-soft px-3 py-1 text-fg no-underline'
    : 'rounded-lg px-3 py-1 text-muted no-underline hover:text-fg';

const toggleClass = (on: boolean): string =>
  cn('rounded-lg px-3 py-1 text-sm', on ? 'bg-info-soft text-fg' : 'text-muted hover:text-fg');

export interface WorkspaceProps {
  data: TableData;
  userId: string;
  /** Notices about the whole table, shown under the top bar. */
  notices: ReactNode;
}

/**
 * The full-page table (FR-TABLE-08, ADR-059): a stage for the open sheet, journal entry or
 * page, between the browse panel and the chat. Each panel collapses and resizes, and the
 * layout is kept per user and table. Below 768 px a bottom bar switches between them, each
 * full screen; hidden panes stay mounted, so an open sheet keeps its live connection.
 */
export function Workspace({ data, userId, notices }: WorkspaceProps): ReactElement {
  const { table, members, actors, chat } = data;
  const [layout, updateLayout] = useWorkspaceLayout(userId, table.id);
  const [params, setParams] = useSearchParams();
  const stageLink = useStageLink();
  const requested = params.get('panel');
  const tab = isPanelTab(requested) ? requested : layout.panel;

  const sheetMatch = useMatch('/tables/:tableId/actors/:actorId');
  const entryMatch = useMatch('/tables/:tableId/journal/:entryId');
  const home = useMatch('/tables/:tableId') !== null;
  const { pathname } = useLocation();
  // Opening something shows it; going back to the table shows the lists.
  const [pane, setPane] = useState<{ path: string; pane: Pane }>({
    path: pathname,
    pane: home ? 'browse' : 'stage',
  });
  if (pane.path !== pathname) setPane({ path: pathname, pane: home ? 'browse' : 'stage' });
  const shown = pane.path === pathname ? pane.pane : home ? 'browse' : 'stage';
  const panes: Pane[] = sheetMatch
    ? ['browse', 'stage', 'chat', 'dice']
    : ['browse', 'stage', 'chat'];
  const stageName = sheetMatch
    ? 'sheet.pane.sheet'
    : entryMatch
      ? 'workspace.pane.entry'
      : 'workspace.pane.table';

  const chooseTab = (next: PanelTab) => {
    updateLayout({ panel: next });
    // Filters belong to the list they were set on.
    setParams({ panel: next }, { replace: true });
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-3 py-2">
        <Link to="/" className="text-sm">
          {t('workspace.tables')}
        </Link>
        <h1 className="min-w-0 truncate text-lg font-bold">
          <Link to={stageLink(`/tables/${table.id}`)} className="text-fg no-underline">
            {table.name}
          </Link>
        </h1>
        <span className="hidden text-sm text-muted sm:inline">
          {t(`tables.role.${table.role}`)} ·{' '}
          {t('tables.system', { name: table.systemName, version: table.systemVersion })}
        </span>
        <nav className="flex gap-1" aria-label={t('table.sections')}>
          <NavLink to={stageLink(`/tables/${table.id}/members`)} className={linkClass}>
            {t('members.title')}
          </NavLink>
          {canManageTable(table.role) && (
            <NavLink to={stageLink(`/tables/${table.id}/settings`)} className={linkClass}>
              {t('settings.title')}
            </NavLink>
          )}
        </nav>
        <div
          role="group"
          aria-label={t('workspace.panels')}
          className="ml-auto hidden gap-1 md:flex"
        >
          <button
            type="button"
            aria-pressed={layout.browseOpen}
            aria-controls="workspace-browse"
            className={toggleClass(layout.browseOpen)}
            onClick={() => {
              updateLayout({ browseOpen: !layout.browseOpen });
            }}
          >
            {t('workspace.browse')}
          </button>
          <button
            type="button"
            aria-pressed={layout.chatOpen}
            aria-controls="workspace-chat"
            className={toggleClass(layout.chatOpen)}
            onClick={() => {
              updateLayout({ chatOpen: !layout.chatOpen });
            }}
          >
            {t('workspace.chat')}
          </button>
        </div>
      </header>
      {notices}
      <div className="flex min-h-0 flex-1 max-md:pb-14">
        <aside
          id="workspace-browse"
          aria-label={t('workspace.browse')}
          style={{ '--browse-w': `${String(layout.browseWidth)}px` } as CSSProperties}
          className={cn(
            'min-h-0 overflow-y-auto p-3 max-md:flex-1 md:w-(--browse-w) md:shrink-0',
            !layout.browseOpen && 'md:hidden',
            shown !== 'browse' && 'max-md:hidden',
          )}
        >
          <BrowsePanel data={data} tab={tab} onTab={chooseTab} />
        </aside>
        {layout.browseOpen && (
          <Resizer
            side="left"
            width={layout.browseWidth}
            onResize={(browseWidth) => {
              updateLayout({ browseWidth });
            }}
            label={t('workspace.resizeBrowse')}
            controls="workspace-browse"
          />
        )}
        <main
          id="workspace-stage"
          aria-label={t('workspace.stage')}
          className={cn('min-w-0 flex-1 overflow-y-auto p-3', shown !== 'stage' && 'max-md:hidden')}
        >
          <Outlet />
        </main>
        {sheetMatch && shown === 'dice' && (
          <div className="flex-1 overflow-y-auto p-3 md:hidden">
            <DicePane
              table={table}
              actor={actors.find((a) => a.id === sheetMatch.params.actorId)}
            />
          </div>
        )}
        {layout.chatOpen && (
          <Resizer
            side="right"
            width={layout.chatWidth}
            onResize={(chatWidth) => {
              updateLayout({ chatWidth });
            }}
            label={t('workspace.resizeChat')}
            controls="workspace-chat"
          />
        )}
        <aside
          id="workspace-chat"
          aria-label={t('workspace.chat')}
          style={{ '--chat-w': `${String(layout.chatWidth)}px` } as CSSProperties}
          className={cn(
            'flex min-h-0 flex-col gap-3 p-3 max-md:flex-1 md:w-(--chat-w) md:shrink-0',
            !layout.chatOpen && 'md:hidden',
            shown !== 'chat' && 'max-md:hidden',
          )}
        >
          <CombatTracker table={table} actors={actors} />
          <div className="min-h-0 flex-1">
            <ChatPanel
              table={table}
              members={members}
              userId={userId}
              speakers={actors.filter((actor) => actor.access === 'owner')}
              initialPage={chat}
            />
          </div>
        </aside>
      </div>
      <nav
        className={cn(
          'fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-surface md:hidden',
          panes.length === 4 ? 'grid-cols-4' : 'grid-cols-3',
        )}
        aria-label={t('workspace.panes')}
      >
        {panes.map((which) => (
          <button
            key={which}
            type="button"
            aria-pressed={shown === which}
            className={cn(
              'min-h-14 text-sm font-semibold',
              shown === which ? 'bg-info-soft text-fg' : 'text-muted',
            )}
            onClick={() => {
              setPane({ path: pathname, pane: which });
            }}
          >
            {t(
              which === 'stage'
                ? stageName
                : which === 'browse'
                  ? 'workspace.pane.browse'
                  : `sheet.pane.${which}`,
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
