# PRD: VTT (Virtual Tabletop) Platform

> **Status:** 0.1.0 released (2026-10-27); planning 0.2.0 · **Created:** 2026-10-19 · **Last updated:** 2026-10-27
> **Audience:** Human developers and agentic AI coding assistants. This file is the source of truth for scope, decisions, and progress. The MVP's task notes and change log are in [`docs/history/mvp.md`](docs/history/mvp.md).

---

## 0. Progress Tracker

Update this section every time a task changes state. Keep the checkboxes and the milestone table in sync.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (add a note)

### 0.1 Milestone overview

| ID    | Milestone                                                                                                                        | Release | Status      | Progress |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------- | -------- |
| M0–M7 | MVP: foundation, server, entities, formulas, plugins, live sheets, journal and admin, hardening ([history](docs/history/mvp.md)) | 0.1.0   | Done        | 100%     |
| M8    | Plugin code runtime: shared and server code, handler recipes, slash commands                                                     | 0.2.0   | Not started | 0%       |
| M9    | Combat tracker and initiative                                                                                                    | 0.2.0   | Not started | 0%       |
| M10   | Content and table life cycle: compendium packs, chat edits, sheet history, archive, backups                                      | 0.2.0   | Not started | 0%       |
| M11   | Operations: arm64 image, pagination, version warnings                                                                            | 0.2.0   | Not started | 0%       |
| LATER | Maps, tokens, fog of war, assets, migrations, export/import                                                                      | —       | Not planned | —        |

### 0.2 Current focus

- **Active milestone:** M8
- **Next task:** `T-0809` (needs Q13 decided first)
- **Open blockers:** none
- **Decisions pending:** see §14 (Open Questions)

### 0.3 Change log

Changes up to the 0.1.0 release are in [`docs/history/mvp.md`](docs/history/mvp.md); user-visible changes go in `CHANGELOG.md`.

| Date       | Change                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-27 | MVP task lists and change log moved to `docs/history/mvp.md`. Spec reshaped for post-MVP work.                                                                                |
| 2026-10-27 | M8–M11 all target 0.2.0. No npm releases of the CLI and SDK (Q15); T-0810 dropped.                                                                                            |
| 2026-10-27 | §8 shortened to the design and planned parts; the format is documented in the authoring guide and the generated reference (ADR-045). §8.14 added for `combat.json` and packs. |

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

| Concern              | Decision                                                                                                                        | Rationale                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Language             | **TypeScript** (`strict`, plus `noUncheckedIndexedAccess`) everywhere                                                           | Type safety across client, server, and shared packages        |
| Monorepo             | **pnpm workspaces** + Turborepo for task caching                                                                                | Fast installs, strict dependency isolation                    |
| Frontend             | **React 19 with Vite**, SPA                                                                                                     | Plugins are loaded at runtime; SSR is not needed behind login |
| Frontend routing     | React Router, **framework mode as an SPA** (`ssr: false`) (ADR-013)                                                             | Typed routes, loaders for guards and data; no SSR server      |
| Client state         | React state and context for UI state; **Yjs** for document state                                                                | Little UI state to share; CRDT handles collaborative data     |
| Backend              | **Node.js LTS + Fastify**                                                                                                       | Lightweight, good plugin model, native TypeScript support     |
| Realtime (events)    | **WebSocket** (`ws`) at `/ws/events`                                                                                            | Chat, rolls, entity change notifications, presence            |
| Realtime (documents) | **Hocuspocus** (Yjs WebSocket server) at `/ws/collab`                                                                           | Mature Yjs backend with auth and persistence hooks            |
| Database             | **SQLite** via **Drizzle ORM** (`better-sqlite3`)                                                                               | No external service; backup is copying one file               |
| Schema validation    | **Zod** in TypeScript, emitted to **JSON Schema** at build                                                                      | Single source of truth for types and plugin file schemas      |
| Formula/dice         | Custom parser in `packages/formula`, no `eval`                                                                                  | Safe, testable, same code on both sides                       |
| Scoped CSS           | **PostCSS** in `plugin-schema`, run by the validator and the loader (ADR-021); lightningcss minifies at pack                    | Predictable, server-side scoping                              |
| Styling (core UI)    | **Tailwind CSS 4**; tokens as a `@theme` in `packages/ui` (ADR-012)                                                             | Fast iteration, one token file, both colour schemes           |
| Forms                | **TanStack Form**; the shared API schemas (`@vtt/shared/api`) are the validators (ADR-013)                                      | Typed field state; client and server run the same rules       |
| Testing              | **Vitest** (unit/integration), **Playwright** (e2e), Fastify `inject` for HTTP tests                                            | Standard, fast, multi-browser                                 |
| Lint                 | **ESLint flat config** + `typescript-eslint` + `eslint-plugin-import-x` (ADR-009) + boundary rules (`eslint-plugin-boundaries`) | Enforces type-aware rules and package layering                |
| Format               | **Prettier**                                                                                                                    | Consistent style, enforced in CI and pre-commit               |
| Packaging            | One **Docker** image (multi-stage), one `/data` volume                                                                          | Self-hosting goal G5                                          |

### 4.2 Process topology

One Node process serves:

- REST API under `/api/*`
- Events WebSocket at `/ws/events`
- Hocuspocus Yjs WebSocket at `/ws/collab`
- The built SPA (`WEB_DIR`): hashed assets cached for a year, every app route answered with `index.html` (ADR-044)
- Plugin static assets under `/plugins/<pluginId>/*` (client bundles, scoped CSS, images and fonts, read from `/data/plugins`), to signed-in users while the plugin is available (ADR-022)

Reverse proxy (Caddy or Traefik) handles TLS and must forward WebSocket upgrades on both `/ws/*` paths.

### 4.3 Data locations

Everything lives under a single data directory (`DATA_DIR`, default `/data` in Docker, `./data` in development). Logs go to standard output as JSON.

```
/data
├─ vtt.sqlite          database (WAL mode)
├─ plugins/            installed plugin folders
└─ cache/              derived files (scoped CSS, installs being unpacked)
```

### 4.4 Architectural rules

1. **Dependency direction:** `shared` ← `formula` ← `plugin-schema` ← `plugin-engine` ← `sheet-renderer` / `sdk`. `ui` feeds `sheet-renderer`. Apps may import any package. Packages never import apps.
2. **Server never imports React packages** (`ui`, `sheet-renderer`, `sdk/client`). Enforced by lint boundary rules.
3. **Pure packages:** `shared`, `formula`, `plugin-engine` contain no DOM and no Node-only APIs. The RNG is injected.
4. **Plugins never touch the database or raw Yjs.** They interact through the JSON contract and the narrow `ctx` object.
5. **The server is authoritative** for rolls, permissions, membership, and projections.
6. **Node packages:** `plugin-io` (plugin folders and archives on disk) may import `shared`, `formula` and `plugin-schema`; the server and `plugin-cli` use it. The server does not import `plugin-cli` (ADR-026).

---

## 5. Repository Structure

```
vtt/
├─ apps/
│  ├─ web/                        Vite + React SPA
│  │  └─ src/
│  │     ├─ routes/               route modules (React Router framework mode)
│  │     ├─ shell/                layout, session, access rules, navigation
│  │     ├─ features/             chat · entities · journal · members · plugins · settings · table · tables
│  │     ├─ collab/               Yjs providers, sheet store, awareness
│  │     ├─ realtime/             events socket client
│  │     ├─ api/ · forms/         typed API client, form helpers
│  │     ├─ i18n/                 message catalogues (en, pt-BR)
│  │     ├─ plugin-host/          loads systems, mounts sheets and cards, injects scoped CSS, import map
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
│        ├─ logger/               pino logger and request serializers
│        ├─ cli/                  backup and migration commands
│        └─ main.ts
├─ packages/
│  ├─ shared/                     entity types, ids, permission rules, event protocol, API contract (Zod)
│  ├─ formula/                    formula parser, evaluator, dice engine (pure)
│  ├─ plugin-schema/              Zod schemas for every plugin file, JSON Schema emitter, validator, CSS scoper
│  ├─ plugin-engine/              defaults, derived data, roll recipes, schema→Yjs mapping, outcome logic
│  ├─ ui/                         design tokens + primitives (Alert, Button, Card, Dialog, Select, TextField)
│  ├─ sheet-renderer/             layout JSON → React; built-in nodes; SheetStore interface
│  ├─ sdk/                        public API for code/ entries (defineClient and sheet hooks; server and shared entries later)
│  ├─ config/                     shared tsconfig, eslint, prettier presets
│  ├─ plugin-io/                  plugin folders and .vttplugin archives on disk (Node; server and CLI)
│  └─ plugin-cli/                 vtt-plugin: validate · dev (live preview page) · pack · schema
├─ plugins/                       reference systems built in-tree
│  ├─ tiny-d20/
│  └─ tiny-pool/
├─ e2e/                           Playwright suites
├─ docker/                        Dockerfile, compose and Caddy examples, smoke test
├─ docs/                          plugin authoring guide, plugin file reference, backups, security review, ADRs
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
└─ specs.md
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
- Rule sets: `@eslint/js` recommended, `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` (web), `eslint-plugin-import-x` (ordering, no cycles; ADR-009).
- **Layer boundaries** enforced by `eslint-plugin-boundaries`:
  - `apps/server` may not import `packages/ui`, `packages/sheet-renderer`, or `packages/sdk/client`.
  - `packages/shared`, `packages/formula`, `packages/plugin-engine` may not import `react`, `react-dom`, `fastify`, `drizzle-orm`, or any Node built-in (`fs`, `path`, `node:*`).
  - `packages/*` may not import from `apps/*`.
- `no-console` is an error in `apps/server` except via the logger module.
- Lint runs with `--max-warnings 0`.

### 6.3 Prettier

- `.prettierrc.json`: `printWidth: 100`, `singleQuote: true`, `trailingComma: "all"`, `semi: true`, `arrowParens: "always"`.
- Format applies to TS, TSX, JSON, CSS, Markdown, and YAML.
- Plugin JSON files in `plugins/*` are formatted with Prettier too. Generated files (`packages/plugin-schema/schemas/`, `docs/plugin-reference.md`, migrations) are excluded.
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
  8. Docker image: build the compose example and run `docker/smoke-test.sh` (every push and PR, ADR-044)
  9. Release, on `v*` tags only: push the image to `ghcr.io/rev-oo/rpg-vtt-ai` and create the GitHub release from `CHANGELOG.md` (ADR-046)
- A PR cannot merge unless CI is green.

### 6.5 Editor and tooling

- `.editorconfig`: UTF-8, LF line endings, 2-space indent, final newline.
- `.nvmrc` pins Node LTS. `package.json` sets `engines` and `packageManager`.
- Recommended VS Code extensions listed in `.vscode/extensions.json` (ESLint, Prettier).

---

## 7. Functional Requirements

Requirement IDs are stable. Reference them in tasks and tests (for example `FR-AUTH-01`). **Status** names the release that delivered a requirement, or the milestone planned for it (§0.1).

### 7.1 Accounts and access (`FR-AUTH`)

| ID         | Requirement                                                                                                               | Priority | Status |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-AUTH-01 | The first user to start a fresh instance is created via a setup screen and becomes instance admin.                        | MVP      | 0.1.0  |
| FR-AUTH-02 | Admins create users with a username and a generated one-time password, or send an invite link.                            | MVP      | 0.1.0  |
| FR-AUTH-03 | Users log in with username and password. Passwords are hashed with Argon2id.                                              | MVP      | 0.1.0  |
| FR-AUTH-04 | Sessions use secure, HTTP-only, SameSite=Lax cookies with server-side session records and expiry.                         | MVP      | 0.1.0  |
| FR-AUTH-05 | Users can change their password and display name.                                                                         | MVP      | 0.1.0  |
| FR-AUTH-06 | Admins can disable or delete users. Deleting a user keeps their chat messages with the author name snapshot.              | MVP      | 0.1.0  |
| FR-AUTH-07 | Login attempts are rate-limited per IP and per username.                                                                  | MVP      | 0.1.0  |
| FR-AUTH-08 | Instance admin is distinct from table GM. Admins cannot read a table's secret data unless they are a member with GM role. | MVP      | 0.1.0  |

### 7.2 Tables and membership (`FR-TABLE`)

| ID          | Requirement                                                                                                                           | Priority | Status |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-TABLE-01 | Any user can create a table and becomes its GM. Creation requires selecting an installed system plugin.                               | MVP      | 0.1.0  |
| FR-TABLE-02 | A table's system plugin and its `systemVersion` are fixed at creation.                                                                | MVP      | 0.1.0  |
| FR-TABLE-03 | GMs invite users by generating a table invite link with a role (`player`, `spectator`, `assistant`). Links can expire and be revoked. | MVP      | 0.1.0  |
| FR-TABLE-04 | GMs change member roles and remove members. Removing a member keeps their characters, which become unowned.                           | MVP      | 0.1.0  |
| FR-TABLE-05 | A user may belong to multiple tables and set a default character per table.                                                           | MVP      | 0.1.0  |
| FR-TABLE-06 | GMs and assistants can archive a table (read-only, still exportable in the future).                                                   | v1       | M10    |
| FR-TABLE-07 | Only the table GM can change table settings, roles, and system-level options.                                                         | MVP      | 0.1.0  |

### 7.3 Actors and items (`FR-ENT`)

| ID        | Requirement                                                                                                                                                               | Priority | Status |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-ENT-01 | GMs and players can create actors of any type declared by the table's plugin. Players may create only types with `controlledBy: "player"` unless the GM allows otherwise. | MVP      | 0.1.0  |
| FR-ENT-02 | Actors have a name, image URL, and ownership (default level plus per-user levels).                                                                                        | MVP      | 0.1.0  |
| FR-ENT-03 | Ownership levels: `none`, `observer` (read), `owner` (read and edit). GMs are implicit owners of all actors.                                                              | MVP      | 0.1.0  |
| FR-ENT-04 | Actors can be duplicated, deleted (soft delete with restore for 30 days), and listed with search and type filters.                                                        | MVP      | 0.1.0  |
| FR-ENT-05 | Items exist in a table-level library. Items can be copied into an actor, creating an owned item with a `sourceId`.                                                        | MVP      | 0.1.0  |
| FR-ENT-06 | Items have a name, image URL, and plugin-defined data, edited on an item sheet.                                                                                           | MVP      | 0.1.0  |
| FR-ENT-07 | Entity changes emit events so other clients refresh lists and sheet headers.                                                                                              | MVP      | 0.1.0  |
| FR-ENT-08 | An actor's data is stored as a CRDT document (see §9). Its SQL projection is updated on persist.                                                                          | MVP      | 0.1.0  |
| FR-ENT-09 | Deleting an actor removes its live document from active sessions and retains a snapshot for the restore window.                                                           | MVP      | 0.1.0  |

### 7.4 Live sheets (`FR-SHEET`)

| ID          | Requirement                                                                                                                                                                                 | Priority | Status |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-SHEET-01 | Opening a sheet connects to a Yjs document; all users with access see changes within 500 ms on a LAN.                                                                                       | MVP      | 0.1.0  |
| FR-SHEET-02 | Each field shows the presence of other users editing it (colored outline and name badge).                                                                                                   | MVP      | 0.1.0  |
| FR-SHEET-03 | Users with `observer` access see the sheet read-only; the UI shows a banner.                                                                                                                | MVP      | 0.1.0  |
| FR-SHEET-04 | Secret layer fields (declared in the plugin with `"x-layer": "secret"`) are only sent to GMs and assistants. The server omits them from observer and player sessions, not just from the UI. | MVP      | 0.1.0  |
| FR-SHEET-05 | Derived values update live for all viewers without being stored.                                                                                                                            | MVP      | 0.1.0  |
| FR-SHEET-06 | Collections (lists) support add, remove, and reorder; reorder must not duplicate or lose rows under concurrent edits.                                                                       | MVP      | 0.1.0  |
| FR-SHEET-07 | Long text fields (notes, biography) support collaborative editing.                                                                                                                          | MVP      | 0.1.0  |
| FR-SHEET-08 | Counter fields support server-applied deltas (`adjust`) so concurrent "−3 HP" actions are not overwritten.                                                                                  | MVP      | 0.1.0  |
| FR-SHEET-09 | Field-level validation runs on input and again on the server before persist. Invalid values are rejected or clamped per the field's rule and reported to the editor.                        | MVP      | 0.1.0  |
| FR-SHEET-10 | Sheets render on phone-width viewports (≥ 360 px) with no horizontal page scroll.                                                                                                           | MVP      | 0.1.0  |
| FR-SHEET-11 | Sheet history: the last 50 snapshots per actor are retained for recovery.                                                                                                                   | v1       | M10    |

### 7.5 Chat and rolls (`FR-CHAT`)

| ID         | Requirement                                                                                                                                                        | Priority | Status |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| FR-CHAT-01 | Table chat supports text messages with speaker selection (user, or one of their actors).                                                                           | MVP      | 0.1.0  |
| FR-CHAT-02 | Messages have `audience`: `public`, `whisper` (selected recipients), or `gm` (GM and assistants only). Audience is enforced by the server on delivery and history. | MVP      | 0.1.0  |
| FR-CHAT-03 | Roll messages are created only by the server from a roll recipe or a formula typed by a user.                                                                      | MVP      | 0.1.0  |
| FR-CHAT-04 | Rolls are computed with a cryptographically secure RNG and the full die results are stored in the message.                                                         | MVP      | 0.1.0  |
| FR-CHAT-05 | Secret rolls (`audience: gm`) hide results from players; the sender still sees their own result.                                                                   | MVP      | 0.1.0  |
| FR-CHAT-06 | Card messages render through a plugin-defined template. If the template is missing (plugin disabled), the message falls back to plain text.                        | MVP      | 0.1.0  |
| FR-CHAT-07 | Chat history loads in pages of 50 with infinite scroll.                                                                                                            | MVP      | 0.1.0  |
| FR-CHAT-08 | Users can type dice formulas directly (`/r 2d6+3`, `/gmr 1d20`). Supported only for system-agnostic dice grammar; plugin commands are v1.                          | MVP      | 0.1.0  |
| FR-CHAT-09 | Messages can be edited or deleted by their author within 5 minutes; GMs can delete any message.                                                                    | v1       | M10    |

### 7.6 Journal (`FR-JOURNAL`)

| ID            | Requirement                                                                                                                   | Priority | Status |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-JOURNAL-01 | GMs and assistants create journal entries with a title and a rich-text body (collaborative).                                  | MVP      | 0.1.0  |
| FR-JOURNAL-02 | Journal entries have ownership like actors. Default is `observer` for players.                                                | MVP      | 0.1.0  |
| FR-JOURNAL-03 | Entries can be hidden, then revealed by the GM. Hidden entries are never sent to players. New entries start hidden (ADR-038). | MVP      | 0.1.0  |
| FR-JOURNAL-04 | Rich text supports headings, lists, bold, italic, links, and inline images from URLs.                                         | MVP      | 0.1.0  |

### 7.7 Dice engine (`FR-DICE`)

| ID         | Requirement                                                                                                                                                      | Priority | Status |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-DICE-01 | The core grammar supports: `NdS`, `+`, `-`, `*`, `/`, parentheses, `kh`/`kl`/`dh`/`dl` (keep/drop), `!` (explode), `r` (reroll), and `cs`/`cf` success counting. | MVP      | 0.1.0  |
| FR-DICE-02 | Dice expressions support `@` references to actor data, evaluated by the server.                                                                                  | MVP      | 0.1.0  |
| FR-DICE-03 | Plugins can declare custom dice by faces, labels, and optional result mapping (for example Fate `dF`).                                                           | MVP      | 0.1.0  |
| FR-DICE-04 | Roll results list every die and the final total. Results include the expression and the resolved references.                                                     | MVP      | 0.1.0  |
| FR-DICE-05 | The engine is deterministic when given a seeded RNG (for tests and replay).                                                                                      | MVP      | 0.1.0  |

### 7.8 Plugins (`FR-PLUGIN`)

| ID           | Requirement                                                                                                                | Priority | Status                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------ |
| FR-PLUGIN-01 | Plugins are folders placed in `DATA_DIR/plugins/`. A restart or admin "rescan" makes them available. No rebuild is needed. | MVP      | 0.1.0                          |
| FR-PLUGIN-02 | Plugin manifests and all JSON files are validated against the plugin schemas. Errors are reported with file and JSON path. | MVP      | 0.1.0                          |
| FR-PLUGIN-03 | Plugins declare `coreApi` as a semver range. Incompatible plugins are listed as disabled with the reason.                  | MVP      | 0.1.0                          |
| FR-PLUGIN-04 | Plugin CSS is scoped by the loader (see §8.6).                                                                             | MVP      | 0.1.0                          |
| FR-PLUGIN-05 | Plugin language files (`lang/*.json`) are merged into the UI, with fallback to English.                                    | MVP      | 0.1.0                          |
| FR-PLUGIN-06 | Plugins containing a `code/` folder are flagged as "includes code" in the admin UI. Admins must enable them explicitly.    | MVP      | 0.1.0                          |
| FR-PLUGIN-07 | A plugin can be enabled or disabled per instance by an admin. Tables using a disabled plugin become read-only.             | MVP      | 0.1.0                          |
| FR-PLUGIN-08 | Plugin-owned code (`code/`) runs in-process and is trusted in v1. Sandboxing is out of scope for v1.                       | MVP      | 0.1.0 (`code/client` only); M8 |
| FR-PLUGIN-09 | Plugin compendium packs (`packs/*.json`) can be imported into a table library.                                             | v1       | M10                            |
| FR-PLUGIN-10 | Plugins can declare slash commands and chat handlers in `code/`.                                                           | v1       | M8                             |

### 7.9 Combat (`FR-COMBAT`) — v1

| ID           | Requirement                                                                                                                      | Priority | Status |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-COMBAT-01 | GM creates an encounter, adds combatants (actors or free-form entries), and runs initiative.                                     | v1       | M9     |
| FR-COMBAT-02 | Initiative is rolled using the plugin's `combat.json` formula, with ordering rule `desc`, `asc`, or `sideBased`, or a code hook. | v1       | M9     |
| FR-COMBAT-03 | Turn advance and round counter are broadcast to all members.                                                                     | v1       | M9     |
| FR-COMBAT-04 | Combatant visibility respects actor ownership and hidden status.                                                                 | v1       | M9     |

### 7.10 Settings and administration (`FR-ADMIN`)

| ID          | Requirement                                                                                                                       | Priority                   | Status                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------- |
| FR-ADMIN-01 | Instance settings: site name, registration policy (closed, invite-only), session lifetime, upload limits.                         | MVP                        | 0.1.0 (no upload limits, ADR-040) |
| FR-ADMIN-02 | Plugin admin page: list, enable, disable, rescan, view validation errors.                                                         | MVP                        | 0.1.0                             |
| FR-ADMIN-03 | Health endpoint `/api/health` reports DB status and plugin load status.                                                           | MVP                        | 0.1.0                             |
| FR-ADMIN-04 | Table settings page: name, description, house-rule options from the plugin's `settings.json`.                                     | MVP                        | 0.1.0                             |
| FR-ADMIN-05 | Backups: documented procedure to copy `vtt.sqlite` and `plugins/` safely (WAL checkpoint). Optional scheduled backup via env var. | MVP (doc) / v1 (automated) | 0.1.0 (doc); M10 (automated)      |

### 7.11 Maps and assets — LATER

Out of scope for MVP and v1. Captured here so the data model stays compatible:

- `img` fields are plain URL strings; no asset table yet.
- A `scenes` table and token placement are added later; no MVP schema depends on them.

---

## 8. Plugin System

The plugin format is documented for authors in the [plugin authoring guide](docs/plugin-authoring.md) and in the [plugin file reference](docs/plugin-reference.md), which is generated from the Zod schemas. Both are authoritative (ADR-045): the guide's tutorial is tested, and the reference cannot go stale. This section keeps the design: principles, the folder layout, and the parts that are planned but not built (§8.10, §8.14). For the format itself it summarises and links. Subsection numbers are stable because code cites them.

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
├─ combat.json              initiative formula and ordering (optional; validated, used from M9, §8.14)
├─ settings.json            per-table options (optional)
├─ cards/<name>.json        chat card templates (optional)
├─ lang/<locale>.json       translations, English required if any lang file exists
├─ styles/<name>.css        scoped CSS (optional)
├─ packs/<name>.json        compendium packs (optional; from M10, §8.14)
└─ code/                    optional custom behaviour
   ├─ shared.ts             pure functions usable in formulas, client and server (from M8)
   ├─ client.tsx            custom layout nodes and card renderers
   └─ server.ts             roll handlers, lifecycle hooks (from M8)
```

Code entries are TypeScript sources in the plugin folder for development, but the plugin CLI (`vtt-plugin pack`) **compiles them to ES modules** (`code/*.js`; no `.d.ts`, ADR-026) and the packed plugin is what the server loads. The server never compiles TypeScript at runtime.

**In 0.1.0 only `code/client` runs** (ADR-025). `code/shared` and `code/server` are packed but not loaded, so `handler` recipes fail when rolled and formulas can call only the built-in functions. Other JSON files outside `code/` are ignored with an `unknown_file` warning; a text file over 1 MB is not read.

### 8.3 Manifest (`plugin.json`)

The manifest names the plugin (`id`, `name`, `version`), declares the core API range it supports (`coreApi`), whether it has code (`hasCode`), and its languages (`locales`, `defaultLocale`). `kind` is `system`; `module` is reserved for future non-system plugins. Rules: [guide, The manifest](docs/plugin-authoring.md#the-manifest); keys: [reference, Plugin manifest](docs/plugin-reference.md#plugin).

### 8.4 Actor and item types

A type file declares the entity's data as a subset of JSON Schema, derived values (formulas without dice, never stored), its sheet, and for actors who may create it (`controlledBy`). `x-` annotations choose how the core stores each field, which is what the live document model (§9) builds on: `x-kind` (`longText`, `richText`, `collection`, `image`), `x-counter` (§9.5) and `x-layer: "secret"` (§9.3). Rules: [guide, Actor and item types](docs/plugin-authoring.md#actor-and-item-types); keys: [reference, Actor type](docs/plugin-reference.md#actor-type) and [Item type](docs/plugin-reference.md#item-type).

### 8.5 Sheets (layout JSON)

A sheet is a tree of built-in nodes (containers, fields, lists, roll buttons, derived values, text, images) plus `custom:<name>` nodes from plugin code. `visibleIf` hides nodes with a formula, but secrecy is enforced by the server, not by layout: secret fields never reach players (§9.3). Nodes: [guide, Sheets](docs/plugin-authoring.md#sheets); keys: [reference, Sheet layout](docs/plugin-reference.md#sheet).

### 8.6 Scoped CSS

The server scopes plugin stylesheets with PostCSS (in `plugin-schema`, ADR-021) and caches the result under `DATA_DIR/cache`: selectors are prefixed with `[data-plugin="<id>"]`, rules go in `@layer plugin`, sheets get `contain: layout paint`, and anything that could reach outside the plugin is removed with a warning. Rules and styling hooks: [guide, Styles](docs/plugin-authoring.md#styles).

### 8.7 Rolls

`rolls.json` holds recipes: a formula rolled on the server against the entity's current data, ordered outcomes, and an optional chat card. Buttons pass arguments as `@args.*`. A `handler` recipe calls a function in `code/server` instead (§8.10); it fails with `handler_recipe` until M8 (T-0809). Rules: [guide, Rolls](docs/plugin-authoring.md#rolls); keys: [reference, Roll recipes](docs/plugin-reference.md#rolls).

### 8.8 Custom dice

`dice.json` declares named dice (`dF`) with equally likely faces, each a number or a label with a number (ADR-017, ADR-019). [Guide, Custom dice](docs/plugin-authoring.md#custom-dice); [reference, Custom dice](docs/plugin-reference.md#dice).

### 8.9 Formula language

One language serves derived values, `visibleIf`, roll formulas, outcomes, arguments and card rows (ADR-017):

- A hand-written Pratt parser builds an AST that is evaluated directly. Never `eval`, never `new Function`.
- **Pure** mode (no dice) runs on both sides, for derived values and conditions. **Rolling** mode allows dice and runs only on the server, with an injected RNG.
- Functions come from a fixed whitelist. Shared plugin functions (§8.10) join it in M8.
- Formulas are checked when the plugin is validated; evaluation has a step limit.

Syntax, references, operators, functions and dice: [guide, Formulas](docs/plugin-authoring.md#formulas).

### 8.10 Code entries

Planned shape of all three entries:

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

**Status:** 0.1.0 loads only `code/client`, with `defineClient` and the hooks of `@vtt/sdk/client` (ADR-025; [guide, Plugin code](docs/plugin-authoring.md#plugin-code)). `defineShared` and `defineServer` are built in M8 (T-0809), once Q13 decides how server code is contained.

Rules:

- Server code receives a restricted `ctx` with: `roll`, `chat.post`, `actors.get`, `actors.adjust` (validated writes only), `log`. It has no database handle and no filesystem access.
- Client code receives only `@vtt/sdk/client` hooks (`useField`, `useDerived`, `useActor`, `useTranslate`). It cannot open sockets or call arbitrary APIs. It imports `react`, `react/jsx-runtime` and `@vtt/sdk/client` by name; the app's import map resolves them to its own copies (ADR-025).
- Shared code is pure and must pass the same lint boundaries as `packages/formula`.
- Custom nodes must be pure rendering: they read via hooks and write via `useField` setters.
- **Trust model (v1):** `code/` is trusted. Installing a plugin with code requires explicit admin enablement. The admin UI lists the code entry points.

### 8.11 Chat cards

A card lays out a recipe's roll in chat with formula rows that read the roll; a client component of the same name replaces it. [Guide, Chat cards](docs/plugin-authoring.md#chat-cards); [reference, Chat card](docs/plugin-reference.md#card).

### 8.12 Settings

`settings.json` declares per-table options (house rules) that the GM sets on the table settings page and formulas read as `@settings.<name>` (ADR-039). [Guide, Table settings](docs/plugin-authoring.md#table-settings); [reference, Settings](docs/plugin-reference.md#settings).

### 8.13 Plugin validation and CLI

The server runs the same validation as `vtt-plugin validate` on install and on rescan. The CLI (`packages/plugin-cli`) validates, previews (`dev`), packs to `.vttplugin` archives (ADR-026) and emits JSON Schemas. It is not published; authors run it from a build of this repository (ADR-045, Q15). [Guide, Checking, previewing and installing](docs/plugin-authoring.md#checking-previewing-and-installing).

### 8.14 Planned plugin files

Reserved in 0.1.0 and built in M9 and M10:

- **`combat.json`** (M9, T-0802): `initiative`, a rolling formula each combatant rolls, and `order`: `desc`, `asc` or `sideBased`. The validator already checks it ([reference, Combat](docs/plugin-reference.md#combat)); nothing uses it yet. A code hook in `code/server` may order combatants instead (FR-COMBAT-02), and `onTurnStart` runs at the start of each turn (§8.10).
- **`packs/<name>.json`** (M10, T-0803): compendium entries of the plugin's own actor and item types, each validated against its type's data schema, which GMs import into a table library (FR-PLUGIN-09). Not validated or read in 0.1.0.

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
actor:<id>:main, actor:<id>:secret
 └─ data   Y.Map   the layer's schema fields: objects → nested Y.Map; x-kind longText → Y.Text;
                   x-kind richText → Y.XmlFragment (TipTap blocks, ADR-037);
                   collection → Y.Map keyed by row id, each row with a `sort` value;
                   everything else → plain values
journal:<id>:main
 └─ body   Y.XmlFragment   the entry's rich text (ADR-038)
```

Owned items are rows in the `items` table with an `actorId` (ADR-015); items have no live documents. Data the layout does not know stays in `main` (ADR-029).

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
- Ownership changes take effect immediately: connected clients whose access drops are disconnected from the document (ADR-036).

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
- Invalid values on persist are replaced with the schema default and logged. The editor receives a `validation` message (ADR-031). Journal bodies are not repaired.
- Schema changes on a plugin version bump are **not** auto-migrated in MVP. Actors and items store the system version they were created with (`dataVersion`); missing fields read as their defaults. Nothing compares versions yet; migrations are LATER (see §7.11).

---

## 10. API and Realtime Contracts

### 10.1 REST

- Base path `/api/v1`. JSON bodies. Validated with Zod on entry.
- Errors use `{ error: { code, message, details? } }` with stable `code` strings.
- Lists are not paginated yet (ADR-015). Chat history pages backwards with `?before=…`.
- Auth: session cookie. Mutating requests require a CSRF header (`X-CSRF-Token`) matched to the session.

Key resource groups:

| Group           | Endpoints (illustrative)                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth            | `POST /auth/login`, `POST /auth/logout`, `GET/PATCH /me`, `POST /me/password`                                                                                         |
| Setup           | `GET /setup/status`, `POST /setup/admin`                                                                                                                              |
| Users (admin)   | `GET /users`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id`                                                                                                  |
| Tables          | `GET /tables`, `POST /tables`, `GET /tables/:id`, `PATCH /tables/:id`, `GET /tables/:id/types`                                                                        |
| Members         | `GET /tables/:id/members`, `PATCH /tables/:id/members/:userId`, `DELETE …`                                                                                            |
| Invites         | `GET/POST /tables/:id/invites`, `DELETE /tables/:id/invites/:inviteId`, `GET /invites/:token`, `POST /invites/:token/accept`, `POST /invites/:token/signup` (ADR-040) |
| Instance        | `GET /instance` (public), `GET/PATCH /admin/settings` (admin; ADR-040)                                                                                                |
| Actors          | `GET /tables/:id/actors`, `POST …`, `GET/PATCH/DELETE /actors/:id`, `POST /actors/:id/duplicate`, `POST /actors/:id/restore`                                          |
| Items           | `GET /tables/:id/items`, `POST …`, `GET/PATCH/DELETE /items/:id`, `GET/POST /actors/:id/items`, `POST /items/:id/restore`                                             |
| Journal         | `GET /tables/:id/journal`, `POST …`, `GET/PATCH/DELETE /journal/:id`, `POST /journal/:id/restore` (ADR-038)                                                           |
| Chat            | `GET /tables/:id/messages?before=…`, `POST /tables/:id/messages`                                                                                                      |
| Systems         | `GET /systems`, `GET /systems/:id` (definition, styles and client code of an available system, ADR-025)                                                               |
| Rolls           | `POST /tables/:id/rolls` (a formula or a recipe with arguments; ADR-018, ADR-025)                                                                                     |
| Plugins (admin) | `GET /plugins`, `POST /plugins/:id/enable`, `POST /plugins/:id/disable`, `POST /plugins/rescan` (ADR-020), `POST /plugins/install` (ADR-026)                          |
| Health          | `GET /api/health`                                                                                                                                                     |

### 10.2 Events WebSocket (`/ws/events`)

- Authenticated during the HTTP upgrade using the session cookie.
- JSON messages in an envelope: `{ "v": 1, "type": "…", "tableId": "…", "payload": { … }, "id": "…" }`.
- Client → server: `subscribe`, `unsubscribe`, `chat.send`, `roll.request`, `presence.ping`.
- Server → client: `chat.message` (rolls are messages of kind `roll`, ADR-018), `entity.changed`, `table.updated` (ADR-039), `ack`, `error`. `combat.updated` comes with combat (v1). A client message with an `id` is answered by `ack` or `error` carrying `replyTo` (ADR-016).
- A socket whose session ends is closed with code `4401`.
- **Audience filtering happens on the server** before send: whispers go only to recipients and sender; `gm` audience only to GM and assistants.
- Protocol version is `v`. The server rejects unknown versions with an error that includes the supported versions.
- Heartbeat every 25 s; clients reconnect with exponential backoff and resubscribe. Missed events are recovered by fetching history from REST.

### 10.3 Collaboration WebSocket (`/ws/collab`)

- Hocuspocus protocol. Auth token is the session cookie validated in `onAuthenticate`.
- The document name is parsed and checked against membership and ownership before any sync message is accepted, and again before every message (ADR-028).
- Frames are limited to 1 MiB on this socket (16 KiB on `/ws/events`).
- Counter adjustments and repair reports are JSON stateless messages on the document: `adjust` from the client, `adjusted`, `error` and `validation` from the server (ADR-031).

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

### M0–M7 — MVP (released as 0.1.0)

All done; the task lists with their notes are in [`docs/history/mvp.md`](docs/history/mvp.md).

| Milestone | Tasks         | Scope                                                                        |
| --------- | ------------- | ---------------------------------------------------------------------------- |
| M0        | T-0001…T-0010 | Monorepo, TypeScript, lint, format, CI                                       |
| M1        | T-0101…T-0111 | Users, auth, tables, membership, web shell                                   |
| M2        | T-0201…T-0208 | Actors, items, events socket, chat                                           |
| M3        | T-0301…T-0305 | Formula parser, evaluator, dice engine, rolls                                |
| M4        | T-0401…T-0412 | Plugin schemas, scanner, CSS, engine, renderer, host, CLI, reference plugins |
| M5        | T-0501…T-0512 | Live sheets: Yjs documents, presence, counters, collections, text            |
| M6        | T-0601…T-0606 | Journal, members, invites, table and instance settings, plugin admin         |
| M7        | T-0701…T-0705 | Security review, e2e, Docker image, authoring guide, release                 |

### M8 — Plugin code runtime (0.2.0)

0.1.0 runs only `code/client` (ADR-025). M8 runs the other two entries, so handler recipes, custom formula functions and server hooks work.

- [ ] **T-0809 · Run plugin shared and server code**
  - **Deps:** none (needs Q13)
  - **Do:**
    - Add `defineShared({ functions })` and `defineServer({ handlers, hooks })` to `@vtt/sdk`, with the shapes in §8.10.
    - The server loads `code/shared.js` and `code/server.js` of enabled plugins; the web loads `code/shared.js` alongside `code/client.js`.
    - Shared functions become callable from formulas on both sides (derived values, rolls, `visibleIf`).
    - `handler` recipes run their server handler with the restricted `ctx` of §8.10 (`roll`, `chat.post`, `actors.get`, `actors.adjust`, `log`), and `handler_recipe` goes away.
    - A throwing or misbehaving handler fails its own roll with an error, never the server (per Q13).
    - The admin plugin page lists each plugin's code entry points (FR-PLUGIN-06).
  - **Done when:**
    - A fixture plugin's shared function gives the same derived value on the server and in the web sheet.
    - A handler recipe rolls and posts a card.
    - Tests show `ctx` offers nothing beyond §8.10, and a failing handler leaves the server serving.
    - §8.7, §8.10 and `docs/plugin-authoring.md` describe the new entries, and the tutorial test still passes.
  - **Covers:** FR-PLUGIN-08, §8.7, §8.10

- [ ] **T-0804 · Plugin slash commands and server hooks**
  - **Deps:** T-0809
  - **Do:** Plugins declare slash commands in `code/server` (`/name args`), handled on the server for the table's system. Unknown commands answer with an error, as built-in ones do.
  - **Done when:** a reference plugin's command posts a message for its caller; audience rules hold (whispered and GM-only results stay filtered); e2e covers one command.
  - **Covers:** FR-PLUGIN-10

### M9 — Combat (0.2.0)

- [ ] **T-0801 · Combat tracker (rules, endpoints, UI)**
  - **Deps:** none (needs Q14)
  - **Do:**
    - Encounters per table, stored as decided in Q14. Combatants are actors or free-form entries.
    - GM endpoints to create an encounter, add and remove combatants, start, advance the turn and end. Rounds count up.
    - A `combat.updated` event (§10.2) after every change.
    - A tracker panel on the table page for everyone, with GM controls.
    - Combatants follow actor visibility (FR-ENT-03), and hidden combatants are never sent to players.
  - **Done when:** the GM runs an encounter through two rounds; other members see each change within 500 ms; a wire-level test shows hidden combatants never reach players; e2e covers a round.
  - **Covers:** FR-COMBAT-01, FR-COMBAT-03, FR-COMBAT-04

- [ ] **T-0802 · Initiative and combat.json**
  - **Deps:** T-0801; T-0809 for the code hook
  - **Do:** Roll initiative with the plugin's `combat.json` formula and order combatants by `desc`, `asc` or `sideBased`. Call the `onTurnStart` server hook when a plugin has one. Both reference plugins get a `combat.json`.
  - **Done when:** each ordering rule is unit-tested, including ties; both reference plugins roll initiative in e2e; the hook runs once per turn in a test.
  - **Covers:** FR-COMBAT-02

### M10 — Content and table life cycle (0.2.0)

- [ ] **T-0803 · Compendium packs import**
  - **Deps:** none
  - **Do:** Validate `packs/*.json` (entries of the plugin's own actor and item types). GMs import a pack into the table library. Re-importing does not duplicate entries.
  - **Done when:** a reference plugin ships a pack; importing creates its items; an invalid pack is reported with file and JSON path; re-import is idempotent.
  - **Covers:** FR-PLUGIN-09

- [ ] **T-0805 · Chat message edit and delete**
  - **Deps:** none
  - **Do:** Authors edit or delete their own text messages within 5 minutes; GMs delete any message. Roll and card messages cannot be edited. Changes go out as events to the same audience as the message.
  - **Done when:** allow and deny tests for each rule; an edit reaches other clients live; a deleted whisper is gone for its recipients too.
  - **Covers:** FR-CHAT-09

- [ ] **T-0806 · Sheet history snapshots**
  - **Deps:** none
  - **Do:** Keep the last 50 snapshots per actor, taken on store at most once per few minutes. Owners and GMs list them and restore one; restoring changes the live document for everyone.
  - **Done when:** snapshot count and rotation are tested; a restore reaches open sheets; secret-layer snapshots stay GM-only.
  - **Covers:** FR-SHEET-11

- [ ] **T-0807 · Table archive**
  - **Deps:** none
  - **Do:** GMs and assistants archive a table and unarchive it. An archived table is read-only everywhere: REST writes, chat, rolls and collaborative documents.
  - **Done when:** tests show each write path rejected while archived and allowed again after unarchiving; the table list marks archived tables.
  - **Covers:** FR-TABLE-06

- [ ] **T-0808 · Automated backups**
  - **Deps:** none
  - **Do:** An environment variable schedules backups with the existing backup command (`apps/server/src/cli/backup.ts`), keeping the last N.
  - **Done when:** a test with fake timers shows backups written on schedule and old ones removed; `docs/backup.md` documents the settings.
  - **Covers:** FR-ADMIN-05 (automated part)

### M11 — Operations (0.2.0)

Independent tasks from the known limitations of 0.1.0. The CLI and SDK stay unpublished (Q15).

- [ ] **T-0811 · arm64 image**
  - **Deps:** none
  - **Do:** The release job builds `linux/amd64` and `linux/arm64` into one manifest. CI smoke-tests the arm64 image on an arm64 runner.
  - **Done when:** the next release's image runs on arm64 and passes `docker/smoke-test.sh`.

- [ ] **T-0812 · List pagination**
  - **Deps:** none
  - **Do:** Cursor pagination for actor, item and journal lists (§10.1, ADR-015). The web lists load more on scroll.
  - **Done when:** endpoint tests cover cursors and limits; a table with more entries than one page lists all of them in the web.

- [ ] **T-0813 · Data version warning**
  - **Deps:** none
  - **Do:** Compare an actor's or item's `dataVersion` with the installed plugin version and show a notice on its sheet when they differ (§9.7). Migrations stay LATER.
  - **Done when:** a test with an upgraded fixture plugin shows the notice; matching versions show nothing.

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

| Level       | Tool                                     | Scope                                                                      | Gate                                           |
| ----------- | ---------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| Unit        | Vitest                                   | `formula`, `plugin-engine`, `shared` permissions, dice distributions       | ≥ 80% coverage on listed packages              |
| Property    | fast-check                               | Formula evaluator safety, collection reorder under concurrency, CSS scoper | Runs in CI                                     |
| Integration | Vitest + Fastify `inject`                | REST auth, ownership, audience filtering, plugin registry                  | Every endpoint has ≥ 1 allow and ≥ 1 deny test |
| Wire-level  | Vitest + ws client                       | Secret and whisper leakage on `/ws/events` and `/ws/collab`                | Required for NFR-08                            |
| Component   | Vitest + Testing Library                 | Sheet renderer nodes, plugin host                                          | Snapshot + behaviour                           |
| E2E         | Playwright                               | Multi-user flows (T-0702, [history](docs/history/mvp.md))                  | Green on Chrome, Firefox, WebKit               |
| Plugin      | `validatePlugin` in tests; tutorial test | Every plugin in `plugins/`; the guide's tutorial plugin (ADR-045)          | Blocking in CI                                 |

Test data: seeded fixtures under `packages/*/test/fixtures`. Reference plugins are the canonical fixtures for `plugin-engine` and e2e.

---

## 14. Open Questions

Each question blocks specific tasks if unanswered. Record decisions in `docs/adr/` and update here.

| #   | Question                                                                                                                                                                                                          | Blocks                | Proposed default                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Accept "trusted code only" for plugins in v1, or require sandboxing before release?                                                                                                                               | T-0411+, FR-PLUGIN-08 | **Decided:** trusted only. Plugins with code are flagged and start disabled; an admin enables them (FR-PLUGIN-06, ADR-020). Sandboxing is LATER |
| Q2  | Should GMs be allowed to change a table's plugin after creation?                                                                                                                                                  | FR-TABLE-02           | **Decided:** No (fixed); `PATCH` rejects it                                                                                                     |
| Q3  | TipTap for rich text, or a lighter editor?                                                                                                                                                                        | T-0510                | **Decided:** TipTap for `richText`; `longText` keeps the plain shared textarea (ADR-035, ADR-037)                                               |
| Q4  | Email-based invites, or link-only?                                                                                                                                                                                | T-0109                | **Decided:** Link-only (no SMTP dependency)                                                                                                     |
| Q5  | Is `tiny-pool` required for v0.1.0 or can it move to v1?                                                                                                                                                          | T-0412, T-0702        | **Decided:** required; it shipped in 0.1.0 (T-0412)                                                                                             |
| Q6  | Soft-delete retention window: 30 days fixed, or configurable?                                                                                                                                                     | FR-ENT-04             | **Decided:** Configurable, default 30 (ADR-014)                                                                                                 |
| Q7  | Does Hocuspocus need its own port in development?                                                                                                                                                                 | T-0501                | **Decided:** no; one port, routed by upgrade path (§4.2)                                                                                        |
| Q8  | Formula parser: hand-written Pratt or Peggy/Chevrotain?                                                                                                                                                           | T-0301                | **Decided:** Hand-written Pratt (ADR-017)                                                                                                       |
| Q9  | Required Node version: current LTS at the time of M0?                                                                                                                                                             | T-0001                | **Decided:** Node 24 LTS, pinned in `.nvmrc`                                                                                                    |
| Q10 | `GET /systems/:id` sends a plugin definition, whose schema lives in `plugin-schema`, which `shared` may not import (§4.4). Where is its response schema?                                                          | T-0409                | **Decided:** `shared` types it as `record(unknown)`; the web parses it with `pluginDefinitionSchema` (ADR-025)                                  |
| Q11 | No M6 task names the journal UI. Is it built with T-0601, or later?                                                                                                                                               | T-0601                | **Decided:** later in M6, with T-0602 and T-0603; T-0601 is the server side (ADR-038)                                                           |
| Q12 | FR-ADMIN-01 names a registration policy and upload limits, but nobody can sign up and there are no uploads. What does T-0604 build?                                                                               | T-0604                | **Decided:** an `invite` policy lets invite links sign up; upload limits wait for uploads (ADR-040)                                             |
| Q13 | How is plugin server code contained in-process? A handler can loop forever or throw asynchronously. Options: a worker thread per plugin with a time limit, or `vm` contexts, or trusted code with try/catch only. | T-0809                | A worker thread per plugin, with a time limit per call and `ctx` calls passed as messages                                                       |
| Q14 | Combat data model: an encounter as rows (encounters, combatants) updated through REST and events, or as a Yjs document like sheets?                                                                               | T-0801                | Rows and events: turns are GM-driven, so live co-editing adds little                                                                            |
| Q15 | Publish the plugin CLI and SDK to npm?                                                                                                                                                                            | —                     | **Decided:** no. Plugin authors build them from this repository (ADR-045)                                                                       |

---

## 15. Risks

| Risk                                                | Likelihood                   | Impact | Mitigation                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout JSON becomes too limited for a real system   | Low                          | High   | Two reference systems and a reader test built systems with it in 0.1.0; `custom:` nodes as escape hatch                                                                        |
| CRDT + permissions bugs leak secret data            | Medium                       | High   | Wire-level tests (NFR-08), server-side checks on every update, secret docs separate from main                                                                                  |
| Trusted plugin code is a security hole              | High (if untrusted installs) | High   | Code plugins start disabled and are flagged; documented trust model; containment decided in Q13 before server code runs (M8); sandboxing LATER                                 |
| SQLite write contention under many active tables    | Low                          | Medium | WAL mode, batched projection writes, single writer; revisit at scale                                                                                                           |
| Formula language scope creep                        | High                         | Medium | Fixed function whitelist, change requires an ADR                                                                                                                               |
| Type drift between Zod, JSON Schema, and TypeScript | Medium                       | Medium | Single Zod source, emitted schemas snapshot-tested                                                                                                                             |
| Mobile sheet UX is cramped                          | Low                          | Medium | Dedicated full-screen route under 768 px (T-0511); phone e2e in CI                                                                                                             |
| Yjs document growth over long campaigns             | Low                          | Medium | Periodic compaction on store; sheet history limited                                                                                                                            |
| Upgrades between 0.x versions break stored data     | Medium                       | High   | Database migrations run on start; plugin data migrations are LATER (T-0813 warns meanwhile); `CHANGELOG.md` calls out breaking changes; operators pin image versions (ADR-046) |
| CI runners hang or flake, blocking releases         | Medium                       | Low    | Step time limits (browser install: 5 min); re-run before investigating; release job runs only after every check passes                                                         |

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
| ADR-023 | [Plugin engine: collections, defaults, derived values, recipes, cards, document layout](docs/adr/ADR-023-plugin-engine.md)                      | Accepted |
| ADR-024 | [Sheet renderer: store, inputs, CSS hooks, phone layout, preview](docs/adr/ADR-024-sheet-renderer.md)                                           | Accepted |
| ADR-025 | [Plugin host: system definitions, engine rolls and cards, import map, SDK client hooks](docs/adr/ADR-025-plugin-host.md)                        | Accepted |
| ADR-026 | [Plugin CLI and archives: plugin-io, .vttplugin format, install endpoint, pack, dev](docs/adr/ADR-026-plugin-cli-and-archives.md)               | Accepted |
| ADR-027 | [Reference plugins: tiny-d20 code, end-to-end path, gaps until M5–M7](docs/adr/ADR-027-reference-plugins.md)                                    | Accepted |
| ADR-028 | [Collaboration socket: Hocuspocus behind @fastify/websocket, per-message access checks, frame limits](docs/adr/ADR-028-collab-socket.md)        | Accepted |
| ADR-029 | [Document persistence and the Yjs mapping: ydocs, projection, unload delay](docs/adr/ADR-029-document-persistence.md)                           | Accepted |
| ADR-030 | [Secret layer: filtered views and formulas, secret documents only for secret fields](docs/adr/ADR-030-secret-layer.md)                          | Accepted |
| ADR-031 | [Counter adjustments and data repair over collab stateless messages](docs/adr/ADR-031-adjust-and-repair.md)                                     | Accepted |
| ADR-032 | [The web app's live sheet store: Yjs SheetStore, one socket per sheet, server-side adjust](docs/adr/ADR-032-web-sheet-store.md)                 | Accepted |
| ADR-033 | [Sheet presence over Yjs awareness: ids only, names and colors from the members](docs/adr/ADR-033-sheet-presence.md)                            | Accepted |
| ADR-034 | [Collections under concurrent edits: server-created maps, ties broken by id](docs/adr/ADR-034-collection-concurrency.md)                        | Accepted |
| ADR-035 | [Collaborative long text: a minimal shared textarea, TipTap deferred](docs/adr/ADR-035-shared-text.md)                                          | Accepted |
| ADR-036 | [Pushing access changes to open documents: re-check after every change](docs/adr/ADR-036-access-revocation.md)                                  | Accepted |
| ADR-037 | [Rich text with TipTap over a Y.XmlFragment; plain text as its JSON value](docs/adr/ADR-037-rich-text.md)                                       | Accepted |
| ADR-038 | [Journal entries over REST and collab: hidden by default, 404 for hidden entries, a `body` fragment](docs/adr/ADR-038-journal-entries.md)       | Accepted |
| ADR-039 | [Table settings checked against the system's house rules; `table.updated` event](docs/adr/ADR-039-table-settings.md)                            | Accepted |
| ADR-040 | [Instance settings, invite sign-up and `/api/health`](docs/adr/ADR-040-instance-settings-and-health.md)                                         | Accepted |
| ADR-041 | [UI languages: `pt-BR`, the catalogue check, and picking the language](docs/adr/ADR-041-ui-languages.md)                                        | Accepted |
| ADR-042 | [Content Security Policy, security headers and the new rate limits](docs/adr/ADR-042-security-headers-and-limits.md)                            | Accepted |
| ADR-043 | [The e2e suite on three browsers, one instance each](docs/adr/ADR-043-e2e-on-three-browsers.md)                                                 | Accepted |
| ADR-044 | [The Docker image, and the server serving the web app](docs/adr/ADR-044-docker-image.md)                                                        | Accepted |
| ADR-045 | [Plugin authoring guide and generated file reference](docs/adr/ADR-045-plugin-authoring-docs.md)                                                | Accepted |
| ADR-046 | [Releases: version tags publish the image and the release notes](docs/adr/ADR-046-releases.md)                                                  | Accepted |

New decisions are appended here with a number, a one-line summary, and a link to the full ADR in `docs/adr/`.

---

## 17. Instructions for Agentic Contributors

If you are an AI coding agent working in this repository:

1. **Read §0 first.** Pick the next task in "Next task" or the first unchecked task whose dependencies are all `[x]`.
2. **Read the requirement IDs** the task references in §7 before coding. Do not implement behaviour that no requirement asks for.
3. **Respect the layer rules** in §4.4 and §6.2. If a rule blocks you, stop and record the conflict in §14 rather than working around it.
4. **Never add `any`, non-null assertions, `eval`, or `new Function`.** Validate external input with Zod.
5. **Keep plugin behaviour declarative.** Add code to a plugin only if the JSON format cannot express the need; if it can't, propose a format extension in an ADR first.
6. **Before marking a task done:** run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` for the affected packages, and the task's "Done when" criteria. Then update §0 (checkboxes, progress percentage, change log). List user-visible changes under `[Unreleased]` in `CHANGELOG.md` in the same PR.
7. **Do not expand scope.** Items in LATER (§7.11 and §12) are out of scope unless a task explicitly includes them.
8. **Record decisions** that differ from this PRD in `docs/adr/` and in §16, in the same commit as the code change.
9. **Commit style:** conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`), referencing task IDs (for example `feat(formula): add dice keep modifiers (T-0303)`).
10. **Releasing** (ADR-046): in a PR, bump every `package.json` to the new version and move `[Unreleased]` in `CHANGELOG.md` into a dated section. After it merges, tag the merge commit `v<version>` on main and push the tag; CI publishes the image and the GitHub release once every check passes.
11. **Past work:** the MVP's task notes and change log are in `docs/history/mvp.md`. Read them when a task touches code built then.
