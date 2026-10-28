# ADR-059: The table is a dockview workspace with a single URL

- **Status:** Accepted
- **Date:** 2026-10-28
- **Tasks:** T-1201
- **Covers:** FR-TABLE-08, FR-SHEET-10, FR-ENT-04, NFR-10

## Context

The table page lived inside the app shell: the site header on top, lists, sheets and pages as child routes behind one outlet, chat and combat in a column beside it. Opening a sheet replaced the list, and only one sheet could be open. Maps (M14) need the room the shell took, and a place that other panels can share.

A first version with two fixed side panels (collapse and resize only) was built and reverted. A prototype on [dockview](https://dockview.dev) showed that tabs, splits and floating panels come almost for free, and the user chose it.

## Decision

1. **Outside the shell.** `routes/signed-in.tsx` holds the session check and the site name (`useSiteName`). Below it, `app-layout` (header, page frame) wraps the tables list, account and admin pages. `tables/:tableId` sits beside it and fills the viewport. It is the table's only route.
2. **Everything is a panel.** `dockview-react`, pinned to an exact version, renders these panels:
   - **Tools**, one of each: Actors, Items, Journal, Combat, Chat and Dice.
   - **Pages**, one of each: Table (the overview), Members and Settings.
   - **Documents**, many at once: sheets (`actor:<id>`) and journal entries (`entry:<id>`).

   Every panel can be closed, dragged into a tab strip, split to any side or floated. Pop-out browser windows are not offered. The **Panels** menu opens a closed panel, or brings an open one forward, near where the default layout keeps it. **Reset layout** restores the default.

3. **Default layout (desktop).** The lists sit on the left as tabs (320 px). The Table overview is in the centre, and documents open there as tabs. Combat sits on the right (384 px), above Chat and Dice as tabs.
4. **One URL per table.**
   - `/tables/:id` is the table's only URL. The old child routes are removed: `/actors/:actorId`, `/journal/:entryId`, `/items`, `/journal`, `/members` and `/settings`. Like any unknown path, they now lead to the tables list.
   - Opening, switching or closing panels never changes the URL. The saved layout, not the URL, brings the open documents back after a reload.
   - The lists' "Open" controls are buttons that open their document as a panel, and the upgrade notice's button opens Settings.
   - The back button leaves the table, rather than stepping through the panels.

   A first version gave each document a URL and pushed it on every switch. The user found that noisy and asked for a single route.

5. **Panels load their own data.** Lists load their first page (`usePanelList`, ADR-057). Journal entries and members' invites load in the panel. All of them load again whenever the table's data revalidates, so `entity.changed` events, resyncs and a GM hiding an entry reach open panels. Each open sheet keeps its own live connection.
6. **Filters belong to their list.** Search, type and trash are kept in the list panel's dockview parameters and saved with the layout. Until now they were kept in the URL. They no longer are, because two lists open side by side would otherwise share one search.
7. **Saved per browser.** `api.toJSON()` is stored in `localStorage` under `vtt:dock:<userId>:<tableId>:<desktop|phone>` after every layout change. A stored layout that fails to load is dropped for the default one. Blocked storage only means the layout is not kept.
8. **Phones (<768 px)** use dockview too, with a separate layout, so a document opened on a phone is not open on the desktop. Every panel is a tab of one group, so each fills the screen. Dragging and floating are off. This replaces T-0511's bottom bar. Crossing 768 px remounts the workspace with the other layout.
9. **Accessibility.**
   - dockview labels each group as a region and each panel as a `tabpanel` named after its tab.
   - Its tab strips take arrow keys, Home and End, Enter or Space (open) and Delete (close).
   - Its live regions announce panels opening and closing; the messages and close-button labels go through our i18n.
   - The Panels menu reaches every panel by keyboard.

## Consequences

- **Keyboard gaps.** Keyboard docking, keyboard resizing of the dividers and group-to-group shortcuts (F6) are in dockview's paid `dockview-enterprise` modules, so they are not available. Keyboard users get the default layout, its tabs and the Panels menu, but cannot rearrange it (§15).
- **Live regions.** dockview's two live regions (`role="status"` and `role="alert"`) are always on the page. Tests look for the app's messages inside their panel, or among non-empty alerts.
- **Saved layouts.** They stay in one browser. Their format belongs to dockview, so a major dockview upgrade may drop them back to the default; the fallback covers it.
- **Dependency.** dockview-react, dockview and dockview-core are MIT, have no further dependencies, and are pinned to an exact version. They release often, so upgrades are deliberate.
- **Maps (M14).** A map becomes another document panel.
