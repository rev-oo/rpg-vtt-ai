# ADR-025: Plugin host in the web app

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0409
- **Amends:** §8.10, §10.1, FR-CHAT-06 and ADR-024 (details below)

## Context

T-0409 runs a table's system plugin in the browser: its sheets, its texts, its scoped CSS and its `code/client.js`. The spec says plugin code shares the app's React through an import map and uses `@vtt/sdk/client` hooks, but not how the web gets a validated definition, how sheet rolls reach the server, or what a card message stores. Live sheets (M5) are not here yet, so actor data has no write path from the web.

## Decision

1. **System definitions.**
   - `GET /api/v1/systems/:id` sends an available system's definition, as the validator built it on the last scan, with its stylesheet URLs (`/plugins/<id>/styles/*.css`, ADR-022) and `client` (`/plugins/<id>/code/client.js`, or `null`). It needs a session. A disabled, broken or unknown system is a 404.
   - The response schema lives in `@vtt/shared/api` with the definition as `record(unknown)`, because `shared` cannot import `plugin-schema` (§4.4). The web parses the definition with `pluginDefinitionSchema` from `@vtt/plugin-schema`, which checks the shape only; the cross-file rules ran on the server (§14, Q10).
   - Table views carry `systemAvailable`. While it is false the web loads nothing from the plugin and shows the table as read-only (FR-PLUGIN-03).
2. **Rolls through the plugin engine.**
   - Typed formulas use the table's system: an actor's data with schema defaults and derived values, `@settings`, and the plugin's custom dice. An actor whose type the plugin no longer declares rolls against its raw data, as before.
   - `POST /tables/:id/rolls` (and `roll.request`) takes either `formula` or `recipe: { name, args }`. Arguments are numbers, strings up to 200 characters, or booleans. A recipe needs an actor (`actor_required`) and an available system (`system_unavailable`); engine errors keep their codes (`unknown_recipe`, `handler_recipe`).
   - A recipe posts a `card` message. Its `card` field stores what the server resolved: system, recipe, label, outcome and the resolved card rows. Its `text` is the plain-text fallback from `chatCardView` in the plugin's default language, e.g. `Roll: 1d20 + 2 + 3 = 15 (Success)`. Labels stay lang keys, so each viewer translates them.
3. **Cards in the chat (FR-CHAT-06).** A card message shows the plugin's custom card component when its client code has one for the card, else the core card rendering, inside `data-plugin="<id>"` so the plugin's CSS applies. It falls back to `text` while the system is unavailable, when the message came from another system, or when the plugin no longer has the card.
4. **Shared modules.**
   - Plugin code imports `react`, `react/jsx-runtime` and `@vtt/sdk/client` by name. The root layout declares an import map before any module script that points each name at a shim under `/plugin-runtime/`.
   - A shim re-exports the app's own module from `globalThis.__VTT_PLUGIN_RUNTIME__`, which the app fills on start. A Vite plugin in `apps/web/vite.config.ts` builds the shims from the list in `src/plugin-host/shared-modules.ts`: served in dev, emitted into the client build.
   - `code/client.js` is loaded with a dynamic `import()` carrying the plugin version in the query, so a new install is not served from the module cache. Its default export is checked with Zod. If it fails to load, the sheet says so and custom nodes show the renderer's missing-node notice.
   - Each plugin component renders inside an error boundary, so a failing node or card shows a notice instead of breaking the page.
5. **`@vtt/sdk/client`.**
   - It exports `defineClient({ nodes, cards })` and the hooks `useField(path)` (value and setter), `useDerived(key)`, `useActor()` and `useTranslate()`, read from `ClientSheetContext`. A hook outside a sheet throws.
   - The web host bridges each custom node to the sheet it renders in: paths are dot paths, relative to the row inside a `list`. The setter does nothing while the sheet is read-only.
   - Card components receive the stored `card`, the message's `rolls`, its `speaker` and a `translate` function.
   - The client entry is its own TypeScript project (`tsconfig.client.json`) with React types, so the rest of `@vtt/sdk` stays pure. `sdk-client` may import itself.
6. **Read-only sheets until M5.**
   - The table page lists an **Open sheet** link per actor, at `/tables/:tableId/actors/:actorId`. The sheet shows the stored `system` data in a memory store, read-only. GMs and assistants see the secret layer.
   - **Amends ADR-024 §6:** roll buttons change no data, so they follow `onRoll` alone instead of being disabled by `readOnly`. The host passes `onRoll` to the actor's owners who may post in the chat. It sends a recipe roll, and the result arrives in the chat.
   - Item sheets are not mounted yet; they follow the same path when items get a sheet view.
7. **Plugin texts.** A plugin text is looked up in the UI language, then the plugin's default language, and is shown as written otherwise (a literal label).
8. **Lint.** `e2e/fixtures/plugins/*/code/` and the e2e data directory are ignored by ESLint: plugin client code is not a workspace module, and its imports resolve through the import map.

## Consequences

- Plugins share one React instance with the app, so hooks and context work across the boundary, and the SDK API is the stable surface. Adding a shared module means adding it to `SHARED_MODULES`.
- Chat history keeps working without the plugin: every card message has its text.
- Recipe arguments are scalars. A roll button whose arguments evaluate to a list reports that instead of rolling.
- Editing sheets, and syncing them, arrive with M5 behind the same `SheetStore` interface.
