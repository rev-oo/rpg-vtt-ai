# ADR-059: The table is a full-page workspace: a routed stage between two panels

- **Status:** Accepted
- **Date:** 2026-10-28
- **Tasks:** T-1201
- **Covers:** FR-TABLE-08, FR-SHEET-10, NFR-10

## Context

The table page lived inside the app shell: the site header on top and the lists, sheets and pages as routes behind one outlet, with chat and combat in a column beside it. Opening a sheet replaced the list, so going from one actor to the next meant going back first. Maps (M14) need the space the shell and the page width took, and a stage that other content can share.

## Decision

1. **Outside the shell.** A `routes/signed-in.tsx` layout owns the session check (once `app-layout`'s loader) and the site name (`useSiteName`). Below it, `app-layout` (header, page frame) wraps the tables list, account and admin pages; `tables/:tableId` sits beside it and fills the viewport (`h-dvh`).
2. **The stage is the route.** The table's child routes render in the centre: an overview (index), a sheet, a journal entry, members and settings. A map becomes another stage route in M14.
3. **Two panels.** "Lists" holds actors, items and journal as tabs, with their filters; "Chat" holds combat and the chat, as the old right column did. Grouping them keeps the stage wide enough for a sheet at 1280 px; more panels (the compendium in T-1202) become tabs or panels as they come.
4. **The list is state, not a route.** The tab is `?panel=actors|items|journal` beside the filters (`q`, `type`, `trash`). Links into the stage keep the query (`useStageLink`), so the list stays as it was when a sheet opens. Each tab loads its first page itself (`usePanelList`, ADR-057's paging) and reloads with the table's data, so `entity.changed` and resyncs refresh it as before. The old `/items` and `/journal` URLs redirect to `?panel=`.
5. **The layout is per user and table, in the browser.** `{ browseOpen, chatOpen, browseWidth, chatWidth, panel }` is stored in `localStorage` under `vtt:workspace:<userId>:<tableId>`, parsed with Zod (anything invalid falls back to the defaults) and wrapped in try/catch, so blocked storage only means the layout is not kept. A tab in the URL wins over the stored one.
6. **Collapse and resize.** Toggles in the top bar ("Panels" group, `aria-pressed`) hide a panel. A handle (`role="separator"`, `aria-valuenow`/`min`/`max`, `aria-controls`) resizes it from 240 to 640 px by pointer, or by arrow keys (16 px, 64 with Shift), Home and End.
7. **Phones.** Below 768 px a bottom bar ("Table views") shows one pane at a time, full screen: Lists, the stage (named for what it shows), Chat, and Dice on a sheet (T-0511). The desktop toggles do not apply. Hidden panes stay mounted, so a sheet keeps its live connection. Opening something shows the stage; the table's index shows the lists.

## Consequences

- The list and the open sheet or entry show at once on a desktop; their actions appear in both, so tests scope them to the stage (`main` "Open page").
- The layout does not follow a user to another browser. Storing it on the server can come later without changing the shape.
- Panel widths are pixels: on a narrow desktop window both panels open leave a narrow stage; collapsing one is the user's remedy.
