# ADR-077: Module overlays and panels

- **Status:** Accepted
- **Date:** 2026-11-07
- **Tasks:** T-1603
- **Covers:** FR-PLUGIN-16
- **Builds on:** ADR-059 (workspace), ADR-074 (client code in sandboxed frames), ADR-075 (module plugins and setting scopes)

## Context

Modules (ADR-075) need to draw on the table page and react to play: 3D dice over the page when someone rolls, a tracker panel, a soundboard. Their code must not see more than the viewer sees, must not decide results, and must not be able to do anything the viewer could not do. ADR-074 already runs plugin client code in sandboxed frames for sheet nodes and chat cards.

## Decision

1. **Two places, one frame each.** A module's `code/client.js` exports `overlays` (`{ component, interactive? }` by name) and `panels` (`{ component, title }` by name) through `defineClient`. Each overlay and each open panel runs in its own frame of `/plugin-frame.html`, sandboxed as in ADR-074 (`allow-scripts` only, an opaque origin, a policy that allows no network). The app loads and probes a module's code once per version when the table page loads its modules, and the probe lists the overlays and panels.
2. **Overlays** sit in one fixed layer over the whole table page, transparent. The layer and the frames take no pointer events, so clicks reach the page, unless an overlay is declared `interactive`. Each member can turn a table's overlays off from a button in the table header. The choice is kept in the browser per user and table, since it is about one screen.
3. **Panels** are dockview panels of the component `module`, with the id `module:<module>:<name>`, listed in the Panels menu after the app's own panels and saved in the layout like them. They use dockview's `always` renderer, so a panel stays loaded and keeps hearing the table while another tab is in front of it. Without it, hiding the tab would reload the frame, which the app then starts again (ADR-074) but with the panel's state lost.
4. **Events are the page's own.** A frame gets the table events the page receives, which the server has already filtered for the viewer: `chat.message` and `chat.updated` with the message and its rolls (dice and totals as the server decided them), `chat.deleted`, and `combat.updated`, `scene.updated` and `token.updated` as notices. Entity documents and `table.updated` are not passed on. A frame gets nothing before it has started, and nothing waits on it: the host only posts.
5. **Settings.** A frame starts with the module's settings for the viewer (instance, table and user values, merged by scope as in ADR-075) and gets a `settings` message when they change. A change of the viewer's own settings, or a change to the table's settings, reloads the table's modules. A frame may set a setting through the host, which calls `PATCH /me/plugins/:id/settings`; the server accepts only `user` settings there.
6. **Actions run as the viewer.** A frame posts `action` messages: chat, roll, open a sheet or journal entry, a combat action (start, end, next, previous, initiative) and read the encounter. The host checks each against a Zod schema built from the API's own request bodies, then makes the request with the viewer's session, so the server checks it exactly as the viewer's own. Opening a sheet requires an actor the viewer sees, and opening a journal entry requires the server to return it for the viewer. The host answers with a `result` that carries a value or the reason for a refusal. Each frame may take 10 actions in any 10 seconds, and the host refuses the rest without a request.
7. **SDK.** `@vtt/sdk/client` gains `useTableEvents`, `useModuleSettings`, `useViewer` and `useActions` for overlays and panels, through a `ModuleFrameContext` that the frame page provides. `useTranslate` works there too.

## Consequences

- A module sees and does no more than its viewer. A frame learns the viewer's id and role, and what the viewer's page already shows.
- An instance setting changed by an admin reaches open frames only when the table page next loads its modules, since no table event announces it.
- Frames hear scene, token and combat changes only as notices; they cannot read scenes or tokens yet. A later task can add read actions if a module needs them.
- An interactive overlay covers the page's controls. Authors should keep interactive overlays rare, and members can turn overlays off.
