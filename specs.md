# PRD: VTT (Virtual Tabletop) Platform

> **Status:** Draft v0.1 · **Date:** 2026-10-19 · **Owner:** TBD
> **Audience:** Human developers and agentic AI coding assistants. This file lives in the repository root (move to `docs/PRD.md` if preferred) and is the source of truth for scope, decisions, and progress.

---

## 0. Progress Tracker

Update this section every time a task changes state. Keep the checkboxes and the milestone table in sync.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (add a note)

### 0.1 Milestone overview

| ID    | Milestone                                                     | Status      | Progress | Target |
| ----- | ------------------------------------------------------------- | ----------- | -------- | ------ |
| M0    | Foundation (monorepo, TypeScript, lint, format, CI)           | Done        | 100%     | —      |
| M1    | Core server: users, auth, tables, membership                  | Done        | 100%     | —      |
| M2    | Entities & realtime: actors, items, events socket, chat       | Done        | 100%     | —      |
| M3    | Formula & dice engine                                         | Done        | 100%     | —      |
| M4    | Plugin system: loader, validator, CSS scoping, sheet renderer | In progress | 50%      | —      |
| M5    | Live sheets (CRDT): Yjs sync, presence, observer mode         | Not started | 0%       | —      |
| M6    | Journal, members, table settings, plugin admin                | Not started | 0%       | —      |
| M7    | Reference plugins & hardening (e2e, Docker, docs)             | Not started | 0%       | —      |
| MVP   | **Release 0.1.0 (self-hosted)**                               | Not started | 0%       | —      |
| V1    | Combat tracker, compendium, plugin code hooks polish          | Not started | 0%       | —      |
| LATER | Maps, tokens, fog of war, assets, migrations, export/import   | Not started | 0%       | —      |

### 0.2 Current focus

- **Active milestone:** M4
- **Next task:** `T-0407`
- **Open blockers:** none
- **Decisions pending:** see §14 (Open Questions)

### 0.3 Change log

| Date       | Change                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-19 | PRD v0.1 drafted. Stack, data model, plugin format, and monorepo layout decided.                                                  |
| 2026-10-19 | M0 implemented (T-0001…T-0010). ADR-008, ADR-009, ADR-010 added.                                                                  |
| 2026-10-19 | T-0009 verified on GitHub: PR #1 green, PR #2 (planted `any`) fails at Lint. M0 awaiting sign-off.                                |
| 2026-10-19 | M0 signed off as done. Active milestone is now M1.                                                                                |
| 2026-10-19 | M1 server tasks T-0101…T-0110 implemented on `feat/m1-server` (PR 1 of 2; T-0111 web shell is PR 2). ADR-011 added.               |
| 2026-10-19 | T-0111 implemented (web shell, auth screens, Playwright smoke test). ADR-012 (Tailwind CSS 4) added. M1 awaiting sign-off.        |
| 2026-10-20 | T-0111 web app moved to React Router framework mode (SPA) and TanStack Form. ADR-013 added.                                       |
| 2026-10-20 | HTTP API schemas moved to `@vtt/shared/api`, shared by server and web (ADR-013).                                                  |
| 2026-10-20 | PR #4 merged; first `main` CI run with E2E green. M1 signed off as done. Active milestone is now M2.                              |
| 2026-10-20 | T-0201 implemented (actors, items, journal metadata; repositories). ADR-014 added; Q6 decided.                                    |
| 2026-10-20 | T-0202 implemented (actor and item REST API with ownership checks). ADR-015 added.                                                |
| 2026-10-20 | T-0203, T-0205 and T-0206 implemented (events socket, chat storage, history and fan-out); T-0204 server side done. ADR-016 added. |
| 2026-10-20 | T-0207 implemented (table page with the chat panel; chat e2e).                                                                    |
| 2026-10-20 | T-0208 implemented (actor and item tabs on the table page); T-0204 e2e added. M2 awaiting sign-off.                               |
| 2026-10-20 | PR #2 merged. M2 signed off as done. Active milestone is now M3.                                                                  |
| 2026-10-20 | T-0301 implemented (formula lexer and Pratt parser). ADR-017 added; Q8 decided.                                                   |
| 2026-10-20 | T-0302 implemented (pure-mode evaluator). ADR-017 extended.                                                                       |
| 2026-10-20 | T-0303 implemented (dice engine, seeded RNG, custom dice). ADR-017 extended.                                                      |
| 2026-10-20 | T-0304 implemented (roll results with resolved expressions). ADR-017 extended.                                                    |
| 2026-10-20 | T-0305 implemented (roll endpoint, `roll.request`, roll messages in the web chat). ADR-018 added. M3 awaiting sign-off.           |
| 2026-10-21 | M3 signed off as done. Active milestone is now M4.                                                                                |
| 2026-10-21 | T-0401 implemented (plugin file schemas, emitted JSON Schemas, first versions of `tiny-d20` and `tiny-pool`).                     |
| 2026-10-21 | T-0402 implemented (plugin validator with issue codes and fixtures). ADR-019 added.                                               |
| 2026-10-21 | T-0403 implemented (plugin scanner, registry rows, admin plugin endpoints, read-only tables). ADR-020 added.                      |
| 2026-10-21 | PR #4 merged (T-0401 to T-0403). T-0404 implemented (scoped plugin CSS and its disk cache). ADR-021 added.                        |
| 2026-10-21 | T-0405 implemented (plugin file serving under `/plugins/<id>/*`). ADR-022 added.                                                  |
| 2026-10-21 | PR #5 merged (T-0404, T-0405). T-0406 implemented (plugin admin page, with an e2e test).                                          |

---

## 1. Vision and Goals

Build a **browser-based, self-hostable virtual tabletop** for tabletop RPGs. The core application provides only the essential infrastructure for running a game table: users, tables, actors (characters and NPCs), items, live character sheets, dice, and chat. Every game-system-specific behaviour (attributes, derived values, roll rules, sheet layout, dice types, initiative) comes from **plugins**.

### 1.1 Goals

- **G1 — System-agnostic core.** The core contains no game rules. Any system that can be expressed with the plugin format runs without changes to the core.
- **G2 — Declarative plugins first.** Most systems are described entirely by JSON and scoped CSS. Code is an explicit, opt-in escape hatch.
- **G3 — Live collaboration.** Any player or GM who has a sheet open sees other people's edits in real time, with no save button.
- **G4 — Trustworthy dice and secrets.** Rolls are computed on the server. Players cannot forge results. Secret and whispered information stays secret at the API level, not just in the UI.
- **G5 — Easy self-hosting.** One container image and one data volume. No mandatory external services.
- **G6 — Type safety end to end.** The entire codebase is TypeScript in `strict` mode. Plugin files are validated against schemas generated from the same source as the TypeScript types.

### 1.2 Non-goals (v0.x / v1)

- Built-in game rules for any specific system.
- Built-in voice or video. Tables link to external tools (Discord, Jitsi).
- A marketplace or hosted content service.
- A visual plugin/system builder (planned for a later version; plugins are authored by developers).
- Maps, tokens, and fog of war (LATER).
- Asset manager, data migrations, world export/import (LATER).
- Multi-instance horizontal scaling. A single server process is the supported topology.
- Native mobile apps. The web app must be usable on phones.

---

## 2. Personas

| Persona              | Description                                                                | Key needs                                                                       |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Game Master (GM)** | Runs the table. Creates NPCs, items, journal entries, and manages members. | Hidden information, whispers, full control over actors and permissions          |
| **Player**           | Owns one or more characters. Rolls dice, chats, and edits their sheet.     | Fast sheet editing on phone and desktop, clear roll results                     |
| **Assistant GM**     | Trusted player with partial GM powers.                                     | Can edit NPCs and see GM-only data, but cannot change table settings or members |
| **Spectator**        | Read-only observer.                                                        | Sees public chat and rolls; no edits                                            |
| **Plugin Author**    | Developer who writes system plugins.                                       | Clear file format, schema validation, CLI tooling, live preview                 |
| **Self-Hoster**      | Person who deploys and maintains the instance.                             | Simple Docker deployment, backups by copying one folder, clear upgrade path     |

---

## 3. Glossary

| Term                     | Definition                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Instance**             | One running deployment of the server, with its own database and plugins folder.                                           |
| **User**                 | An account on the instance. Users can be members of many tables.                                                          |
| **Table** (`game_table`) | A game session. Has exactly one system plugin, fixed at creation, and a set of members.                                   |
| **Member**               | A user's membership in a table, with a role.                                                                              |
| **Role**                 | One of `gm`, `assistant`, `player`, `spectator`.                                                                          |
| **Actor**                | Any entity that acts or is described: characters, NPCs, creatures. The `type` is plugin-defined.                          |
| **Item**                 | A thing an actor owns or that exists in the library: weapons, spells, equipment. Type is plugin-defined.                  |
| **Owned item**           | An item copied into an actor's sheet document. Keeps a `sourceId` back to the library item.                               |
| **Sheet**                | The UI for one actor type, described by a layout JSON file.                                                               |
| **System plugin**        | A folder that defines one game system: types, sheets, rolls, dice, combat, settings, language, styles, and optional code. |
| **Formula**              | A string in the plugin formula language, evaluated on the server (rolls) or in both places (derived values).              |
| **Roll recipe**          | A named, server-side roll definition that sheets trigger with arguments.                                                  |
| **Card**                 | A structured chat message rendered by a plugin-defined template.                                                          |
| **Journal entry**        | A rich-text document for lore, notes, and handouts.                                                                       |
| **Yjs doc**              | The CRDT document that holds the live state of a sheet or journal entry.                                                  |
| **Projection**           | A JSON snapshot of an actor's data kept in SQL for listing and queries.                                                   |
| **Layer**                | A part of an actor's CRDT doc with its own access level (`main`, `secret`).                                               |
| **Core API version**     | The version of the host contract a plugin targets (`coreApi`).                                                            |

---

## 4. Architecture Overview

### 4.1 Stack decisions

| Concern              | Decision                                                                                   | Rationale                                                     |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Language             | **TypeScript** (`strict`, plus `noUncheckedIndexedAccess`) everywhere                      | Type safety across client, server, and shared packages        |
| Monorepo             | **pnpm workspaces** + Turborepo for task caching                                           | Fast installs, strict dependency isolation                    |
| Frontend             | **React 18+ with Vite**, SPA                                                               | Plugins are loaded at runtime; SSR is not needed behind login |
| Frontend routing     | React Router, **framework mode as an SPA** (`ssr: false`) (ADR-013)                        | Typed routes, loaders for guards and data; no SSR server      |
| Client state         | **Zustand** for UI state; **Yjs** for document state                                       | Minimal boilerplate; CRDT handles collaborative data          |
| Backend              | **Node.js LTS + Fastify**                                                                  | Lightweight, good plugin model, native TypeScript support     |
| Realtime (events)    | **WebSocket** (`ws`) at `/ws/events`                                                       | Chat, rolls, entity change notifications, presence            |
| Realtime (documents) | **Hocuspocus** (Yjs WebSocket server) at `/ws/collab`                                      | Mature Yjs backend with auth and persistence hooks            |
| Database             | **SQLite** via **Drizzle ORM** (`better-sqlite3`)                                          | No external service; backup is copying one file               |
| Schema validation    | **Zod** in TypeScript, emitted to **JSON Schema** at build                                 | Single source of truth for types and plugin file schemas      |
| Formula/dice         | Custom parser in `packages/formula`, no `eval`                                             | Safe, testable, same code on both sides                       |
| Scoped CSS           | PostCSS (or lightningcss) in the plugin loader                                             | Predictable, server-side scoping                              |
| Styling (core UI)    | **Tailwind CSS 4**; tokens as a `@theme` in `packages/ui` (ADR-012)                        | Fast iteration, one token file, both colour schemes           |
| Forms                | **TanStack Form**; the shared API schemas (`@vtt/shared/api`) are the validators (ADR-013) | Typed field state; client and server run the same rules       |
| Testing              | **Vitest** (unit/integration), **Playwright** (e2e), Fastify `inject` for HTTP tests       | Standard, fast, multi-browser                                 |
| Lint                 | **ESLint flat config** + `typescript-eslint` + boundary rules (`eslint-plugin-boundaries`) | Enforces type-aware rules and package layering                |
| Format               | **Prettier**                                                                               | Consistent style, enforced in CI and pre-commit               |
| Packaging            | One **Docker** image (multi-stage), one `/data` volume                                     | Self-hosting goal G5                                          |

### 4.2 Process topology

One Node process serves:

- REST API under `/api/*`
- Events WebSocket at `/ws/events`
- Hocuspocus Yjs WebSocket at `/ws/collab`
- Static SPA assets and built-in UI
- Plugin static assets under `/plugins/<pluginId>/*` (client bundles and CSS, read from `/data/plugins`)

Reverse proxy (Caddy or Traefik) handles TLS and must forward WebSocket upgrades on both `/ws/*` paths.

### 4.3 Data locations

Everything lives under a single data directory (`DATA_DIR`, default `/data` in Docker, `./data` in development):

```
/data
├─ vtt.sqlite          database (WAL mode)
├─ plugins/            installed plugin folders
└─ logs/               optional rotating logs
```

### 4.4 Architectural rules

1. **Dependency direction:** `shared` ← `formula` ← `plugin-schema` ← `plugin-engine` ← `sheet-renderer` / `sdk`. `ui` feeds `sheet-renderer`. Apps may import any package. Packages never import apps.
2. **Server never imports React packages** (`ui`, `sheet-renderer`, `sdk/client`). Enforced by lint boundary rules.
3. **Pure packages:** `shared`, `formula`, `plugin-engine` contain no DOM and no Node-only APIs. The RNG is injected.
4. **Plugins never touch the database or raw Yjs.** They interact through the JSON contract and the narrow `ctx` object.
5. **The server is authoritative** for rolls, permissions, membership, and projections.

---

## 5. Repository Structure

```
vtt/
├─ apps/
│  ├─ web/                        Vite + React SPA
│  │  └─ src/
│  │     ├─ routes/               route modules (React Router framework mode)
│  │     ├─ shell/                layout, session, access rules, sidebar tabs, sheet windows
│  │     ├─ features/             chat · actors · items · journal · combat · tables · members
│  │     ├─ collab/               Yjs providers, sheet store, awareness
│  │     ├─ plugin-host/          loads plugin manifests, mounts sheets, injects scoped CSS, import map
│  │     ├─ root.tsx              root route: HTML shell, error boundary
│  │     └─ routes.ts             route config
│  └─ server/
│     └─ src/
│        ├─ http/                 Fastify routes (auth, tables, entities, chat, plugins)
│        ├─ realtime/             /ws/events, Hocuspocus setup, auth hooks
│        ├─ domain/               services: rolls, chat, combat, permissions, invites
│        ├─ db/                   Drizzle schema, migrations, repositories
│        ├─ plugins/              scanner (runs the plugin-schema validator), registry, scoped CSS cache, static serving
│        ├─ config/               env parsing (zod)
│        └─ main.ts
├─ packages/
│  ├─ shared/                     entity types, ids, permission rules, event protocol, API contract (Zod)
│  ├─ formula/                    formula parser, evaluator, dice engine (pure)
│  ├─ plugin-schema/              Zod schemas for every plugin file, JSON Schema emitter, validator, CSS scoper
│  ├─ plugin-engine/              defaults, derived data, roll recipes, schema→Yjs mapping, outcome logic
│  ├─ ui/                         design tokens + primitives (Button, Dialog, Tabs, WindowFrame)
│  ├─ sheet-renderer/             layout JSON → React; built-in nodes; SheetStore interface
│  ├─ sdk/                        public API for code/ entries (defineShared/Client/Server, hooks, ctx types)
│  ├─ config/                     shared tsconfig, eslint, prettier presets
│  └─ plugin-cli/                 vtt-plugin: validate · dev (live preview) · pack
├─ plugins/                       reference systems built in-tree
│  ├─ tiny-d20/
│  └─ tiny-pool/
├─ e2e/                           Playwright suites
├─ docker/                        Dockerfile, docker-compose.example.yml
├─ docs/                          authoring guide, ADRs, API reference
├─ .github/workflows/             CI
├─ .husky/                        git hooks (pre-commit: lint-staged)
├─ eslint.config.mjs
├─ .prettierrc.json
├─ .prettierignore
├─ .editorconfig
├─ .nvmrc
├─ pnpm-workspace.yaml
├─ turbo.json
├─ package.json
├─ tsconfig.base.json
└─ PRD.md
```

Dev-only runtime data (`./data`) is gitignored.

---

## 6. TypeScript, Linting, and Formatting Standards

These are **mandatory requirements**, not preferences. They are implemented in milestone M0.

### 6.1 TypeScript

- `tsconfig.base.json` sets: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`, `moduleResolution: "bundler"` for apps and `"NodeNext"` for the server.
- Every package has its own `tsconfig.json` extending the base, and a `typecheck` script. Project references are used so `tsc -b` builds the graph.
- **No `any`.** `@typescript-eslint/no-explicit-any` is an error. Use `unknown` and narrow.
- **No non-null assertions** (`!`) except in tests. Rule: `@typescript-eslint/no-non-null-assertion` is an error outside `*.test.ts`.
- `// @ts-expect-error` requires a description. `@typescript-eslint/ban-ts-comment` is configured accordingly.
- Public function return types are explicit at package boundaries (`explicit-module-boundary-types`).
- Runtime input (HTTP bodies, WebSocket messages, plugin JSON, environment variables) is validated with Zod at the boundary and typed from the schema. Never cast external data with `as`.

### 6.2 ESLint

- ESLint flat config (`eslint.config.mjs`) at the root, shared presets in `packages/config`.
- Rule sets: `@eslint/js` recommended, `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` (web), `eslint-plugin-import` (ordering, no cycles).
- **Layer boundaries** enforced by `eslint-plugin-boundaries`:
  - `apps/server` may not import `packages/ui`, `packages/sheet-renderer`, or `packages/sdk/client`.
  - `packages/shared`, `packages/formula`, `packages/plugin-engine` may not import `react`, `react-dom`, `fastify`, `drizzle-orm`, or any Node built-in (`fs`, `path`, `node:*`).
  - `packages/*` may not import from `apps/*`.
- `no-console` is an error in `apps/server` except via the logger module.
- Lint runs with `--max-warnings 0`.

### 6.3 Prettier

- `.prettierrc.json`: `printWidth: 100`, `singleQuote: true`, `trailingComma: "all"`, `semi: true`, `arrowParens: "always"`.
- Format applies to TS, TSX, JSON, CSS, Markdown, and YAML.
- Plugin JSON files in `plugins/*` are formatted with Prettier too; the plugin CLI emits them in canonical form.
- `prettier --check` runs in CI. `prettier --write` runs in lint-staged.
- `eslint-config-prettier` disables conflicting ESLint style rules.

### 6.4 Git hooks and CI

- **Pre-commit (husky + lint-staged):** Prettier on staged files, ESLint on staged TS files.
- **CI (GitHub Actions or equivalent), on every push and PR:**
  1. `pnpm install --frozen-lockfile`
  2. `pnpm format:check`
  3. `pnpm lint`
  4. `pnpm typecheck` (`tsc -b`)
  5. `pnpm test` (Vitest)
  6. `pnpm build`
  7. `pnpm e2e` (Playwright, on main and release branches)
  8. Docker image build (on release branches)
- A PR cannot merge unless CI is green.

### 6.5 Editor and tooling

- `.editorconfig`: UTF-8, LF line endings, 2-space indent, final newline.
- `.nvmrc` pins Node LTS. `package.json` sets `engines` and `packageManager`.
- Recommended VS Code extensions listed in `.vscode/extensions.json` (ESLint, Prettier).

---

## 7. Functional Requirements

Requirement IDs are stable. Reference them in tasks and tests (for example `FR-AUTH-01`).

### 7.1 Accounts and access (`FR-AUTH`)

| ID         | Requirement                                                                                                               | Priority |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-AUTH-01 | The first user to start a fresh instance is created via a setup screen and becomes instance admin.                        | MVP      |
| FR-AUTH-02 | Admins create users with a username and a generated one-time password, or send an invite link.                            | MVP      |
| FR-AUTH-03 | Users log in with username and password. Passwords are hashed with Argon2id.                                              | MVP      |
| FR-AUTH-04 | Sessions use secure, HTTP-only, SameSite=Lax cookies with server-side session records and expiry.                         | MVP      |
| FR-AUTH-05 | Users can change their password and display name.                                                                         | MVP      |
| FR-AUTH-06 | Admins can disable or delete users. Deleting a user keeps their chat messages with the author name snapshot.              | MVP      |
| FR-AUTH-07 | Login attempts are rate-limited per IP and per username.                                                                  | MVP      |
| FR-AUTH-08 | Instance admin is distinct from table GM. Admins cannot read a table's secret data unless they are a member with GM role. | MVP      |

### 7.2 Tables and membership (`FR-TABLE`)

| ID          | Requirement                                                                                                                           | Priority |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-TABLE-01 | Any user can create a table and becomes its GM. Creation requires selecting an installed system plugin.                               | MVP      |
| FR-TABLE-02 | A table's system plugin and its `systemVersion` are fixed at creation.                                                                | MVP      |
| FR-TABLE-03 | GMs invite users by generating a table invite link with a role (`player`, `spectator`, `assistant`). Links can expire and be revoked. | MVP      |
| FR-TABLE-04 | GMs change member roles and remove members. Removing a member keeps their characters, which become unowned.                           | MVP      |
| FR-TABLE-05 | A user may belong to multiple tables and set a default character per table.                                                           | MVP      |
| FR-TABLE-06 | GMs and assistants can archive a table (read-only, still exportable in the future).                                                   | v1       |
| FR-TABLE-07 | Only the table GM can change table settings, roles, and system-level options.                                                         | MVP      |

### 7.3 Actors and items (`FR-ENT`)

| ID        | Requirement                                                                                                                                                               | Priority |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-ENT-01 | GMs and players can create actors of any type declared by the table's plugin. Players may create only types with `controlledBy: "player"` unless the GM allows otherwise. | MVP      |
| FR-ENT-02 | Actors have a name, image URL, and ownership (default level plus per-user levels).                                                                                        | MVP      |
| FR-ENT-03 | Ownership levels: `none`, `observer` (read), `owner` (read and edit). GMs are implicit owners of all actors.                                                              | MVP      |
| FR-ENT-04 | Actors can be duplicated, deleted (soft delete with restore for 30 days), and listed with search and type filters.                                                        | MVP      |
| FR-ENT-05 | Items exist in a table-level library. Items can be copied into an actor, creating an owned item with a `sourceId`.                                                        | MVP      |
| FR-ENT-06 | Items have a name, image URL, and plugin-defined data, edited on an item sheet.                                                                                           | MVP      |
| FR-ENT-07 | Entity changes emit events so other clients refresh lists and sheet headers.                                                                                              | MVP      |
| FR-ENT-08 | An actor's data is stored as a CRDT document (see §9). Its SQL projection is updated on persist.                                                                          | MVP      |
| FR-ENT-09 | Deleting an actor removes its live document from active sessions and retains a snapshot for the restore window.                                                           | MVP      |

### 7.4 Live sheets (`FR-SHEET`)

| ID          | Requirement                                                                                                                                                                                 | Priority |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-SHEET-01 | Opening a sheet connects to a Yjs document; all users with access see changes within 500 ms on a LAN.                                                                                       | MVP      |
| FR-SHEET-02 | Each field shows the presence of other users editing it (colored outline and name badge).                                                                                                   | MVP      |
| FR-SHEET-03 | Users with `observer` access see the sheet read-only; the UI shows a banner.                                                                                                                | MVP      |
| FR-SHEET-04 | Secret layer fields (declared in the plugin with `"x-layer": "secret"`) are only sent to GMs and assistants. The server omits them from observer and player sessions, not just from the UI. | MVP      |
| FR-SHEET-05 | Derived values update live for all viewers without being stored.                                                                                                                            | MVP      |
| FR-SHEET-06 | Collections (lists) support add, remove, and reorder; reorder must not duplicate or lose rows under concurrent edits.                                                                       | MVP      |
| FR-SHEET-07 | Long text fields (notes, biography) support collaborative editing.                                                                                                                          | MVP      |
| FR-SHEET-08 | Counter fields support server-applied deltas (`adjust`) so concurrent "−3 HP" actions are not overwritten.                                                                                  | MVP      |
| FR-SHEET-09 | Field-level validation runs on input and again on the server before persist. Invalid values are rejected or clamped per the field's rule and reported to the editor.                        | MVP      |
| FR-SHEET-10 | Sheets render on phone-width viewports (≥ 360 px) with no horizontal page scroll.                                                                                                           | MVP      |
| FR-SHEET-11 | Sheet history: the last 50 snapshots per actor are retained for recovery.                                                                                                                   | v1       |

### 7.5 Chat and rolls (`FR-CHAT`)

| ID         | Requirement                                                                                                                                                        | Priority |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| FR-CHAT-01 | Table chat supports text messages with speaker selection (user, or one of their actors).                                                                           | MVP      |
| FR-CHAT-02 | Messages have `audience`: `public`, `whisper` (selected recipients), or `gm` (GM and assistants only). Audience is enforced by the server on delivery and history. | MVP      |
| FR-CHAT-03 | Roll messages are created only by the server from a roll recipe or a formula typed by a user.                                                                      | MVP      |
| FR-CHAT-04 | Rolls are computed with a cryptographically secure RNG and the full die results are stored in the message.                                                         | MVP      |
| FR-CHAT-05 | Secret rolls (`audience: gm`) hide results from players; the sender still sees their own result.                                                                   | MVP      |
| FR-CHAT-06 | Card messages render through a plugin-defined template. If the template is missing (plugin disabled), the message falls back to plain text.                        | MVP      |
| FR-CHAT-07 | Chat history loads in pages of 50 with infinite scroll.                                                                                                            | MVP      |
| FR-CHAT-08 | Users can type dice formulas directly (`/r 2d6+3`, `/gmr 1d20`). Supported only for system-agnostic dice grammar; plugin commands are v1.                          | MVP      |
| FR-CHAT-09 | Messages can be edited or deleted by their author within 5 minutes; GMs can delete any message.                                                                    | v1       |

### 7.6 Journal (`FR-JOURNAL`)

| ID            | Requirement                                                                                  | Priority |
| ------------- | -------------------------------------------------------------------------------------------- | -------- |
| FR-JOURNAL-01 | GMs and assistants create journal entries with a title and a rich-text body (collaborative). | MVP      |
| FR-JOURNAL-02 | Journal entries have ownership like actors. Default is `observer` for players.               | MVP      |
| FR-JOURNAL-03 | Entries can be hidden, then revealed by the GM. Hidden entries are never sent to players.    | MVP      |
| FR-JOURNAL-04 | Rich text supports headings, lists, bold, italic, links, and inline images from URLs.        | MVP      |

### 7.7 Dice engine (`FR-DICE`)

| ID         | Requirement                                                                                                                                                      | Priority |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-DICE-01 | The core grammar supports: `NdS`, `+`, `-`, `*`, `/`, parentheses, `kh`/`kl`/`dh`/`dl` (keep/drop), `!` (explode), `r` (reroll), and `cs`/`cf` success counting. | MVP      |
| FR-DICE-02 | Dice expressions support `@` references to actor data, evaluated by the server.                                                                                  | MVP      |
| FR-DICE-03 | Plugins can declare custom dice by faces, labels, and optional result mapping (for example Fate `dF`).                                                           | MVP      |
| FR-DICE-04 | Roll results list every die and the final total. Results include the expression and the resolved references.                                                     | MVP      |
| FR-DICE-05 | The engine is deterministic when given a seeded RNG (for tests and replay).                                                                                      | MVP      |

### 7.8 Plugins (`FR-PLUGIN`)

| ID           | Requirement                                                                                                                | Priority |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-PLUGIN-01 | Plugins are folders placed in `DATA_DIR/plugins/`. A restart or admin "rescan" makes them available. No rebuild is needed. | MVP      |
| FR-PLUGIN-02 | Plugin manifests and all JSON files are validated against the plugin schemas. Errors are reported with file and JSON path. | MVP      |
| FR-PLUGIN-03 | Plugins declare `coreApi` as a semver range. Incompatible plugins are listed as disabled with the reason.                  | MVP      |
| FR-PLUGIN-04 | Plugin CSS is scoped by the loader (see §8.6).                                                                             | MVP      |
| FR-PLUGIN-05 | Plugin language files (`lang/*.json`) are merged into the UI, with fallback to English.                                    | MVP      |
| FR-PLUGIN-06 | Plugins containing a `code/` folder are flagged as "includes code" in the admin UI. Admins must enable them explicitly.    | MVP      |
| FR-PLUGIN-07 | A plugin can be enabled or disabled per instance by an admin. Tables using a disabled plugin become read-only.             | MVP      |
| FR-PLUGIN-08 | Plugin-owned code (`code/`) runs in-process and is trusted in v1. Sandboxing is out of scope for v1.                       | MVP      |
| FR-PLUGIN-09 | Plugin compendium packs (`packs/*.json`) can be imported into a table library.                                             | v1       |
| FR-PLUGIN-10 | Plugins can declare slash commands and chat handlers in `code/`.                                                           | v1       |

### 7.9 Combat (`FR-COMBAT`) — v1

| ID           | Requirement                                                                                                                      | Priority |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-COMBAT-01 | GM creates an encounter, adds combatants (actors or free-form entries), and runs initiative.                                     | v1       |
| FR-COMBAT-02 | Initiative is rolled using the plugin's `combat.json` formula, with ordering rule `desc`, `asc`, or `sideBased`, or a code hook. | v1       |
| FR-COMBAT-03 | Turn advance and round counter are broadcast to all members.                                                                     | v1       |
| FR-COMBAT-04 | Combatant visibility respects actor ownership and hidden status.                                                                 | v1       |

### 7.10 Settings and administration (`FR-ADMIN`)

| ID          | Requirement                                                                                                                       | Priority                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| FR-ADMIN-01 | Instance settings: site name, registration policy (closed, invite-only), session lifetime, upload limits.                         | MVP                        |
| FR-ADMIN-02 | Plugin admin page: list, enable, disable, rescan, view validation errors.                                                         | MVP                        |
| FR-ADMIN-03 | Health endpoint `/api/health` reports DB status and plugin load status.                                                           | MVP                        |
| FR-ADMIN-04 | Table settings page: name, description, house-rule options from the plugin's `settings.json`.                                     | MVP                        |
| FR-ADMIN-05 | Backups: documented procedure to copy `vtt.sqlite` and `plugins/` safely (WAL checkpoint). Optional scheduled backup via env var. | MVP (doc) / v1 (automated) |

### 7.11 Maps and assets — LATER

Out of scope for MVP and v1. Captured here so the data model stays compatible:

- `img` fields are plain URL strings; no asset table yet.
- A `scenes` table and token placement are added later; no MVP schema depends on them.

---

## 8. Plugin System

### 8.1 Principles

- **JSON declares, code is referenced by name.** Layout nodes and rolls reference custom behaviour as `custom:<name>` or `handler: "<name>"`. Code cannot define structure on its own.
- **One formula language** is used for derived values, roll formulas, `visibleIf` conditions, and validation.
- **Schemas are JSON Schema** (a documented subset plus `x-` annotations), so editors validate plugin files with `$schema`.
- **Declarative covers most systems.** The v1 reference systems must be buildable with no code.

### 8.2 Plugin folder layout

```
my-system/
├─ plugin.json              manifest (required)
├─ types/
│  ├─ actors/<type>.json    actor type: schema, defaults, derived, sheet, controlledBy
│  └─ items/<type>.json     item type: schema, defaults, derived, sheet
├─ sheets/<name>.json       layout trees (referenced by types)
├─ rolls.json               roll recipes and outcomes (optional)
├─ dice.json                custom dice (optional)
├─ combat.json              initiative formula and ordering (v1, optional)
├─ settings.json            per-table options (optional)
├─ cards/<name>.json        chat card templates (optional)
├─ lang/<locale>.json       translations, English required if any lang file exists
├─ styles/<name>.css        scoped CSS (optional)
├─ packs/<name>.json        compendium packs (v1, optional)
└─ code/                    optional custom behaviour
   ├─ shared.ts             pure functions usable in formulas (runs on client and server)
   ├─ client.tsx            custom layout nodes and card renderers
   └─ server.ts             roll handlers, lifecycle hooks (v1)
```

Code entries are TypeScript sources in the plugin folder for development, but the plugin CLI (`vtt-plugin pack`) **compiles them to ES modules** (`code/*.js`, plus `.d.ts` for authors) and the packed plugin is what the server loads. The server never compiles TypeScript at runtime.

### 8.3 Manifest (`plugin.json`)

```json
{
  "$schema": "https://<host>/schemas/plugin.schema.json",
  "id": "tiny-d20",
  "name": "Tiny D20",
  "version": "1.0.0",
  "kind": "system",
  "coreApi": "^0.1.0",
  "author": "…",
  "license": "MIT",
  "hasCode": false,
  "locales": ["en", "pt-BR"],
  "defaultLocale": "en"
}
```

Rules:

- `id`: lowercase kebab-case, unique on the instance, immutable once tables exist.
- `kind`: `system` in v1. `module` reserved for future non-system plugins.
- `hasCode` must match the presence of `code/`. The validator checks this.

### 8.4 Actor and item types

```json
{
  "$schema": "…/actor-type.schema.json",
  "label": "type.character",
  "controlledBy": "player",
  "sheet": "character",
  "schema": {
    "type": "object",
    "properties": {
      "str": { "type": "integer", "default": 10, "minimum": 1, "maximum": 30 },
      "hp": {
        "type": "object",
        "properties": {
          "value": { "type": "integer", "default": 10, "x-counter": true },
          "max": { "type": "integer", "default": 10 }
        }
      },
      "skills": {
        "type": "array",
        "x-kind": "collection",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "rank": { "type": "integer", "default": 0 }
          }
        }
      },
      "notes": { "type": "string", "x-kind": "longText" },
      "gmNotes": { "type": "string", "x-kind": "longText", "x-layer": "secret" }
    }
  },
  "derived": {
    "strMod": "floor((@str - 10) / 2)"
  }
}
```

Rules for the schema subset:

- Supported keywords: `type` (string, integer, number, boolean, object, array), `properties`, `items`, `default`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `required`, `description`.
- Unsupported keywords (`$ref`, `allOf`, `oneOf`, `anyOf`, `not`, `patternProperties`, `if`/`then`) are rejected by the validator with a clear message. Composition is added in a later `coreApi` version.
- `x-kind` values: `longText` (Yjs `Y.Text`), `collection` (id-keyed map, see §9.4), `richText` (journal only), `image` (URL string with preview).
- `x-counter: true` marks a number as adjustable with `adjust` deltas.
- `x-layer: "secret"` moves the field to the secret layer (GM and assistant only).
- `derived` maps names to formulas. Derived values are never stored.

### 8.5 Sheets (layout JSON)

A sheet is a tree of nodes. Each node has `type`, optional `class`, optional `visibleIf`, and type-specific props.

| Node            | Props                                                                        | Notes                                                 |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| `row`           | `children`, `gap`, `wrap`                                                    | Horizontal flex                                       |
| `column`        | `children`, `gap`                                                            | Vertical flex                                         |
| `grid`          | `children`, `columns`                                                        | CSS grid with `columns` count                         |
| `tabs`          | `tabs: [{ label, children }]`                                                | Label is a lang key                                   |
| `section`       | `title`, `children`, `collapsible`                                           | Titled group                                          |
| `field`         | `path`, `label`, `input` (`text`, `number`, `checkbox`, `select`, `counter`) | Core renders with presence and validation             |
| `longText`      | `path`, `label`                                                              | Collaborative rich text editor for `x-kind: longText` |
| `list`          | `path`, `item` (child layout), `addLabel`                                    | Renders a collection with add, remove, reorder        |
| `rollButton`    | `roll`, `args`, `label`                                                      | Triggers a roll recipe on the server                  |
| `derived`       | `key`, `format`                                                              | Displays a derived value                              |
| `image`         | `path`, `size`                                                               | Shows portrait/image                                  |
| `text`          | `text` (lang key or literal)                                                 | Static text                                           |
| `custom:<name>` | `props`                                                                      | Calls a custom node from `code/client.tsx`            |

Field `path` uses dot notation for objects. Inside `list`, `path` is relative to the row, and `@row.id` is available in `args`.

`visibleIf` uses the formula language and can reference `@derived.*`, `@str`, etc. Hidden secret fields are never sent to unauthorised users regardless of `visibleIf`.

### 8.6 Scoped CSS

Processed by the plugin loader using PostCSS at load time (and cached on disk):

- Every selector is prefixed with `[data-plugin="<id>"]`. `:root` is rewritten to that scope, so `--vtt-*` tokens can be overridden locally.
- All rules are placed in `@layer plugin`, so core styles win predictably unless a plugin intentionally uses higher-specificity selectors within its layer.
- `@keyframes` names are prefixed with the plugin id.
- `@import` and external `url()` are removed. `@font-face` may only reference files inside the plugin folder.
- Each sheet root gets `contain: layout paint` so it cannot escape its container.
- Forbidden properties or selectors (`position: fixed` on `html`/`body`, `:root` changes to `z-index` on app chrome, `@page`) are stripped with a validation warning.
- The loader rejects CSS files larger than 256 KB.

```css
/* styles/sheet.css */
:root {
  --vtt-accent: #8a2be2;
}
.vitals {
  display: flex;
  gap: 0.5rem;
}
.vitals [data-field='hp.value'] input {
  font-size: 1.5rem;
}
```

### 8.7 Rolls

`rolls.json` maps names to recipes:

```json
{
  "skill": {
    "label": "roll.skill",
    "formula": "1d20 + @derived.strMod + @skills[@args.id].rank",
    "outcomes": [
      { "when": "@total >= 15", "label": "outcome.success", "class": "ok" },
      { "label": "outcome.failure", "class": "fail" }
    ],
    "card": "skill"
  },
  "attack": { "handler": "attack" }
}
```

- `formula` uses the dice grammar and `@` references. It is evaluated on the server against the actor's current state.
- `outcomes` are evaluated in order; the first matching `when` wins; a missing `when` is a fallback.
- `card` references `cards/<name>.json`.
- `handler` references an exported function in `code/server.ts`. It receives a restricted context (see §8.10).

### 8.8 Custom dice

`dice.json`:

```json
{
  "dF": {
    "faces": ["-", "-", " ", " ", "+", "+"],
    "label": "dice.fate"
  }
}
```

Custom dice are used in formulas as `dF`, and the result is the face value. Count-based pools use the core `cs` operator. Result mapping for display is defined in `cards`.

### 8.9 Formula language

**Grammar (summary):**

- Literals: integers, decimals, strings (`'…'`), booleans (`true`, `false`).
- References: `@name`, `@derived.name`, `@args.key`, `@row.key`, `@name.sub.field`, `@collection[@args.id].field`, `@collection[*].field` (aggregate).
- Operators: `+ - * / %`, comparisons (`< <= > >= == !=`), logical (`and or not`), ternary (`cond ? a : b`).
- Functions (fixed whitelist): `floor`, `ceil`, `round`, `min`, `max`, `abs`, `sum`, `count`, `if`, `clamp`, plus any `shared` functions a plugin declares in `code/shared.ts`.
- Dice terms: `NdS`, `NdS!`, `NdSr<v`, `NdSkh<k>`, `NdSkl<k>`, `NdSdh<k>`, `NdSdl<k>`, `NdScs>=<v>`, `NdScf<=<v>`, custom dice names.

**Evaluation:**

- Parsed to an AST with a hand-written or generated (Chevrotain/Peggy) parser. Never `eval`, never `new Function`.
- Two evaluation modes: **pure** (no dice, used for derived values and conditions, runs on both sides) and **rolling** (dice allowed, server only, requires an injected RNG).
- Type checking happens at plugin validation time where possible; runtime errors produce a readable message with the source location.
- Evaluation has a step limit (default 10,000 nodes) to prevent runaway work.

### 8.10 Code entries

```ts
// code/shared.ts
export default defineShared({
  functions: {
    carryCapacity: (str: number): number => str * 15,
  },
});

// code/client.tsx
export default defineClient({
  nodes: {
    hpBar: HpBar, // React component receiving { value, max, path }
  },
  cards: {
    skill: SkillCard,
  },
});

// code/server.ts
export default defineServer({
  handlers: {
    attack: async ({ ctx, actor, args }) => {
      const hit = await ctx.roll('1d20 + @derived.strMod', { actor });
      await ctx.chat.post({ rolls: [hit], text: `${actor.name} attacks` });
    },
  },
  hooks: {
    onTurnStart: async ({ ctx, combatant }) => {
      /* … */
    },
  },
});
```

Rules:

- Server code receives a restricted `ctx` with: `roll`, `chat.post`, `actors.get`, `actors.adjust` (validated writes only), `log`. It has no database handle and no filesystem access.
- Client code receives only `@vtt/sdk/client` hooks (`useField`, `useDerived`, `useActor`). It cannot open sockets or call arbitrary APIs.
- Shared code is pure and must pass the same lint boundaries as `packages/formula`.
- Custom nodes must be pure rendering: they read via hooks and write via `useField` setters.
- **Trust model (v1):** `code/` is trusted. Installing a plugin with code requires explicit admin enablement. The admin UI lists the code entry points.

### 8.11 Chat cards

`cards/skill.json`:

```json
{
  "title": "card.skill.title",
  "rows": [
    { "label": "card.roll", "value": "@roll.expression" },
    { "label": "card.total", "value": "@total", "class": "total" }
  ],
  "outcome": true
}
```

Cards are rendered by the core from JSON; custom card components in `code/client.tsx` override them by name.

### 8.12 Settings

`settings.json` defines per-table options rendered by the core as a form:

```json
{
  "critFumble": {
    "type": "boolean",
    "default": true,
    "label": "setting.critFumble"
  },
  "startingHp": {
    "type": "integer",
    "default": 10,
    "minimum": 1,
    "label": "setting.startingHp"
  }
}
```

Values are stored on the table and passed to the plugin engine through the rules context.

### 8.13 Plugin validation and CLI

`vtt-plugin` (from `packages/plugin-cli`):

- `vtt-plugin validate <dir>`: checks manifest, all JSON files against plugin schemas, formula syntax and references (`@` paths exist in the schema), CSS rules, lang key coverage, and `hasCode` consistency. Exits non-zero on errors.
- `vtt-plugin dev <dir>`: starts a local preview server that renders the plugin's sheets with an in-memory store and sample data, with hot reload.
- `vtt-plugin pack <dir>`: compiles `code/` to ES modules, minifies CSS, writes a `.vttplugin` archive (zip).
- `vtt-plugin schema`: emits the JSON Schemas used by editors.

The server runs the same validation on install and on rescan.

---

## 9. Live Document Model (CRDT)

### 9.1 Document naming

Every collaborative document is named `<kind>:<id>:<layer>`:

- `actor:<id>:main` — main sheet data
- `actor:<id>:secret` — GM/assistant-only data (only if the plugin declares secret fields)
- `journal:<id>:main` — journal entry body
- `ydocs` table holds binary state, keyed by name.

Parsing the name is the only way the auth hook derives the entity and layer; the name is never trusted for anything beyond routing.

### 9.2 Document structure

```
actor:<id>:main
 ├─ data   Y.Map   schema fields: scalars/objects → nested Y.Map; x-kind longText → Y.Text;
 │                 collection → Y.Map keyed by row id; each row has a `sort` value
 └─ items  Y.Map   owned items keyed by id: { type, name, sourceId, sort, data… }
```

### 9.3 Access rules (server-enforced)

| Document                   | none   | observer  | owner      | assistant  | gm         |
| -------------------------- | ------ | --------- | ---------- | ---------- | ---------- |
| `actor:*:main`             | reject | read-only | read/write | read/write | read/write |
| `actor:*:secret`           | reject | reject    | reject     | read/write | read/write |
| `journal:*:main` (visible) | reject | read-only | read/write | read/write | read/write |
| `journal:*:main` (hidden)  | reject | reject    | reject     | read/write | read/write |

Notes:

- The server re-checks permissions on every incoming update, not only on connect.
- Secret layer state is never broadcast to clients without access. Hocuspocus is configured so that unauthorised connections never receive the document.
- Ownership changes take effect immediately: connected clients whose access drops are disconnected from the document.

### 9.4 Collections

- Collections are **id-keyed maps**, never `Y.Array`, so concurrent reorder and insert cannot duplicate rows.
- Each row has a `sort` value (fractional index string). Reorder updates one row's `sort`.
- Authors never see this: the schema uses arrays, and the renderer and SDK map them to keyed rows.

### 9.5 Counters

- Fields with `x-counter` are updated with `adjust(path, delta)`. The server applies deltas in a transaction on its copy of the doc and broadcasts the result.
- Plain `set` is still allowed for explicit values (for example editing max HP).

### 9.6 Persistence

- Hocuspocus `onStoreDocument` is debounced (default 2 s, max wait 10 s).
- Each store writes the full binary state to `ydocs` and refreshes the `system` JSON projection in the same transaction.
- The projection is what listings, the combat tracker, and search read. Rolls read the live document, not the projection, to avoid stale values.
- Documents are unloaded from memory after 60 s with no connections, after storing.

### 9.7 Validation and repair

- Values written by clients are validated against the schema on input (client) and on persist (server).
- Invalid values on persist are replaced with the schema default and logged. The editor receives a validation event.
- Schema changes on a plugin version bump are **not** auto-migrated in MVP. Actors store their `dataVersion`, and mismatched actors show a warning; migrations are LATER (see §7.11).

---

## 10. API and Realtime Contracts

### 10.1 REST

- Base path `/api/v1`. JSON bodies. Validated with Zod on entry.
- Errors use `{ error: { code, message, details? } }` with stable `code` strings.
- Pagination with cursor tokens: `?cursor=…&limit=…`.
- Auth: session cookie. Mutating requests require a CSRF header (`X-CSRF-Token`) matched to the session.

Key resource groups:

| Group           | Endpoints (illustrative)                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Auth            | `POST /auth/login`, `POST /auth/logout`, `GET /me`, `POST /me/password`                                                      |
| Setup           | `GET /setup/status`, `POST /setup/admin`                                                                                     |
| Users (admin)   | `GET /users`, `POST /users`, `PATCH /users/:id`                                                                              |
| Tables          | `GET /tables`, `POST /tables`, `GET /tables/:id`, `PATCH /tables/:id`, `GET /tables/:id/types`                               |
| Members         | `GET /tables/:id/members`, `PATCH /tables/:id/members/:userId`, `DELETE …`                                                   |
| Invites         | `POST /tables/:id/invites`, `POST /invites/:token/accept`                                                                    |
| Actors          | `GET /tables/:id/actors`, `POST …`, `GET/PATCH/DELETE /actors/:id`, `POST /actors/:id/duplicate`, `POST /actors/:id/restore` |
| Items           | `GET /tables/:id/items`, `POST …`, `GET/PATCH/DELETE /items/:id`, `GET/POST /actors/:id/items`, `POST /items/:id/restore`    |
| Journal         | `GET /tables/:id/journal`, `POST …`, `GET/PATCH/DELETE /journal/:id`                                                         |
| Chat            | `GET /tables/:id/messages?before=…`, `POST /tables/:id/messages`                                                             |
| Rolls           | `POST /tables/:id/rolls` (formula; roll recipes with T-0407, ADR-018)                                                        |
| Plugins (admin) | `GET /plugins`, `POST /plugins/:id/enable`, `POST /plugins/:id/disable`, `POST /plugins/rescan` (ADR-020)                    |
| Health          | `GET /api/health`                                                                                                            |

### 10.2 Events WebSocket (`/ws/events`)

- Authenticated during the HTTP upgrade using the session cookie.
- JSON messages in an envelope: `{ "v": 1, "type": "…", "tableId": "…", "payload": { … }, "id": "…" }`.
- Client → server: `subscribe`, `unsubscribe`, `chat.send`, `roll.request`, `presence.ping`.
- Server → client: `chat.message` (rolls are messages of kind `roll`, ADR-018), `entity.changed`, `member.changed`, `plugin.changed`, `combat.updated`, `ack`, `error`. A client message with an `id` is answered by `ack` or `error` carrying `replyTo` (ADR-016).
- A socket whose session ends is closed with code `4401`.
- **Audience filtering happens on the server** before send: whispers go only to recipients and sender; `gm` audience only to GM and assistants.
- Protocol version is `v`. The server rejects unknown versions with an error that includes the supported versions.
- Heartbeat every 25 s; clients reconnect with exponential backoff and resubscribe. Missed events are recovered by fetching history from REST.

### 10.3 Collaboration WebSocket (`/ws/collab`)

- Hocuspocus protocol. Auth token is the session cookie validated in `onAuthenticate`.
- The document name is parsed and checked against membership and ownership before any sync message is accepted.

---

## 11. Non-Functional Requirements

| ID     | Category        | Requirement                                                                                                             |
| ------ | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| NFR-01 | Self-hosting    | A fresh instance starts with one `docker run` or `docker compose up`, with a single volume.                             |
| NFR-02 | Backup          | A consistent backup can be taken while the server runs, using the documented SQLite backup command.                     |
| NFR-03 | Performance     | Event round-trip on LAN < 150 ms p95. Sheet edit propagation < 500 ms p95.                                              |
| NFR-04 | Scale           | Supports 20 concurrent tables, 10 users per table, and 200 open sheets on a 1 vCPU / 1 GB instance.                     |
| NFR-05 | Security        | Argon2id passwords, CSRF protection, rate-limited login, secure cookies, CSP headers, no secrets in client bundles.     |
| NFR-06 | Security        | Dice are generated on the server with `crypto.randomInt` or an equivalent CSPRNG.                                       |
| NFR-07 | Security        | Plugin JSON, CSS, and formulas are validated; formulas are never evaluated as code.                                     |
| NFR-08 | Privacy         | Secret layer and GM-only chat never leave the server for unauthorised users, verified by e2e tests on the wire.         |
| NFR-09 | Reliability     | Document state is persisted at most 10 s after the last change; a crash loses at most that window.                      |
| NFR-10 | Accessibility   | WCAG 2.1 AA for core UI: keyboard navigation of sheets, labelled inputs, sufficient contrast, reduced-motion respected. |
| NFR-11 | i18n            | All core UI strings come from message catalogues. Default `en`; `pt-BR` provided. Plugin strings merged with fallback.  |
| NFR-12 | Observability   | Structured JSON logs; health endpoint; request IDs propagated to logs.                                                  |
| NFR-13 | Browser support | Latest two versions of Chrome, Firefox, Safari, and Edge; iOS Safari 16+; Android Chrome.                               |
| NFR-14 | Code quality    | TypeScript strict; zero lint warnings; test coverage ≥ 80% on `formula`, `plugin-engine`, and permission logic.         |
| NFR-15 | Licensing       | Dependencies must be compatible with the project licence; a `THIRD_PARTY.md` is generated in CI.                        |

---

## 12. Milestones and Tasks

Tasks are written so an agent can pick one up without extra context. Each task has an ID, dependencies, acceptance criteria, and the requirement IDs it satisfies. Mark status in §0 when you start and finish a task.

**Task format:**

- `ID` · `Title`
- **Deps:** tasks that must be `[x]` first
- **Do:** what to build
- **Done when:** objective acceptance criteria

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

- [ ] **T-0407 · Plugin engine**
  - **Deps:** T-0402, T-0302
  - **Do:** `packages/plugin-engine`: defaults from schema, derived value computation, roll recipe execution (outcomes), card resolution, actor-to-Yjs schema mapping (no Yjs dependency in this package; mapping produces a plain description).
  - **Done when:** unit tests cover derived values, outcomes ordering, and missing-card fallback (FR-CHAT-06).

- [ ] **T-0408 · Sheet renderer (layout to React)**
  - **Deps:** T-0401, T-0407, T-0111
  - **Do:** `packages/sheet-renderer` with built-in nodes from §8.5, `visibleIf` evaluation, `SheetStore` interface, `data-field` attributes, phone-responsive layout (FR-SHEET-10).
  - **Done when:** renderer snapshot tests for every node type; preview page renders `tiny-d20` sheet against a mock store.

- [ ] **T-0409 · Plugin host in web app**
  - **Deps:** T-0405, T-0408
  - **Do:** `apps/web/src/plugin-host`: fetch plugin manifests, load `code/client.js` via dynamic import with a shared React import map, inject scoped CSS, merge lang files, mount sheets and card renderers.
  - **Done when:** a plugin with a custom node renders it in the app; uninstalling the plugin degrades gracefully (table read-only message).

- [ ] **T-0410 · Plugin CLI**
  - **Deps:** T-0402, T-0404, T-0408
  - **Do:** `packages/plugin-cli` with `validate`, `dev` (preview server), `pack`, `schema` commands (§8.13).
  - **Done when:** `vtt-plugin validate plugins/tiny-d20` passes; `pack` produces an archive the server can install.

- [ ] **T-0411 · Reference plugin: tiny-d20**
  - **Deps:** T-0410
  - **Do:** Build a d20 system: character and NPC types, skills collection, HP counter, a secret GM note, a skill roll recipe with outcomes, one custom node (`hpBar`), scoped CSS, pt-BR and en lang files.
  - **Done when:** every feature in §8 that the plugin uses is exercised by an e2e test.

- [ ] **T-0412 · Reference plugin: tiny-pool**
  - **Deps:** T-0410
  - **Do:** Dice-pool system: custom die `dF`, success-count rolls, no code folder at all.
  - **Done when:** the plugin works with `hasCode: false` and all sheets render.

### M5 — Live sheets (CRDT)

- [ ] **T-0501 · Hocuspocus server integration**
  - **Deps:** T-0203, T-0102
  - **Do:** Mount Hocuspocus on `/ws/collab`. Implement `onAuthenticate` with session validation, document name parsing, and access checks (§9.3). Log denials.
  - **Done when:** unauthorised connections are rejected in tests; observers cannot send updates (tested).

- [ ] **T-0502 · Document persistence**
  - **Deps:** T-0501
  - **Do:** `onLoadDocument` and `onStoreDocument` with the `ydocs` table, debounced store, projection refresh in one transaction (§9.6).
  - **Done when:** restart the server and reload a sheet with identical state; projection matches state.

- [ ] **T-0503 · Secret layer isolation**
  - **Deps:** T-0501
  - **Do:** Separate `actor:<id>:secret` documents; ensure they are never sent to unauthorised sockets (NFR-08).
  - **Done when:** a wire-level test with a player socket confirms no secret bytes are received.

- [ ] **T-0504 · Schema-to-Yjs mapping**
  - **Deps:** T-0407, T-0502
  - **Do:** Implement mapping in `packages/plugin-engine` as a pure description; server and client use it to create and read documents (`x-kind` handling, collections keyed by id, `sort` keys).
  - **Done when:** round-trip tests: JSON → Yjs → JSON for every `x-kind`.

- [ ] **T-0505 · Server-side validation and adjust**
  - **Deps:** T-0504
  - **Do:** On persist, validate and repair invalid values (FR-SHEET-09). Implement `adjust(path, delta)` applied in a transaction (FR-SHEET-08).
  - **Done when:** concurrent `adjust(-3)` from two clients yields a net −6.

- [ ] **T-0506 · Sheet store and binding in web app**
  - **Deps:** T-0504, T-0408
  - **Do:** `apps/web/src/collab` implements `SheetStore` over Yjs; `field`, `list`, `longText` nodes bind to it; read-only mode for observers (FR-SHEET-03).
  - **Done when:** two browsers edit one sheet and see each other's changes within 500 ms (e2e).

- [ ] **T-0507 · Presence and awareness**
  - **Deps:** T-0506
  - **Do:** Yjs awareness for focused fields; colored outline and name badge (FR-SHEET-02).
  - **Done when:** e2e confirms the badge appears on the other client within 1 s of focus.

- [ ] **T-0508 · Collection reorder under concurrency**
  - **Deps:** T-0506
  - **Do:** `sort` fractional index updates for reorder; add/remove via keyed map (FR-SHEET-06).
  - **Done when:** concurrent add and reorder from two clients produce no duplicates and no lost rows (property test with two Y.Doc instances).

- [ ] **T-0509 · Derived values live**
  - **Deps:** T-0506, T-0302
  - **Do:** Derived fields recompute on every change in both clients and on the server for rolls (FR-SHEET-05).
  - **Done when:** changing `str` updates `strMod` in a second browser without refresh.

- [ ] **T-0510 · Long text collaboration**
  - **Deps:** T-0506
  - **Do:** Editor bound to `Y.Text` for `longText` fields and journal bodies (FR-SHEET-07, FR-JOURNAL-01, 04). Use TipTap with the Collaboration extension, or a minimal editor if TipTap is deferred.
  - **Done when:** two clients type simultaneously into one note without loss.

- [ ] **T-0511 · Phone layout for sheets**
  - **Deps:** T-0506
  - **Do:** Sheet windows become full-screen routes below 768 px with bottom bar (Chat / Sheet / Dice) (FR-SHEET-10, NFR-10).
  - **Done when:** Playwright mobile viewport test passes with no horizontal scroll.

- [ ] **T-0512 · Document access revocation**
  - **Deps:** T-0501, T-0110
  - **Do:** When membership or ownership changes, disconnect affected sockets from documents (§9.3).
  - **Done when:** a removed member's open sheet becomes inaccessible within 2 s (e2e).

### M6 — Journal, members, settings, administration

- [ ] **T-0601 · Journal entries (SQL + collab)**
  - **Deps:** T-0510, T-0201
  - **Do:** Create, list, hide/reveal, ownership for journal entries (FR-JOURNAL-01..03).
  - **Done when:** a hidden entry is absent from player-visible list and document access (tested on the wire).

- [ ] **T-0602 · Members and invites UI**
  - **Deps:** T-0109, T-0111
  - **Do:** Table members page, role change, invite link generation and revocation.
  - **Done when:** FR-TABLE-03, 04 have e2e coverage.

- [ ] **T-0603 · Table settings**
  - **Deps:** T-0407, T-0111
  - **Do:** Render plugin `settings.json` as form; store values on table; pass to plugin engine (FR-ADMIN-04).
  - **Done when:** changing a house rule changes a derived value in a roll.

- [ ] **T-0604 · Instance settings and health**
  - **Deps:** T-0102
  - **Do:** Instance settings page (FR-ADMIN-01) and `/api/health` (FR-ADMIN-03).
  - **Done when:** health reports DB and plugin status; a broken DB reports unhealthy.

- [ ] **T-0605 · Backup procedure**
  - **Deps:** T-0102, T-0502
  - **Do:** Document and script consistent backup (`VACUUM INTO` or sqlite backup API) plus copying `plugins/` (FR-ADMIN-05 doc).
  - **Done when:** the script produces a restorable copy while the server is running (tested).

- [ ] **T-0606 · Localisation of core UI**
  - **Deps:** T-0111
  - **Do:** Message catalogues for `en` and `pt-BR`, with a lint rule or test that flags missing keys (NFR-11).
  - **Done when:** the test fails on a missing key in `pt-BR`.

### M7 — Reference plugins, hardening, and release

- [ ] **T-0701 · Security review pass**
  - **Deps:** all M1–M6
  - **Do:** Review CSRF, CSP headers, rate limits, formula sandboxing, audience leaks, path traversal. Record findings in `docs/security-review.md`.
  - **Done when:** all findings are fixed or have an accepted-risk note.

- [ ] **T-0702 · End-to-end suite**
  - **Deps:** T-0411, T-0412, T-0511, T-0512
  - **Do:** Playwright scenarios: two browsers editing one sheet; whispers; secret rolls; observer read-only; mobile sheet; plugin enable/disable; secret layer on the wire.
  - **Done when:** suite is green in CI on three browsers.

- [ ] **T-0703 · Docker image**
  - **Deps:** T-0009, T-0403
  - **Do:** Multi-stage Dockerfile (builder, runtime with non-root user), `docker-compose.example.yml` with one volume, healthcheck, and reverse proxy example (Caddy) with WebSocket forwarding.
  - **Done when:** `docker compose up` on a clean machine serves the app and a fresh instance completes setup.

- [ ] **T-0704 · Authoring guide and API docs**
  - **Deps:** T-0410, T-0411
  - **Do:** `docs/plugin-authoring.md` covering the full format, a "build your first plugin" tutorial, and generated schema reference.
  - **Done when:** a developer unfamiliar with the project can build a minimal plugin from the guide alone (verified by a reader test).

- [ ] **T-0705 · Release 0.1.0**
  - **Deps:** T-0701, T-0702, T-0703, T-0704
  - **Do:** Changelog, version bump, tag, Docker image published, release notes.
  - **Done when:** tag `v0.1.0` exists and CI publishes the image.

### V1 — Post-MVP

- [ ] **T-0801 · Combat tracker (rules, endpoints, UI)** — covers FR-COMBAT-01..04
- [ ] **T-0802 · Combat ordering and combat.json** — covers FR-COMBAT-02
- [ ] **T-0803 · Compendium packs import** — covers FR-PLUGIN-09
- [ ] **T-0804 · Plugin code hooks: slash commands and server hooks** — covers FR-PLUGIN-10
- [ ] **T-0805 · Chat message edit and delete** — covers FR-CHAT-09
- [ ] **T-0806 · Sheet history snapshots** — covers FR-SHEET-11
- [ ] **T-0807 · Table archive** — covers FR-TABLE-06
- [ ] **T-0808 · Automated backups** — covers FR-ADMIN-05 (automated part)

### LATER — Not scheduled

- Maps, scenes, tokens, fog of war (PixiJS)
- Asset manager and uploads
- Data migrations for plugin schema changes
- World export and import
- Plugin sandboxing (iframes and isolated runtime for `code/`)
- Declarative system builder UI
- Composition keywords (`$ref`, `oneOf`) in the schema subset

---

## 13. Testing Strategy

| Level       | Tool                      | Scope                                                                      | Gate                                           |
| ----------- | ------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| Unit        | Vitest                    | `formula`, `plugin-engine`, `shared` permissions, dice distributions       | ≥ 80% coverage on listed packages              |
| Property    | fast-check                | Formula evaluator safety, collection reorder under concurrency, CSS scoper | Runs in CI                                     |
| Integration | Vitest + Fastify `inject` | REST auth, ownership, audience filtering, plugin registry                  | Every endpoint has ≥ 1 allow and ≥ 1 deny test |
| Wire-level  | Vitest + ws client        | Secret and whisper leakage on `/ws/events` and `/ws/collab`                | Required for NFR-08                            |
| Component   | Vitest + Testing Library  | Sheet renderer nodes, plugin host                                          | Snapshot + behaviour                           |
| E2E         | Playwright                | Multi-user flows (§12 M7)                                                  | Green on Chrome, Firefox, WebKit               |
| Plugin      | `vtt-plugin validate`     | Every plugin in `plugins/`                                                 | Blocking in CI                                 |

Test data: seeded fixtures under `packages/*/test/fixtures`. Reference plugins are the canonical fixtures for `plugin-engine` and e2e.

---

## 14. Open Questions

Each question blocks specific tasks if unanswered. Record decisions in `docs/adr/` and update here.

| #   | Question                                                                            | Blocks                | Proposed default                                |
| --- | ----------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| Q1  | Accept "trusted code only" for plugins in v1, or require sandboxing before release? | T-0411+, FR-PLUGIN-08 | Trusted only; admin confirmation                |
| Q2  | Should GMs be allowed to change a table's plugin after creation?                    | FR-TABLE-02           | **Decided:** No (fixed); `PATCH` rejects it     |
| Q3  | TipTap for rich text, or a lighter editor?                                          | T-0510                | TipTap (Collaboration extension)                |
| Q4  | Email-based invites, or link-only?                                                  | T-0109                | **Decided:** Link-only (no SMTP dependency)     |
| Q5  | Is `tiny-pool` required for v0.1.0 or can it move to v1?                            | T-0412, T-0702        | Required, to validate the API                   |
| Q6  | Soft-delete retention window: 30 days fixed, or configurable?                       | FR-ENT-04             | **Decided:** Configurable, default 30 (ADR-014) |
| Q7  | Does Hocuspocus need its own port in development?                                   | T-0501                | No, same port via upgrade path                  |
| Q8  | Formula parser: hand-written Pratt or Peggy/Chevrotain?                             | T-0301                | **Decided:** Hand-written Pratt (ADR-017)       |
| Q9  | Required Node version: current LTS at the time of M0?                               | T-0001                | **Decided:** Node 24 LTS, pinned in `.nvmrc`    |

---

## 15. Risks

| Risk                                                | Likelihood                   | Impact | Mitigation                                                                                      |
| --------------------------------------------------- | ---------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Layout JSON becomes too limited for a real system   | Medium                       | High   | Build two reference systems in M4 before freezing the node set; `custom:` nodes as escape hatch |
| CRDT + permissions bugs leak secret data            | Medium                       | High   | Wire-level tests (NFR-08), server-side checks on every update, secret docs separate from main   |
| Trusted plugin code is a security hole              | High (if untrusted installs) | High   | Admin confirmation, documented trust model, sandboxing planned in LATER                         |
| SQLite write contention under many active tables    | Low                          | Medium | WAL mode, batched projection writes, single writer; revisit at scale                            |
| Formula language scope creep                        | High                         | Medium | Fixed function whitelist, change requires an ADR                                                |
| Type drift between Zod, JSON Schema, and TypeScript | Medium                       | Medium | Single Zod source, emitted schemas snapshot-tested                                              |
| Mobile sheet UX is cramped                          | Medium                       | Medium | Dedicated full-screen route under 768 px (T-0511), early phone testing                          |
| Yjs document growth over long campaigns             | Low                          | Medium | Periodic compaction on store; sheet history limited                                             |

---

## 16. Decision Log (ADR index)

| ADR     | Decision                                                                                                                                        | Status   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ADR-001 | Vite + React SPA instead of Next.js (realtime and runtime plugin loading)                                                                       | Accepted |
| ADR-002 | Fastify server with Hocuspocus for Yjs, separate `/ws/events` for JSON events                                                                   | Accepted |
| ADR-003 | SQLite + Drizzle, single data directory                                                                                                         | Accepted |
| ADR-004 | Plugins are JSON-first; code is opt-in and trusted in v1                                                                                        | Accepted |
| ADR-005 | TypeScript strict across all packages; ESLint flat config; Prettier                                                                             | Accepted |
| ADR-006 | Id-keyed maps for collections in CRDT documents                                                                                                 | Accepted |
| ADR-007 | Server-authoritative rolls; formulas never `eval`'d                                                                                             | Accepted |
| ADR-008 | [Pin TypeScript to 6.0.x until typescript-eslint supports 7](docs/adr/ADR-008-typescript-6-pin.md)                                              | Accepted |
| ADR-009 | [eslint-plugin-import-x instead of eslint-plugin-import (ESLint 10)](docs/adr/ADR-009-eslint-plugin-import-x.md)                                | Accepted |
| ADR-010 | [One root ESLint config instead of per-package configs](docs/adr/ADR-010-single-root-eslint-config.md)                                          | Accepted |
| ADR-011 | [M1 server decisions: plugins table, `TRUST_PROXY`, CSRF, last GM, permissions](docs/adr/ADR-011-m1-server-decisions.md)                        | Accepted |
| ADR-012 | [Tailwind CSS 4 for core UI styling](docs/adr/ADR-012-tailwind-css.md)                                                                          | Accepted |
| ADR-013 | [React Router framework mode (SPA), TanStack Form and a shared API contract](docs/adr/ADR-013-react-router-framework-mode-and-tanstack-form.md) | Accepted |
| ADR-014 | [Entity persistence: retention, owned items, ownership defaults](docs/adr/ADR-014-entity-persistence.md)                                        | Accepted |
| ADR-015 | [Actor and item REST API: type catalogue, ownership, trash, duplicate](docs/adr/ADR-015-actor-and-item-api.md)                                  | Accepted |
| ADR-016 | [Events socket and chat: replies, session checks, audiences, history order](docs/adr/ADR-016-events-socket-and-chat.md)                         | Accepted |
| ADR-017 | [Formula language: precedence, dice terms, custom dice names, errors, evaluation rules](docs/adr/ADR-017-formula-language.md)                   | Accepted |
| ADR-018 | [Rolls in chat: roll messages, audiences, actor data, errors](docs/adr/ADR-018-rolls-in-chat.md)                                                | Accepted |
| ADR-019 | [Plugin validation: one pure validator, issue codes, reference roots](docs/adr/ADR-019-plugin-validation.md)                                    | Accepted |
| ADR-020 | [Plugin registry: scanning, status, enabling, read-only tables](docs/adr/ADR-020-plugin-registry.md)                                            | Accepted |
| ADR-021 | [Scoped plugin CSS: scope, layer, at-rules, URLs, limits](docs/adr/ADR-021-scoped-plugin-css.md)                                                | Accepted |
| ADR-022 | [Plugin file serving: access, allowed files, scoped CSS, headers](docs/adr/ADR-022-plugin-file-serving.md)                                      | Accepted |

New decisions are appended here with a number, a one-line summary, and a link to the full ADR in `docs/adr/`.

---

## 17. Instructions for Agentic Contributors

If you are an AI coding agent working in this repository:

1. **Read §0 first.** Pick the next task in "Next task" or the first unchecked task whose dependencies are all `[x]`.
2. **Read the requirement IDs** the task references in §7 before coding. Do not implement behaviour that no requirement asks for.
3. **Respect the layer rules** in §4.4 and §6.2. If a rule blocks you, stop and record the conflict in §14 rather than working around it.
4. **Never add `any`, non-null assertions, `eval`, or `new Function`.** Validate external input with Zod.
5. **Keep plugin behaviour declarative.** Add code to a plugin only if the JSON format cannot express the need; if it can't, propose a format extension in an ADR first.
6. **Before marking a task done:** run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` for the affected packages, and the task's "Done when" criteria. Then update §0 (checkboxes, progress percentage, change log).
7. **Do not expand scope.** Items in LATER (§7.11 and §12) are out of scope unless a task explicitly includes them.
8. **Record decisions** that differ from this PRD in `docs/adr/` and in §16, in the same commit as the code change.
9. **Commit style:** conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`), referencing task IDs (for example `feat(formula): add dice keep modifiers (T-0303)`).
