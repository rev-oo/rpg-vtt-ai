# ADR-071: Icons are Lucide SVGs, beside text on actions, alone only with a label

- **Status:** Accepted
- **Date:** 2026-11-02
- **Tasks:** none (added at the user's request, outside the milestones)
- **Covers:** NFR-10 (accessibility of icon-only controls)

## Context

The app had no icons: every control was text. The map toolbar had grown to six text buttons and no longer fit a phone, list rows wrapped their actions onto several lines, and the dock tabs were hard to tell apart at a glance. Icons have to work under the page's CSP (no inline scripts or eval, images only from the app or https), stay accessible (NFR-10), and keep the bundle small.

## Decision

1. **Library.** Icons come from `lucide-react` (ISC licence), pinned to an exact version. Each icon is a small React component that renders inline SVG, so they need no font, sprite or extra request, and the bundle keeps only the icons the app imports.
2. **One map.** `apps/web/src/icons.ts` re-exports the icons under the app's own names (`ICON.delete`, `ICON.ruler`…) and gives each dock panel its icon (`panelIcon`, `PanelIcon`): tools and pages by id, sheets, items and journal entries by their id's prefix. Other files import icons only from there, so changing an icon or the library touches one file.
3. **UI kit.** `@vtt/ui` takes icons as React nodes and does not depend on Lucide. `Button` gains an `icon` drawn before its text. The new `IconButton` shows only an icon and requires a `label`, which becomes both its `aria-label` and its `title` tooltip. Icons are always hidden from screen readers; the text or the label names the control.
4. **Where.** Icon-only buttons sit in dense places: the map's tools and zoom buttons, and the row actions of lists (duplicate, ownership, delete, restore, and in the Scenes list edit and move). They keep the names they had as text, so screen readers and tests find them as before. The main action of a row or panel keeps its text and gains an icon: New…, Add token, Show to players, Send, Roll, Upload, Panels, Reset layout, Sign out, and the token actions under the map. Dialog buttons stay text only.
5. **Dock tabs.** The dock keeps dockview's own tabs, which drag between groups, name their close buttons after the panel and close on a middle click. The icons are portalled into each tab and follow every layout change. A React tab component (`defaultTabComponent`) was tried and dropped: tabs could no longer be dragged to another group, and dockview's React tab names every close button "Close tab".

## Consequences

- A control shown only as an icon always has a tooltip and an accessible name; the `IconButton` type makes the label required.
- The Fit button on the map is now an icon, named "Fit the scene".
- The Panels menu and the dock tabs show the same icon for each panel.
