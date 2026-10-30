import 'dockview-react/dist/styles/dockview.css';

import { DockviewReact, themeLight, type DockviewApi, type DockviewMessages } from 'dockview-react';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';

import { canManageScenes, canManageTable } from '@vtt/shared';
import { Button, cn } from '@vtt/ui';

import { t } from '../../i18n/index.js';
import type { TableData } from '../table/table-data.js';

import { DockContext } from './dock-context.js';
import {
  defaultLayout,
  layoutKey,
  restoreLayout,
  saveLayout,
  showPanel,
  showTarget,
  titleOf,
} from './layout.js';
import { PANEL_COMPONENTS } from './panel-components.js';
import type { PagePanel, PanelTarget, ToolPanel } from './panel-ids.js';
import { useDesktop } from './use-desktop.js';

export interface WorkspaceProps {
  data: TableData;
  userId: string;
  /** Notices about the whole table, shown under the top bar. */
  notices: ReactNode;
}

/**
 * The full-page table (FR-TABLE-08, ADR-059): dockview panels for the lists, the open sheets,
 * journal entries and pages, combat, chat and dice. Phones get the same panels as tabs of one
 * group, laid out and saved apart from the desktop.
 */
export function Workspace(props: WorkspaceProps): ReactElement {
  const desktop = useDesktop();
  return <Dock key={desktop ? 'desktop' : 'phone'} {...props} phone={!desktop} />;
}

const MENU: readonly (ToolPanel | PagePanel)[] = [
  'map',
  'scenes',
  'overview',
  'actors',
  'items',
  'journal',
  'compendium',
  'assets',
  'combat',
  'chat',
  'dice',
  'members',
  'settings',
];

const ACTOR_PREFIX = 'actor:';

/** dockview's announcements and labels, in the app's language. */
const DOCK_MESSAGES: Partial<DockviewMessages> = {
  panelOpened: (title) => t('workspace.announce.opened', { title }),
  panelClosed: (title) => t('workspace.announce.closed', { title }),
  groupMaximized: (title) => t('workspace.announce.maximized', { title }),
  groupRestored: (title) => t('workspace.announce.restored', { title }),
  groupFloated: (title) => t('workspace.announce.floated', { title }),
  groupDocked: (title) => t('workspace.announce.docked', { title }),
  closeTab: (title) => t('workspace.closeTab', { title }),
  closeTabPlain: () => t('workspace.closeTabPlain'),
};

function Dock({ data, userId, notices, phone }: WorkspaceProps & { phone: boolean }): ReactElement {
  const { table } = data;
  const key = layoutKey(userId, table.id, phone);
  const scenes = canManageScenes(table.role);
  const [dock, setDock] = useState<DockviewApi | null>(null);
  const [openIds, setOpenIds] = useState<readonly string[]>([]);
  const [diceActorId, setDiceActorId] = useState<string | null>(null);

  const onActive = useEffectEvent((panelId: string | undefined) => {
    if (panelId?.startsWith(ACTOR_PREFIX)) setDiceActorId(panelId.slice(ACTOR_PREFIX.length));
  });
  useEffect(() => {
    if (!dock) return;
    const listOpen = () => {
      setOpenIds(dock.panels.map((panel) => panel.id));
    };
    const subscriptions = [
      dock.onDidLayoutChange(() => {
        saveLayout(dock, key);
      }),
      dock.onDidActivePanelChange((event) => {
        onActive(event.panel?.id);
      }),
      dock.onDidAddPanel(listOpen),
      dock.onDidRemovePanel(listOpen),
      dock.onDidLayoutFromJSON(listOpen),
    ];
    listOpen();
    return () => {
      for (const subscription of subscriptions) subscription.dispose();
    };
  }, [dock, key]);

  const open = (api: DockviewApi, target: PanelTarget) => {
    const title =
      target.kind === 'sheet'
        ? (data.actors.find((actor) => actor.id === target.actorId)?.name ?? t('workspace.sheet'))
        : target.kind === 'item'
          ? target.name
          : t('journal.title');
    showTarget(api, target, phone, title);
  };
  return (
    <DockContext
      value={{
        userId,
        diceActorId,
        save: () => {
          if (dock) saveLayout(dock, key);
        },
        open: (target) => {
          if (dock) open(dock, target);
        },
      }}
    >
      <div className="flex h-dvh flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-3 py-2">
          <Link to="/" className="text-sm">
            {t('workspace.tables')}
          </Link>
          <h1 className="min-w-0 truncate text-lg font-bold">{table.name}</h1>
          <span className="hidden text-sm text-muted sm:inline">
            {t(`tables.role.${table.role}`)} ·{' '}
            {t('tables.system', { name: table.systemName, version: table.systemVersion })}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <PanelsMenu
              items={MENU.filter(
                (id) =>
                  (id !== 'settings' || canManageTable(table.role)) && (id !== 'scenes' || scenes),
              )}
              openIds={openIds}
              disabled={!dock}
              onPick={(id) => {
                if (dock) showPanel(dock, id, phone);
              }}
            />
            <Button
              variant="ghost"
              disabled={!dock}
              onClick={() => {
                if (!dock) return;
                dock.clear();
                defaultLayout(dock, phone, scenes);
              }}
            >
              {t('workspace.resetLayout')}
            </Button>
          </div>
        </header>
        {notices}
        {/* Its own stacking context: dockview's sashes and groups carry z-indexes of 99 and up,
            which would otherwise cover the header's Panels menu. */}
        <div className="vtt-dock isolate min-h-0 flex-1">
          <DockviewReact
            theme={themeLight}
            components={PANEL_COMPONENTS}
            watermarkComponent={Empty}
            messages={DOCK_MESSAGES}
            disableDnd={phone}
            disableFloatingGroups={phone}
            getTabContextMenuItems={() =>
              phone ? ['close'] : ['close', 'closeOthers', 'separator', 'maximize', 'float']
            }
            onReady={(event) => {
              restoreLayout(event.api, key, phone, scenes);
              const active = event.api.activePanel?.id;
              if (active?.startsWith(ACTOR_PREFIX)) {
                setDiceActorId(active.slice(ACTOR_PREFIX.length));
              }
              setDock(event.api);
            }}
          />
        </div>
      </div>
    </DockContext>
  );
}

function Empty(): ReactElement {
  return (
    <p className="flex h-full items-center justify-center p-6 text-center text-muted">
      {t('workspace.empty')}
    </p>
  );
}

/** Lists every panel; picking one opens it, or brings it to the front. */
function PanelsMenu({
  items,
  openIds,
  disabled,
  onPick,
}: {
  items: readonly (ToolPanel | PagePanel)[];
  openIds: readonly string[];
  disabled: boolean;
  onPick: (id: ToolPanel | PagePanel) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <Button
        variant="ghost"
        disabled={disabled}
        aria-expanded={open}
        aria-controls="workspace-panels"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {t('workspace.panels')}
      </Button>
      {open && (
        <ul
          id="workspace-panels"
          aria-label={t('workspace.panels')}
          className="absolute right-0 z-20 mt-1 flex min-w-48 flex-col rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {items.map((id) => {
            const shown = openIds.includes(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-info-soft',
                  )}
                  onClick={() => {
                    setOpen(false);
                    onPick(id);
                  }}
                >
                  {titleOf(id)}
                  {shown && <span className="text-sm text-muted">{t('workspace.isOpen')}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
