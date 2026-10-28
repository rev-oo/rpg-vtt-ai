import type { AddPanelPositionOptions, DockviewApi, SerializedDockview } from 'dockview-react';

import { t } from '../../i18n/index.js';

import {
  isDocument,
  LIST_PANELS,
  type PagePanel,
  type PanelTarget,
  type ToolPanel,
} from './panel-ids.js';

/** Panel widths of the default desktop layout, in pixels; the stage takes the rest. */
const LISTS_WIDTH = 320;
const CHAT_WIDTH = 384;

export const layoutKey = (userId: string, tableId: string, phone: boolean): string =>
  `vtt:dock:${userId}:${tableId}:${phone ? 'phone' : 'desktop'}`;

const TITLES = {
  actors: 'actors.title',
  items: 'items.title',
  journal: 'journal.title',
  combat: 'combat.title',
  chat: 'workspace.chat',
  dice: 'workspace.dice',
  overview: 'workspace.overview',
  members: 'members.title',
  settings: 'settings.title',
} as const satisfies Record<ToolPanel | PagePanel, string>;

export const titleOf = (id: ToolPanel | PagePanel): string => t(TITLES[id]);

const find = (api: DockviewApi, ids: readonly string[]) =>
  ids.map((id) => api.getPanel(id)).find((panel) => panel !== undefined);

/** Where a document opens: beside the open documents, else right of the lists. */
function documentPlace(api: DockviewApi): AddPanelPositionOptions | undefined {
  const active = api.activePanel;
  const document =
    active && isDocument(active.id) ? active : api.panels.find((panel) => isDocument(panel.id));
  if (document) return { referenceGroup: document.group };
  const lists = find(api, LIST_PANELS);
  if (lists) return { referencePanel: lists, direction: 'right' };
  const side = find(api, ['combat', 'chat', 'dice']);
  if (side) return { referencePanel: side, direction: 'left' };
  return undefined;
}

/** Where a panel opens, near where the default layout keeps it (ADR-059). */
export function placeOf(
  api: DockviewApi,
  id: string,
  phone: boolean,
): AddPanelPositionOptions | undefined {
  // On a phone every panel is a tab of one group.
  const [group] = api.groups;
  if (phone) return group ? { referenceGroup: group } : undefined;
  const document = api.panels.find((panel) => isDocument(panel.id));
  if (isDocument(id)) return documentPlace(api);
  if ((LIST_PANELS as readonly string[]).includes(id)) {
    const list = find(api, LIST_PANELS);
    if (list) return { referenceGroup: list.group };
    return document ? { referencePanel: document, direction: 'left' } : { direction: 'left' };
  }
  if (id === 'combat') {
    const below = find(api, ['chat', 'dice']);
    if (below) return { referencePanel: below, direction: 'above' };
  } else {
    const other = find(api, id === 'chat' ? ['dice'] : ['chat']);
    if (other) return { referenceGroup: other.group };
    const combat = api.getPanel('combat');
    if (combat) return { referencePanel: combat, direction: 'below' };
  }
  return document ? { referencePanel: document, direction: 'right' } : { direction: 'right' };
}

/** Opens a tool or page panel, or brings it to the front. */
export function showPanel(api: DockviewApi, id: ToolPanel | PagePanel, phone: boolean): void {
  const open = api.getPanel(id);
  if (open) {
    open.api.setActive();
    return;
  }
  const position = placeOf(api, id, phone);
  api.addPanel({ id, component: id, title: titleOf(id), ...(position && { position }) });
}

/** Opens a document or page, or brings it to the front. */
export function showTarget(
  api: DockviewApi,
  target: PanelTarget,
  phone: boolean,
  title: string,
): void {
  if (target.kind === 'page') {
    showPanel(api, target.id, phone);
    return;
  }
  const open = api.getPanel(target.id);
  if (open) {
    open.api.setActive();
    return;
  }
  const position = placeOf(api, target.id, phone);
  api.addPanel({
    id: target.id,
    ...(target.kind === 'sheet'
      ? { component: 'sheet', params: { actorId: target.actorId } }
      : { component: 'entry', params: { entryId: target.entryId } }),
    title,
    ...(position && { position }),
  });
}

/** Lists on the left, the overview in the middle, combat over chat and dice on the right. */
export function defaultLayout(api: DockviewApi, phone: boolean): void {
  const add = (id: ToolPanel | PagePanel, position?: AddPanelPositionOptions) =>
    api.addPanel({ id, component: id, title: titleOf(id), ...(position && { position }) });
  if (phone) {
    add('overview');
    for (const id of ['actors', 'items', 'journal', 'chat', 'combat', 'dice'] as const) {
      add(id, { referencePanel: 'overview', direction: 'within' });
    }
    api.getPanel('overview')?.api.setActive();
    return;
  }
  add('actors');
  add('items', { referencePanel: 'actors', direction: 'within' });
  add('journal', { referencePanel: 'actors', direction: 'within' });
  add('overview', { referencePanel: 'actors', direction: 'right' });
  add('combat', { referencePanel: 'overview', direction: 'right' });
  add('chat', { referencePanel: 'combat', direction: 'below' });
  add('dice', { referencePanel: 'chat', direction: 'within' });
  // `initialWidth` loses to the even split of a new grid, so size the side groups after.
  api.getPanel('actors')?.group.api.setSize({ width: LISTS_WIDTH });
  api.getPanel('combat')?.group.api.setSize({ width: CHAT_WIDTH });
  api.getPanel('actors')?.api.setActive();
  api.getPanel('chat')?.api.setActive();
  api.getPanel('overview')?.api.setActive();
}

/** The stored layout, else the default one: a layout that fails to load is dropped. */
export function restoreLayout(api: DockviewApi, key: string, phone: boolean): void {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed === 'object' && parsed !== null && 'grid' in parsed) {
        api.fromJSON(parsed as SerializedDockview);
        return;
      }
    }
  } catch {
    api.clear();
  }
  defaultLayout(api, phone);
}

export function saveLayout(api: DockviewApi, key: string): void {
  try {
    localStorage.setItem(key, JSON.stringify(api.toJSON()));
  } catch {
    // A private window or blocked storage: the layout lasts until the page closes.
  }
}
