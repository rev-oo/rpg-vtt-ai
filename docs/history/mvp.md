# MVP history (M0–M7, release 0.1.0)

The task lists and change log of the MVP, moved out of `specs.md` after 0.1.0 was released on 2026-10-27. Task IDs, requirement IDs and ADR numbers are unchanged; section references (§x.y) point to `specs.md`.

Release notes: [`CHANGELOG.md`](../../CHANGELOG.md). Decisions: [`docs/adr/`](../adr/).

## Milestones and tasks

### M0 — Foundation

- [x] **T-0001 · Initialise pnpm monorepo**
  - **Deps:** none
  - **Do:** Create the directory layout in §5. Add `pnpm-workspace.yaml`, root `package.json` with `packageManager` and `engines`, `.nvmrc`, `.editorconfig`, `.gitignore` (including `data/`, `dist/`, `node_modules/`, `*.sqlite*`).
  - **Done when:** `pnpm install` succeeds on an empty workspace and `git status` shows only the expected files.

- [x] **T-0002 · Shared TypeScript configuration**
  - **Deps:** T-0001
  - **Do:** Create `tsconfig.base.json` with the flags in §6.1. Create `packages/config` exporting the base configs. Add a `tsconfig.json` to every package and app with project references.
  - **Done when:** `pnpm typecheck` runs `tsc -b` over all packages and apps with zero errors on empty sources.

- [x] **T-0003 · Prettier configuration**
  - **Deps:** T-0001
  - **Do:** Add `.prettierrc.json`, `.prettierignore` (exclude `data/`, `dist/`, lockfile, generated schemas), and scripts `format` and `format:check`.
  - **Done when:** `pnpm format:check` passes; a deliberately mis-formatted file fails the check.

- [x] **T-0004 · ESLint flat config with typescript-eslint**
  - **Deps:** T-0002, T-0003
  - **Do:** Create `eslint.config.mjs` at root and per-package configs extending `packages/config`. _(Superseded by ADR-010: one root config with per-package rules generated in `packages/config`.)_ Enable `strictTypeChecked` and `stylisticTypeChecked`. Add `eslint-config-prettier`. Add `lint` script with `--max-warnings 0`.
  - **Done when:** `pnpm lint` passes on the skeleton; a planted `any` and a planted `!` each fail lint.

- [x] **T-0005 · Layer boundary rules**
  - **Deps:** T-0004
  - **Do:** Configure `eslint-plugin-boundaries` with the rules in §6.2. Add a test file per rule that is expected to fail, verified in a separate lint run.
  - **Done when:** an illegal import (for example `packages/formula` importing `react`) fails `pnpm lint`.

- [x] **T-0006 · Git hooks**
  - **Deps:** T-0003, T-0004
  - **Do:** Install husky and lint-staged. Pre-commit runs Prettier and ESLint on staged files.
  - **Done when:** a commit with a formatting error is rejected.
  - **Note:** per §6.3 lint-staged runs `prettier --write`, so formatting problems are fixed in the commit rather than rejected; lint errors (e.g. a planted `any`) reject the commit.

- [x] **T-0007 · Test tooling**
  - **Deps:** T-0002
  - **Do:** Add Vitest with a workspace config and coverage thresholds (80% for `formula`, `plugin-engine`, permission logic). Add one passing example test per package.
  - **Done when:** `pnpm test` runs all packages and reports coverage.

- [x] **T-0008 · Turborepo task graph**
  - **Deps:** T-0002, T-0004, T-0007
  - **Do:** Add `turbo.json` with pipelines for `build`, `typecheck`, `lint`, `test`, with caching.
  - **Done when:** a second `pnpm build` with no changes is served from cache.

- [x] **T-0009 · CI pipeline**
  - **Deps:** T-0003, T-0004, T-0007, T-0008
  - **Do:** GitHub Actions workflow running the steps in §6.4 on push and PR.
  - **Done when:** a PR with a lint error fails CI; a clean PR passes.
  - **Note:** workflow written and validated with `actionlint`; every step passes in a clean local clone and `pnpm lint` fails on a planted error. Verified on GitHub: PR #1 passes; PR #2 with a planted `any` fails at the Lint step.

- [x] **T-0010 · Editor setup**
  - **Deps:** T-0004, T-0003
  - **Do:** Add `.vscode/extensions.json` and `.vscode/settings.json` (format on save, ESLint working directories).
  - **Done when:** opening the repo in VS Code shows no false ESLint or Prettier errors.

### M1 — Core server: users, auth, tables

- [x] **T-0101 · Config and logger**
  - **Deps:** T-0002
  - **Do:** `apps/server/src/config` parses env vars with Zod (`DATA_DIR`, `PORT`, `SESSION_TTL`, `PUBLIC_URL`; also `LOG_LEVEL` and `TRUST_PROXY`, see ADR-011). Structured logger with request IDs.
  - **Done when:** invalid env values fail startup with a readable message; a unit test covers the schema.

- [x] **T-0102 · Database schema and migrations**
  - **Deps:** T-0101
  - **Do:** Drizzle schema for `users`, `sessions`, `game_tables`, `members`, `invites`, `instance_settings`. Enable WAL mode. Generate initial migration.
  - **Done when:** `pnpm db:migrate` creates `vtt.sqlite` from scratch; migrations run on server start.

- [x] **T-0103 · Password hashing and sessions**
  - **Deps:** T-0102
  - **Do:** Argon2id hashing. Session creation, validation, rotation on login, expiry. Cookie settings per FR-AUTH-04.
  - **Done when:** unit tests cover hash/verify, expired session rejection, and cookie flags.

- [x] **T-0104 · Setup flow and first admin**
  - **Deps:** T-0103
  - **Do:** `GET /api/v1/setup/status` and `POST /api/v1/setup/admin`, which are only valid while no users exist.
  - **Done when:** FR-AUTH-01 tested: second call returns 409.

- [x] **T-0105 · Login, logout, me, password change**
  - **Deps:** T-0103
  - **Do:** Auth routes per §10.1 with rate limiting (FR-AUTH-07) and CSRF header check.
  - **Done when:** integration tests cover success, wrong password, rate limit, and missing CSRF.

- [x] **T-0106 · User administration**
  - **Deps:** T-0105
  - **Do:** Admin routes to create users (generated password), disable, and delete (FR-AUTH-02, 06).
  - **Done when:** tests confirm non-admins get 403 and deleted users' messages keep author snapshot (once chat exists; stub test now).
  - **Note:** the author-snapshot check in `apps/server/test/users.test.ts` was implemented with T-0205.

- [x] **T-0107 · Table creation and listing**
  - **Deps:** T-0105
  - **Do:** `POST /tables` requires an enabled plugin id; records `systemVersion` (FR-TABLE-01, 02). `GET /tables` lists the user's tables.
  - **Done when:** creating a table with a disabled plugin returns 422; the creator is GM.

- [x] **T-0108 · Membership and roles**
  - **Deps:** T-0107
  - **Do:** Member routes, role changes, removal, default character setting (FR-TABLE-04, 05, 07).
  - **Done when:** only GM can change roles; removing a member leaves their actors unowned.
  - **Note:** actors arrived in M2; the unowned-actors check in `apps/server/test/members.test.ts` was implemented with T-0201.

- [x] **T-0109 · Invites**
  - **Deps:** T-0108
  - **Do:** Create, expire, revoke, and accept invite links with role (FR-TABLE-03).
  - **Done when:** an expired or revoked token returns 410; accepting adds membership once.

- [x] **T-0110 · Permission service**
  - **Deps:** T-0108
  - **Do:** `packages/shared/permissions` pure functions: `canViewActor`, `canEditActor`, `canViewJournal`, `canSeeAudience`, etc., from roles and ownership. Used by server and by UI hints.
  - **Done when:** exhaustive table-driven unit tests cover every role × ownership combination (coverage ≥ 80%).

- [x] **T-0111 · Web app shell and auth screens**
  - **Deps:** T-0105, T-0010
  - **Do:** Vite app, router, login, setup, account page, table list, create-table dialog. Uses `packages/ui` primitives.
  - **Done when:** Playwright smoke test: set up admin, log in, create a table.
  - **Note:** `e2e/tests/smoke.spec.ts` runs on Chromium against the built apps (`pnpm e2e`); Firefox and WebKit join with T-0702. The test plugin is seeded into a fresh data dir until the scanner exists (T-0403).

### M2 — Entities and realtime

- [x] **T-0201 · Entity persistence (SQL)**
  - **Deps:** T-0102, T-0110
  - **Do:** Tables for `actors`, `items`, `journal_entries` (metadata only), `ownership` JSON, `soft_deleted_at`. Repositories in `apps/server/src/db`.
  - **Done when:** repository tests cover create, list with filters, soft delete, and restore within 30 days (FR-ENT-04).
  - **Note:** repositories in `apps/server/src/db/repositories/`, tests in `apps/server/test/repositories.test.ts`. Retention is `SOFT_DELETE_RETENTION_DAYS` (ADR-014). The FR-TABLE-04 check from T-0108 is implemented. Scheduling `purgeDeletedEntities()` came with T-0202.

- [x] **T-0202 · Actor and item REST API**
  - **Deps:** T-0201
  - **Do:** CRUD, duplicate, ownership updates, item copy into actor (FR-ENT-01..06). Returns projections only; live data is via collab (M5).
  - **Done when:** integration tests enforce ownership rules on every endpoint.
  - **Note:** `apps/server/test/actors.test.ts` and `items.test.ts`. Actor and item types are read from new `plugins` columns that tests seed until T-0403; restore endpoints, the `playersMayCreateAnyActorType` table option and the trash purge schedule were added (ADR-015).

- [x] **T-0203 · Events WebSocket**
  - **Deps:** T-0105, T-0110
  - **Do:** `/ws/events` with session auth on upgrade, envelope validation (Zod), subscribe/unsubscribe, heartbeat, and per-table fan-out (§10.2).
  - **Done when:** a test client receives `entity.changed` only for tables it belongs to.
  - **Note:** `apps/server/test/events.test.ts`. The protocol lives in `@vtt/shared/api` (`events.ts`). Upgrades also check the `Origin`; sessions are re-checked on every message and heartbeat (ADR-016).

- [x] **T-0204 · Entity change notifications**
  - **Deps:** T-0202, T-0203
  - **Do:** Emit `entity.changed` on create/update/delete/restore (FR-ENT-07).
  - **Done when:** two browser sessions see the list update without refresh (tested in e2e).
  - **Note:** every actor and item mutation publishes `entity.changed` to the members who can see the entity, verified on the wire in `events.test.ts`. The two-browser e2e is `e2e/tests/entities.spec.ts` (T-0208).

- [x] **T-0205 · Chat storage and REST history**
  - **Deps:** T-0201
  - **Do:** `chat_messages` table with `audience`, `recipients`, `kind`, `text`, `rolls`, `card`, `speaker` snapshot. Paginated history with audience filtering in the query (FR-CHAT-01, 02, 07).
  - **Done when:** a whisper is absent from history for a non-recipient (repository and API tests).
  - **Note:** `apps/server/test/chat.test.ts`. History is paged on an autoincrement `seq` with an opaque cursor; `POST /tables/:id/messages` shares the `chat.send` code (ADR-016).

- [x] **T-0206 · Chat over events socket**
  - **Deps:** T-0203, T-0205
  - **Do:** `chat.send` handling, audience-filtered fan-out, speaker validation (user owns actor or is GM).
  - **Done when:** whispers and GM messages reach only permitted sockets (integration tests on the wire).
  - **Note:** `chat.test.ts` › "chat on the wire" checks every frame each socket received, including that a hidden message's id never appears.

- [x] **T-0207 · Chat UI**
  - **Deps:** T-0206, T-0111
  - **Do:** Chat panel with speaker select, audience select, infinite scroll, plain-text message rendering, `/r` and `/gmr` command parsing.
  - **Done when:** Playwright test sends public, whisper, and GM messages and verifies visibility for two users.
  - **Note:** `e2e/tests/chat.spec.ts` checks a GM and two players, live and after a reload. The panel lives on the new table page (`/tables/:tableId`). Messages are posted over REST and arrive over the socket; `/r` and `/gmr` are parsed, but rolling waits for M3 (ADR-016).

- [x] **T-0208 · Actor and item list UI**
  - **Deps:** T-0204, T-0111
  - **Do:** Sidebar tabs for actors and items with search, type filter, create, duplicate, delete, and ownership dialog.
  - **Done when:** all FR-ENT requirements have a passing e2e or integration test.
  - **Note:** FR-ENT-01..07 are covered by `e2e/tests/entities.spec.ts`, `apps/web/test/entities.test.tsx` and the server's `actors`, `items` and `events` tests. FR-ENT-08 and 09 (CRDT documents) are built and tested with M5 (T-0501, T-0502). `GET /tables/:id/types` was added for the creation forms (ADR-015).

### M3 — Formula and dice engine

- [x] **T-0301 · Formula lexer and parser**
  - **Deps:** T-0002, T-0007
  - **Do:** `packages/formula` parser for the grammar in §8.9 with source positions. Use a parser generator or a hand-written Pratt parser; no `eval`.
  - **Done when:** round-trip tests and error-position tests pass; invalid input produces a message with line and column.
  - **Note:** grammar details (precedence, dice counts in parentheses, custom dice names like `dF`) are in ADR-017.

- [x] **T-0302 · Formula evaluator (pure mode)**
  - **Deps:** T-0301
  - **Do:** Evaluate references against an injected data context; whitelist functions; step limit; type errors.
  - **Done when:** property tests show no evaluation outside the whitelist; step limit enforced.
  - **Note:** typing, reference and function rules are in ADR-017.

- [x] **T-0303 · Dice engine**
  - **Deps:** T-0302
  - **Do:** Dice terms (FR-DICE-01), custom dice (FR-DICE-03), injected RNG, full die result list (FR-DICE-04).
  - **Done when:** seeded RNG gives identical results across runs (FR-DICE-05); distribution test for `2d6` over 100k rolls within tolerance.
  - **Note:** modifier order, custom dice faces and limits are in ADR-017.

- [x] **T-0304 · Roll resolution with references**
  - **Deps:** T-0303
  - **Do:** Resolve `@` references against actor state, record resolved expressions in the result (FR-DICE-02, 04).
  - **Done when:** the result object includes expression, resolved expression, dice, and total.

- [x] **T-0305 · Roll endpoint and chat integration**
  - **Deps:** T-0304, T-0206
  - **Do:** `POST /tables/:id/rolls` and `roll.request` over events; server posts roll messages with audience rules (FR-CHAT-03, 04, 05).
  - **Done when:** secret roll results are invisible to players on the wire (integration test).
  - **Note:** `apps/server/test/rolls.test.ts` checks the wire and history; `e2e/tests/rolls.spec.ts` checks three browser sessions. Roll messages arrive as `chat.message`; recipes join the endpoint with T-0407 (ADR-018).

### M4 — Plugin system

- [x] **T-0401 · Plugin schemas (Zod source)**
  - **Deps:** T-0302
  - **Do:** `packages/plugin-schema`: Zod schemas for manifest, actor/item types, sheets, rolls, dice, cards, settings, combat (stub), lang. Emit JSON Schemas at build into `schemas/`.
  - **Done when:** emitted JSON Schemas validate the two reference plugins; a snapshot test guards changes.
  - **Note:** `pnpm build` writes `schemas/<kind>.schema.json` (draft 2020-12), which are committed so editors work without a build; `test/json-schema.test.ts` fails when they are stale and validates both reference plugins with Ajv and Zod. The schemas carry no messages; T-0402 words issues with file and JSON path. Small additions within §8: `dice.json` faces may map text to numbers (`values`, FR-DICE-03) and the `derived` node takes an optional `label` (ADR-019). The reference plugins are JSON-only first versions; T-0411 and T-0412 complete them.

- [x] **T-0402 · Plugin validator**
  - **Deps:** T-0401, T-0301
  - **Do:** Validate all files, check formula references against schema paths, check `hasCode` consistency, lang key coverage, unsupported keyword rejection (§8.4). Errors include file and JSON path (FR-PLUGIN-02).
  - **Done when:** a fixture set of valid and invalid plugins produces expected error lists.
  - **Note:** `validatePlugin(files)` in `@vtt/plugin-schema` is pure, so the server and the CLI share it (ADR-019). Fixtures are in `packages/plugin-schema/test/fixtures/plugins.ts`; both reference plugins validate clean. CSS checks come with T-0404 and `coreApi` with T-0403.

- [x] **T-0403 · Plugin scanner and registry**
  - **Deps:** T-0402, T-0102
  - **Do:** Scan `DATA_DIR/plugins`, validate, check `coreApi`, persist registry rows, expose enable/disable (FR-PLUGIN-01, 03, 07). Rescan endpoint.
  - **Done when:** adding a folder and calling rescan makes it appear without restart.
  - **Note:** also fill `plugins.actor_types` (`{ <type>: { controlledBy } }`) and `plugins.item_types` from `actors/` and `items/`; the entity API reads them (ADR-015).
  - **Note:** done in `apps/server/src/plugins/` with `apps/server/test/plugins.test.ts`. Rows get a status (`ready`, `invalid`, `incompatible`, `missing`) and the last scan's issues; enabling code needs `acknowledgeCode`; tables of an unavailable system are read-only for entity changes and rolls (ADR-020).

- [x] **T-0404 · Scoped CSS processor**
  - **Deps:** T-0403
  - **Do:** PostCSS plugin implementing §8.6, with cache keyed by content hash.
  - **Done when:** tests confirm prefixing, `:root` rewrite, `@import` removal, forbidden property stripping, and `@layer plugin` wrapping.
  - **Note:** `scopeCss` is in `@vtt/plugin-schema` (`test/css.test.ts`) so the validator and the CLI apply it too; the server's disk cache is `apps/server/src/plugins/css-cache.ts` (ADR-021).

- [x] **T-0405 · Plugin asset serving**
  - **Deps:** T-0404
  - **Do:** Serve `/plugins/<id>/*` with correct MIME types, cache headers, and path traversal protection. Serve only files inside the plugin folder.
  - **Done when:** `../` traversal attempts return 404 (tested).
  - **Note:** `apps/server/src/http/routes/plugin-assets.ts` with `test/plugin-assets.test.ts`. Signed-in users only, available plugins only, an allow-list of file types, scoped stylesheets, `no-cache` with ETags (ADR-022).

- [x] **T-0406 · Plugin admin UI**
  - **Deps:** T-0403, T-0111
  - **Do:** Admin page listing plugins, status, validation errors, code flag confirmation, enable/disable, rescan.
  - **Done when:** FR-ADMIN-02 has an e2e test.
  - **Note:** `/admin/plugins` (`apps/web/src/routes/admin-plugins.tsx`), with `test/plugins.test.tsx` and `e2e/tests/plugins.spec.ts`. Issues are worded from the web catalogue (`pluginIssue.*`), using `@vtt/plugin-schema/issues` so the page does not bundle the CSS scoper. Enabling a plugin with code lists its code files and asks first.

- [x] **T-0407 · Plugin engine**
  - **Deps:** T-0402, T-0302
  - **Do:** `packages/plugin-engine`: defaults from schema, derived value computation, roll recipe execution (outcomes), card resolution, actor-to-Yjs schema mapping (no Yjs dependency in this package; mapping produces a plain description).
  - **Done when:** unit tests cover derived values, outcomes ordering, and missing-card fallback (FR-CHAT-06).
  - **Note:** `createRules()` in `packages/plugin-engine`, tested in `test/derived.test.ts`, `recipes.test.ts`, `data.test.ts` and `rules.test.ts`. Collections are id-keyed maps outside Yjs too; the server's roll endpoint is not wired to the engine yet (ADR-023).

- [x] **T-0408 · Sheet renderer (layout to React)**
  - **Deps:** T-0401, T-0407, T-0111
  - **Do:** `packages/sheet-renderer` with built-in nodes from §8.5, `visibleIf` evaluation, `SheetStore` interface, `data-field` attributes, phone-responsive layout (FR-SHEET-10).
  - **Done when:** renderer snapshot tests for every node type; preview page renders `tiny-d20` sheet against a mock store.
  - **Note:** snapshots in `packages/sheet-renderer/test/nodes.test.tsx`; the preview is `pnpm --filter @vtt/sheet-renderer preview`, and `test/preview/tiny-d20.test.tsx` renders `tiny-d20` through it. Checked at 360 px in Chromium (ADR-024).

- [x] **T-0409 · Plugin host in web app**
  - **Deps:** T-0405, T-0408
  - **Do:** `apps/web/src/plugin-host`: fetch plugin manifests, load `code/client.js` via dynamic import with a shared React import map, inject scoped CSS, merge lang files, mount sheets and card renderers.
  - **Done when:** a plugin with a custom node renders it in the app; uninstalling the plugin degrades gracefully (table read-only message).
  - **Note:** `e2e/tests/plugin-host.spec.ts` enables `e2e-code` (client code with a custom node and a custom card), opens a sheet, rolls and disables the system. `GET /systems/:id` sends the definition; rolls and recipes run through the plugin engine (`apps/server/test/system-rolls.test.ts`). Sheets are read-only until M5 (ADR-025).

- [x] **T-0410 · Plugin CLI**
  - **Deps:** T-0402, T-0404, T-0408
  - **Do:** `packages/plugin-cli` with `validate`, `dev` (preview server), `pack`, `schema` commands (§8.13).
  - **Done when:** `vtt-plugin validate plugins/tiny-d20` passes; `pack` produces an archive the server can install.
  - **Note:** `packages/plugin-cli/test/cli.test.ts` covers the commands; `e2e/tests/plugin-install.spec.ts` packs a fixture with the CLI and installs it from the plugin admin page (`POST /plugins/install`). Archives and folder reading live in `@vtt/plugin-io` (ADR-026).

- [x] **T-0411 · Reference plugin: tiny-d20**
  - **Deps:** T-0410
  - **Do:** Build a d20 system: character and NPC types, skills collection, HP counter, a secret GM note, a skill roll recipe with outcomes, one custom node (`hpBar`), scoped CSS, pt-BR and en lang files.
  - **Done when:** every feature in §8 that the plugin uses is exercised by an e2e test.
  - **Note:** `hpBar` is `plugins/tiny-d20/code/client.tsx`. `e2e/tests/reference-plugins.spec.ts` packs, installs and plays the plugin; pt-BR texts, table settings and the item sheet have no place in the app yet (ADR-027).

- [x] **T-0412 · Reference plugin: tiny-pool**
  - **Deps:** T-0410
  - **Do:** Dice-pool system: custom die `dF`, success-count rolls, no code folder at all.
  - **Done when:** the plugin works with `hasCode: false` and all sheets render.
  - **Note:** covered by `e2e/tests/reference-plugins.spec.ts` (pool and `4dF` rolls) and the sheet-renderer preview test (ADR-027).

### M5 — Live sheets (CRDT)

- [x] **T-0501 · Hocuspocus server integration**
  - **Deps:** T-0203, T-0102
  - **Do:** Mount Hocuspocus on `/ws/collab`. Implement `onAuthenticate` with session validation, document name parsing, and access checks (§9.3). Log denials.
  - **Done when:** unauthorised connections are rejected in tests; observers cannot send updates (tested).
  - **Note:** `apps/server/src/realtime/collab.ts`, tested in `apps/server/test/collab.test.ts`. Document names are parsed in `@vtt/shared` (`parseDocumentName`); access is re-checked before every message (ADR-028).

- [x] **T-0502 · Document persistence**
  - **Deps:** T-0501
  - **Do:** `onLoadDocument` and `onStoreDocument` with the `ydocs` table, debounced store, projection refresh in one transaction (§9.6).
  - **Done when:** restart the server and reload a sheet with identical state; projection matches state.
  - **Note:** `apps/server/src/domain/documents.ts`, tested in `apps/server/test/documents.test.ts`. Built after T-0504, whose mapping it needs to start documents from the projection (ADR-029).

- [x] **T-0503 · Secret layer isolation**
  - **Deps:** T-0501
  - **Do:** Separate `actor:<id>:secret` documents; ensure they are never sent to unauthorised sockets (NFR-08).
  - **Done when:** a wire-level test with a player socket confirms no secret bytes are received.
  - **Note:** `apps/server/test/secrets.test.ts`. The projection holds both layers, so REST views (`dataFilter`) and a player's typed formulas (`playerDefinition`) leave secret fields out too; types without secret fields have no secret document (ADR-030).

- [x] **T-0504 · Schema-to-Yjs mapping**
  - **Deps:** T-0407, T-0502
  - **Do:** Implement mapping in `packages/plugin-engine` as a pure description; server and client use it to create and read documents (`x-kind` handling, collections keyed by id, `sort` keys).
  - **Done when:** round-trip tests: JSON → Yjs → JSON for every `x-kind`.
  - **Note:** `packages/plugin-engine/src/ydoc.ts` (`writeLayer`, `readLayer`, `splitLayers`, `mergeLayers`), tested in `packages/plugin-engine/test/ydoc.test.ts`. The server uses it (T-0502); the web app will with T-0506 (ADR-029).

- [x] **T-0505 · Server-side validation and adjust**
  - **Deps:** T-0504
  - **Do:** On persist, validate and repair invalid values (FR-SHEET-09). Implement `adjust(path, delta)` applied in a transaction (FR-SHEET-08).
  - **Done when:** concurrent `adjust(-3)` from two clients yields a net −6.
  - **Note:** stateless messages on the document (`collabClientMessage`/`collabServerMessage` in `@vtt/shared/api`); `repairLayer` and `adjustCounter` in `packages/plugin-engine/src/ydoc.ts`. Tested in `apps/server/test/sheet-data.test.ts` and `packages/plugin-engine/test/repair.test.ts` (ADR-031).

- [x] **T-0506 · Sheet store and binding in web app**
  - **Deps:** T-0504, T-0408
  - **Do:** `apps/web/src/collab` implements `SheetStore` over Yjs; `field`, `list`, `longText` nodes bind to it; read-only mode for observers (FR-SHEET-03).
  - **Done when:** two browsers edit one sheet and see each other's changes within 500 ms (e2e).
  - **Note:** `createYjsStore` and `useLiveSheet` in `apps/web/src/collab`, tested in `apps/web/test/collab.test.ts` and `e2e/tests/live-sheets.spec.ts`. `longText` still replaces the whole text until T-0510 (ADR-032).

- [x] **T-0507 · Presence and awareness**
  - **Deps:** T-0506
  - **Do:** Yjs awareness for focused fields; colored outline and name badge (FR-SHEET-02).
  - **Done when:** e2e confirms the badge appears on the other client within 1 s of focus.
  - **Note:** `useSheetPresence` in `apps/web/src/collab/presence.ts` and the renderer's `presence` prop; awareness carries user ids only, names and colors come from the members (ADR-033). Tested in `apps/web/test/presence.test.ts`, the renderer tests and `e2e/tests/live-sheets.spec.ts`.

- [x] **T-0508 · Collection reorder under concurrency**
  - **Deps:** T-0506
  - **Do:** `sort` fractional index updates for reorder; add/remove via keyed map (FR-SHEET-06).
  - **Done when:** concurrent add and reorder from two clients produce no duplicates and no lost rows (property test with two Y.Doc instances).
  - **Note:** `apps/web/test/collab-concurrency.test.ts`. The test found rows lost when two clients created a missing collection map at once; the server now creates every map on load (`ensureContainers`, ADR-034).

- [x] **T-0509 · Derived values live**
  - **Deps:** T-0506, T-0302
  - **Do:** Derived fields recompute on every change in both clients and on the server for rolls (FR-SHEET-05).
  - **Done when:** changing `str` updates `strMod` in a second browser without refresh.
  - **Note:** clients compute derived values from the live store (`e2e/tests/live-sheets.spec.ts`). Rolls read an actor's loaded live documents before the projection (`liveActorData` in `apps/server/src/domain/documents.ts`, tested in `apps/server/test/sheet-data.test.ts`), as §9.6 asks.

- [x] **T-0510 · Long text collaboration**
  - **Deps:** T-0506
  - **Do:** Editor bound to `Y.Text` for `longText` fields and journal bodies (FR-SHEET-07, FR-JOURNAL-01, 04). Use TipTap with the Collaboration extension, or a minimal editor if TipTap is deferred.
  - **Done when:** two clients type simultaneously into one note without loss.
  - **Note:** `longText` uses a minimal editor: `SharedTextarea` in `packages/sheet-renderer/src/text.tsx` over `SheetStore.text()`, where the Yjs store wraps the field's `Y.Text` (ADR-035). `richText` uses TipTap with the Collaboration extension over a `Y.XmlFragment` (Q3, ADR-037): `apps/web/src/collab/RichTextEditor.tsx`, rendered through `<Sheet renderRichText>`. Journal bodies reuse it with T-0601. Tested in the renderer, `apps/web/test/collab.test.ts`, `apps/web/test/rich-text.test.tsx` and `e2e/tests/live-sheets.spec.ts`.

- [x] **T-0511 · Phone layout for sheets**
  - **Deps:** T-0506
  - **Do:** Sheet windows become full-screen routes below 768 px with bottom bar (Chat / Sheet / Dice) (FR-SHEET-10, NFR-10).
  - **Done when:** Playwright mobile viewport test passes with no horizontal scroll.
  - **Note:** on the sheet route below 768 px (`max-md`), `apps/web/src/routes/table.tsx` hides the table header and chat and shows a Chat / Sheet / Dice bar; hidden panes stay mounted so the sheet stays live. The dice pane (`features/table/DicePane.tsx`) rolls common dice or a formula as the sheet's actor. The app header stays. Tested in `e2e/tests/phone-sheets.spec.ts` at 360 px.

- [x] **T-0512 · Document access revocation**
  - **Deps:** T-0501, T-0110
  - **Do:** When membership or ownership changes, disconnect affected sockets from documents (§9.3).
  - **Done when:** a removed member's open sheet becomes inaccessible within 2 s (e2e).
  - **Note:** every open connection is re-checked after each successful mutating request and every 30 s; lost access closes the document, read/write changes reach the client as `access` messages (ADR-036). Tested in `apps/server/test/collab.test.ts` and `e2e/tests/live-sheets.spec.ts`.

### M6 — Journal, members, settings, administration

- [x] **T-0601 · Journal entries (SQL + collab)**
  - **Deps:** T-0510, T-0201
  - **Do:** Create, list, hide/reveal, ownership for journal entries (FR-JOURNAL-01..03).
  - **Done when:** a hidden entry is absent from player-visible list and document access (tested on the wire).
  - **Note:** routes in `apps/server/src/http/routes/journal.ts`; new entries start hidden; the body is the document's root `Y.XmlFragment` `body`, edited with TipTap (ADR-037, ADR-038). Tested in `apps/server/test/journal.test.ts`. The journal UI came later in the same PR (Q11): the Journal tab lists, creates, hides and reveals entries and sets their ownership, and an entry page edits its title and body (`apps/web/src/features/journal/`, `routes/table-journal*.tsx`), covered by `e2e/tests/table-admin.spec.ts`.

- [x] **T-0602 · Members and invites UI**
  - **Deps:** T-0109, T-0111
  - **Do:** Table members page, role change, invite link generation and revocation.
  - **Done when:** FR-TABLE-03, 04 have e2e coverage.
  - **Note:** the Members tab lists members; the GM changes roles, removes members and creates, copies and revokes invite links; each member picks a default character and may leave (`apps/web/src/features/members/`). Links open `/invite/:token`, which joins the table. Covered by `e2e/tests/table-admin.spec.ts`.

- [x] **T-0603 · Table settings**
  - **Deps:** T-0407, T-0111
  - **Do:** Render plugin `settings.json` as form; store values on table; pass to plugin engine (FR-ADMIN-04).
  - **Done when:** changing a house rule changes a derived value in a roll.
  - **Note:** settings are checked against `settings.json` on create and `PATCH`, refused while the system is unavailable, and announced with a `table.updated` event; tiny-d20 derives `maxHp` from `startingHp` and shows it on the character sheet (ADR-039). The GM's Settings tab edits the name, description and house rules (`apps/web/src/routes/table-settings.tsx`). Tested in `apps/server/test/system-rolls.test.ts` (a roll) and `e2e/tests/table-admin.spec.ts` (an open sheet follows the change).

- [x] **T-0604 · Instance settings and health**
  - **Deps:** T-0102
  - **Do:** Instance settings page (FR-ADMIN-01) and `/api/health` (FR-ADMIN-03).
  - **Done when:** health reports DB and plugin status; a broken DB reports unhealthy.
  - **Note:** site name, registration policy and session lifetime (Q12); with the `invite` policy, a table invite link signs new accounts up. `/api/health` answers 503 when the database fails; failed plugins are reported only (ADR-040). Tested in `apps/server/test/instance.test.ts`; the page is `/admin/settings`.

- [x] **T-0605 · Backup procedure**
  - **Deps:** T-0102, T-0502
  - **Do:** Document and script consistent backup (`VACUUM INTO` or sqlite backup API) plus copying `plugins/` (FR-ADMIN-05 doc).
  - **Done when:** the script produces a restorable copy while the server is running (tested).
  - **Note:** `pnpm backup <folder>` writes `VACUUM INTO` and copies `plugins/` into a new dated folder (`apps/server/src/db/backup.ts`); `docs/backup.md` covers taking and restoring. Tested in `apps/server/test/backup.test.ts` with uncheckpointed WAL writes and writes during the backup.

- [x] **T-0606 · Localisation of core UI**
  - **Deps:** T-0111
  - **Do:** Message catalogues for `en` and `pt-BR`, with a lint rule or test that flags missing keys (NFR-11).
  - **Done when:** the test fails on a missing key in `pt-BR`.
  - **Note:** `apps/web/src/i18n/pt-BR.ts`, typed by the `en` catalogue; `test/i18n.test.ts` checks keys and placeholders. The language follows the browser, or the choice on the account page (ADR-041).

### M7 — Reference plugins, hardening, and release

- [x] **T-0701 · Security review pass**
  - **Deps:** all M1–M6
  - **Do:** Review CSRF, CSP headers, rate limits, formula sandboxing, audience leaks, path traversal. Record findings in `docs/security-review.md`.
  - **Done when:** all findings are fixed or have an accepted-risk note.
  - **Note:** 11 findings: 6 fixed, 5 accepted (`docs/security-review.md`). The fixes:
    - a page CSP with script hashes, and security headers on every response;
    - password change counts as failed logins, and sign-up is limited per IP;
    - invite tokens are redacted from logs;
    - `TRUST_PROXY` guidance in the README;
    - lint forbids `eval`.

    See ADR-042; `e2e/tests/security.spec.ts` runs the app under the policy.

- [x] **T-0702 · End-to-end suite**
  - **Deps:** T-0411, T-0412, T-0511, T-0512
  - **Do:** Playwright scenarios: two browsers editing one sheet; whispers; secret rolls; observer read-only; mobile sheet; plugin enable/disable; secret layer on the wire.
  - **Done when:** suite is green in CI on three browsers.
  - **Note:** the suite runs on Chromium, Firefox and WebKit, with one instance per browser (ADR-043). Where each scenario lives:
    - `live-sheets.spec.ts`: two browsers on one sheet, and an observer;
    - `chat.spec.ts`: whispers;
    - `rolls.spec.ts`: secret rolls;
    - `phone-sheets.spec.ts`: the phone sheet;
    - `plugins.spec.ts`: enabling and disabling plugins;
    - `reference-plugins.spec.ts`: the secret layer on the wire, which is new.

    Firefox found two bugs: plugin code did not load (the import map came after the module preloads), and the phone chat box overflowed. Both are fixed.

- [x] **T-0703 · Docker image**
  - **Deps:** T-0009, T-0403
  - **Do:** Multi-stage Dockerfile (builder, runtime with non-root user), `docker-compose.example.yml` with one volume, healthcheck, and reverse proxy example (Caddy) with WebSocket forwarding.
  - **Done when:** `docker compose up` on a clean machine serves the app and a fresh instance completes setup.
  - **Note:** the image and examples are in `docker/`. The server now serves the built web app (`WEB_DIR`), and e2e runs against it. CI's Docker job runs the compose example on a fresh runner on every push and PR, and `docker/smoke-test.sh` checks:
    - the page is served;
    - setup completes;
    - the server is not root;
    - data survives a restart.

    Two bugs were fixed on the way: a 304 brought the data policy to a cached page, and concurrent first counter steps could lose one (ADR-044).

- [x] **T-0704 · Authoring guide and API docs**
  - **Deps:** T-0410, T-0411
  - **Do:** `docs/plugin-authoring.md` covering the full format, a "build your first plugin" tutorial, and generated schema reference.
  - **Done when:** a developer unfamiliar with the project can build a minimal plugin from the guide alone (verified by a reader test).
  - **Note:** the guide describes the format as 0.1.0 runs it, which differs from §8 in places (ADR-045). `docs/plugin-reference.md` is generated from the plugin schemas by `pnpm build`, and a test fails when it is stale. `packages/plugin-cli/test/tutorial.test.ts` follows the tutorial step by step and validates, rolls and packs its plugin. Reader tests: a fresh agent given only the guide and the reference built and packed a different system (2026-10-26); its findings were fixed, including `pack` taking in old archives. The user's own reader test of the tutorial passed too.

- [x] **T-0705 · Release 0.1.0**
  - **Deps:** T-0701, T-0702, T-0703, T-0704
  - **Do:** Changelog, version bump, tag, Docker image published, release notes.
  - **Done when:** tag `v0.1.0` exists and CI publishes the image.
  - **Note:** every package is at `0.1.0`, `CHANGELOG.md` has the release notes, and CI's `release` job publishes the image and the GitHub release when a `v*` tag passes every check (ADR-046). `v0.1.0` was tagged on main (7a99f31) on 2026-10-27; CI published `ghcr.io/rev-oo/rpg-vtt-ai:0.1.0` (public) and the [GitHub release](https://github.com/rev-oo/rpg-vtt-ai/releases/tag/v0.1.0). The first run on the tag hung installing the Playwright browsers and was re-run, so that step now has a time limit.

## Change log

| Date       | Change                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-19 | PRD v0.1 drafted. Stack, data model, plugin format, and monorepo layout decided.                                                                                                                                         |
| 2026-10-19 | M0 implemented (T-0001…T-0010). ADR-008, ADR-009, ADR-010 added.                                                                                                                                                         |
| 2026-10-19 | T-0009 verified on GitHub: PR #1 green, PR #2 (planted `any`) fails at Lint. M0 awaiting sign-off.                                                                                                                       |
| 2026-10-19 | M0 signed off as done. Active milestone is now M1.                                                                                                                                                                       |
| 2026-10-19 | M1 server tasks T-0101…T-0110 implemented on `feat/m1-server` (PR 1 of 2; T-0111 web shell is PR 2). ADR-011 added.                                                                                                      |
| 2026-10-19 | T-0111 implemented (web shell, auth screens, Playwright smoke test). ADR-012 (Tailwind CSS 4) added. M1 awaiting sign-off.                                                                                               |
| 2026-10-20 | T-0111 web app moved to React Router framework mode (SPA) and TanStack Form. ADR-013 added.                                                                                                                              |
| 2026-10-20 | HTTP API schemas moved to `@vtt/shared/api`, shared by server and web (ADR-013).                                                                                                                                         |
| 2026-10-20 | PR #4 merged; first `main` CI run with E2E green. M1 signed off as done. Active milestone is now M2.                                                                                                                     |
| 2026-10-20 | T-0201 implemented (actors, items, journal metadata; repositories). ADR-014 added; Q6 decided.                                                                                                                           |
| 2026-10-20 | T-0202 implemented (actor and item REST API with ownership checks). ADR-015 added.                                                                                                                                       |
| 2026-10-20 | T-0203, T-0205 and T-0206 implemented (events socket, chat storage, history and fan-out); T-0204 server side done. ADR-016 added.                                                                                        |
| 2026-10-20 | T-0207 implemented (table page with the chat panel; chat e2e).                                                                                                                                                           |
| 2026-10-20 | T-0208 implemented (actor and item tabs on the table page); T-0204 e2e added. M2 awaiting sign-off.                                                                                                                      |
| 2026-10-20 | PR #2 merged. M2 signed off as done. Active milestone is now M3.                                                                                                                                                         |
| 2026-10-20 | T-0301 implemented (formula lexer and Pratt parser). ADR-017 added; Q8 decided.                                                                                                                                          |
| 2026-10-20 | T-0302 implemented (pure-mode evaluator). ADR-017 extended.                                                                                                                                                              |
| 2026-10-20 | T-0303 implemented (dice engine, seeded RNG, custom dice). ADR-017 extended.                                                                                                                                             |
| 2026-10-20 | T-0304 implemented (roll results with resolved expressions). ADR-017 extended.                                                                                                                                           |
| 2026-10-20 | T-0305 implemented (roll endpoint, `roll.request`, roll messages in the web chat). ADR-018 added. M3 awaiting sign-off.                                                                                                  |
| 2026-10-21 | M3 signed off as done. Active milestone is now M4.                                                                                                                                                                       |
| 2026-10-21 | T-0401 implemented (plugin file schemas, emitted JSON Schemas, first versions of `tiny-d20` and `tiny-pool`).                                                                                                            |
| 2026-10-21 | T-0402 implemented (plugin validator with issue codes and fixtures). ADR-019 added.                                                                                                                                      |
| 2026-10-21 | T-0403 implemented (plugin scanner, registry rows, admin plugin endpoints, read-only tables). ADR-020 added.                                                                                                             |
| 2026-10-21 | PR #4 merged (T-0401 to T-0403). T-0404 implemented (scoped plugin CSS and its disk cache). ADR-021 added.                                                                                                               |
| 2026-10-21 | T-0405 implemented (plugin file serving under `/plugins/<id>/*`). ADR-022 added.                                                                                                                                         |
| 2026-10-21 | PR #5 merged (T-0404, T-0405). T-0406 implemented (plugin admin page, with an e2e test).                                                                                                                                 |
| 2026-10-21 | T-0407 implemented (plugin engine). ADR-023 added.                                                                                                                                                                       |
| 2026-10-21 | T-0408 implemented (sheet renderer and preview page). ADR-024 added.                                                                                                                                                     |
| 2026-10-22 | PR #6 merged (T-0406 to T-0408). T-0409 implemented (plugin host, `@vtt/sdk/client`, engine-backed rolls and cards). ADR-025 added.                                                                                      |
| 2026-10-22 | PR #7 merged (T-0409). T-0410 implemented (plugin CLI, `@vtt/plugin-io`, `.vttplugin` archives installed from the admin page). ADR-026 added.                                                                            |
| 2026-10-22 | PR #8 merged (T-0410). T-0411 and T-0412 implemented (tiny-d20 `hpBar`, reference plugin e2e tests). ADR-027 added. M4 awaiting sign-off.                                                                                |
| 2026-10-22 | PR #9 merged. M4 signed off as done. Active milestone is now M5.                                                                                                                                                         |
| 2026-10-22 | T-0501 implemented (Hocuspocus on `/ws/collab`, document access checks). ADR-028 added.                                                                                                                                  |
| 2026-10-22 | T-0504 and T-0502 implemented (JSON ↔ Yjs mapping in `@vtt/plugin-engine`, `ydocs` persistence and projection). ADR-029 added.                                                                                           |
| 2026-10-22 | T-0503 implemented (secret layer kept out of player sockets, views and formulas). ADR-030 added.                                                                                                                         |
| 2026-10-22 | T-0505 implemented (`adjust` and repair on persist over collab stateless messages). ADR-031 added.                                                                                                                       |
| 2026-10-22 | T-0506 implemented (live actor sheets in the web app over Yjs). ADR-032 added.                                                                                                                                           |
| 2026-10-22 | T-0507 implemented (presence outlines and name badges on sheet fields). ADR-033 added.                                                                                                                                   |
| 2026-10-22 | T-0508 implemented (collection concurrency property test; server creates maps on load). ADR-034 added.                                                                                                                   |
| 2026-10-22 | T-0509 implemented (derived values live; rolls read the live documents).                                                                                                                                                 |
| 2026-10-22 | T-0510 implemented (collaborative long text with a minimal shared textarea). ADR-035 added.                                                                                                                              |
| 2026-10-22 | T-0511 implemented (phone layout for sheets: Chat / Sheet / Dice bar).                                                                                                                                                   |
| 2026-10-22 | T-0512 implemented (access changes pushed to open documents). ADR-036 added. All M5 tasks done.                                                                                                                          |
| 2026-10-22 | Q3 decided: TipTap edits `richText` fields over a `Y.XmlFragment`; tiny-d20 characters gain a `biography`. ADR-037 added.                                                                                                |
| 2026-10-23 | PR #11 merged. M5 signed off as done. Active milestone is now M6.                                                                                                                                                        |
| 2026-10-23 | T-0601 implemented (journal entries over REST; hidden by default). ADR-038 added; Q11 decided: the journal UI goes in the M6 web PR.                                                                                     |
| 2026-10-23 | T-0603 server side implemented (settings checked against `settings.json`, `table.updated` event, tiny-d20 `maxHp`). ADR-039 added.                                                                                       |
| 2026-10-23 | Rest of M6 implemented in PR #12: journal UI, T-0602 members and invites, T-0603 settings tab, T-0604 instance settings, invite sign-up and health, T-0605 backups, T-0606 `pt-BR`. ADR-040, ADR-041 added; Q12 decided. |
| 2026-10-23 | PR #12 merged. M6 signed off as done. Active milestone is now M7.                                                                                                                                                        |
| 2026-10-23 | T-0701 security review: 6 fixes, 5 accepted risks (`docs/security-review.md`). ADR-042 added.                                                                                                                            |
| 2026-10-25 | PR #13 merged (T-0701). T-0702: e2e on Chromium, Firefox and WebKit; Firefox plugin-loading and phone chat fixes. ADR-043 added.                                                                                         |
| 2026-10-25 | PR #14 merged (T-0702). T-0703: Docker image, compose and Caddy examples; the server serves the web app; 304 policy and counter-step race fixed. ADR-044 added.                                                          |
| 2026-10-26 | PR #15 merged (T-0703); live-sheet flake fixed (PR #16). T-0704: plugin authoring guide, generated file reference, tutorial test. ADR-045 added.                                                                         |
| 2026-10-26 | PR #17 merged (T-0704). Spec brought in line with the code and ADRs: §4.1–4.3, §5, §6.2–6.4, §8 (as built in 0.1.0), §9.2, §9.7, §10.1–10.2, §13.                                                                        |
| 2026-10-26 | PR #18 merged (spec refresh). T-0705 prepared: version 0.1.0, changelog, release job. ADR-046 added.                                                                                                                     |
| 2026-10-27 | PR #19 merged; `v0.1.0` tagged and released (image on GHCR, GitHub release). T-0705 done. M7 and MVP signed off as done. Playwright browser install limited to 5 minutes in CI.                                          |
