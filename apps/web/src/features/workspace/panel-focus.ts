import type { DockviewApi, DockviewGroupPanel } from 'dockview-react';

/**
 * Moving between panels by keyboard (T-1620): F6 and Shift+F6 go to the next or previous panel
 * group, and the "Skip to panel" list goes straight to one panel.
 */

/** Marks the control a panel's keyboard user starts from, such as the chat's message box. */
export const FOCUS_FIRST = 'data-vtt-focus-first';

/** Groups in reading order: top to bottom, then left to right; floating ones last. */
export function groupsInOrder(dock: DockviewApi): DockviewGroupPanel[] {
  const place = (group: DockviewGroupPanel) => group.element.getBoundingClientRect();
  return [...dock.groups].sort((a, b) => {
    const floatA = a.api.location.type === 'floating' ? 1 : 0;
    const floatB = b.api.location.type === 'floating' ? 1 : 0;
    if (floatA !== floatB) return floatA - floatB;
    const [ra, rb] = [place(a), place(b)];
    return ra.top - rb.top || ra.left - rb.left;
  });
}

/**
 * Focuses where a keyboard user starts in a group's shown panel: the control it marks with
 * `FOCUS_FIRST`, else the panel's content itself, so the next Tab enters it.
 */
export function focusGroup(group: DockviewGroupPanel): void {
  const content = group.element.querySelector<HTMLElement>('.dv-content-container');
  if (!content) return;
  const marked = content.querySelector<HTMLElement>(`[${FOCUS_FIRST}]`);
  if (marked) {
    marked.focus();
    return;
  }
  // The content is a stop of its own only while focused this way.
  content.tabIndex = -1;
  content.focus();
}

/** Shows one panel and focuses it. */
export function focusPanel(dock: DockviewApi, panelId: string): void {
  const panel = dock.getPanel(panelId);
  if (!panel) return;
  panel.api.setActive();
  // The panel's content renders once it is shown.
  requestAnimationFrame(() => {
    focusGroup(panel.group);
  });
}

/**
 * Handles F6 and Shift+F6 on the table page: the next or previous group from the one holding
 * focus; from outside the dock, the first or last. Returns whether it moved focus.
 */
export function cycleGroups(dock: DockviewApi, event: KeyboardEvent): boolean {
  if (event.key !== 'F6' || event.altKey || event.ctrlKey || event.metaKey) return false;
  const groups = groupsInOrder(dock);
  if (groups.length === 0) return false;
  const active = document.activeElement;
  const at = groups.findIndex((group) => active !== null && group.element.contains(active));
  const step = event.shiftKey ? -1 : 1;
  const next =
    at === -1
      ? event.shiftKey
        ? groups.length - 1
        : 0
      : (at + step + groups.length) % groups.length;
  const group = groups[next];
  if (!group) return false;
  group.activePanel?.api.setActive();
  focusGroup(group);
  return true;
}
