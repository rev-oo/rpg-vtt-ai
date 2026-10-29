# PRD: VTT (Virtual Tabletop) Platform

> **Status:** 0.2.0 released (2026-10-28) · **Created:** 2026-10-19 · **Last updated:** 2026-10-28
> **Audience:** Human developers and agentic AI coding assistants. This file is the source of truth for scope, decisions, and progress. Task notes and change logs of past releases are in [`docs/history/`](docs/history/): [`mvp.md`](docs/history/mvp.md) (0.1.0) and [`0.2.0.md`](docs/history/0.2.0.md).

---

## 0. Progress Tracker

Update this section every time a task changes state. Keep the checkboxes and the milestone table in sync.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (add a note)

### 0.1 Milestone overview

| ID     | Milestone                                                                                                                        | Release | Status      | Progress |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------- | -------- |
| M0–M7  | MVP: foundation, server, entities, formulas, plugins, live sheets, journal and admin, hardening ([history](docs/history/mvp.md)) | 0.1.0   | Done        | 100%     |
| M8–M11 | Plugin code, combat, packs, chat edits, sheet history, archive, backups, arm64, pagination ([history](docs/history/0.2.0.md))    | 0.2.0   | Done        | 100%     |
| M12    | Table workspace, compendium and inventories                                                                                      | 0.3.0   | In progress | 88%      |
| M13    | Assets: uploads and asset manager                                                                                                | 0.4.0   | Not started | 0%       |
| M14    | Maps: scenes, tokens, fog of war                                                                                                 | 0.5.0   | Not started | 0%       |
| M15    | Plugin platform: data migrations, client sandbox, server isolation                                                               | 0.6.0   | Not started | 0%       |
| M16    | System builder                                                                                                                   | 0.7.0   | Not started | 0%       |
| M17    | 1.0: API freeze, upgrade guarantee, hardening                                                                                    | 1.0.0   | Not started | 0%       |
| LATER  | World export/import, schema composition, other plugin kinds, book-style journal                                                  | —       | Not planned | —        |

### 0.2 Current focus

- **Active milestone:** M12
- **Next task:** `T-1208`
- **Open blockers:** none
- **Decisions pending:** Q17–Q19 (§14)

### 0.3 Change log

Changes up to the 0.1.0 release are in [`docs/history/mvp.md`](docs/history/mvp.md), and up to 0.2.0 in [`docs/history/0.2.0.md`](docs/history/0.2.0.md); user-visible changes go in `CHANGELOG.md`.

| Date       | Change                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-28 | M8–M11 task lists and change log moved to `docs/history/0.2.0.md`. §8.10, §8.14, §14 and §15 updated for what 0.2.0 built.                                                                |
| 2026-10-28 | Road to 1.0 planned: M12–M17 with releases 0.3.0 to 1.0.0; Q16–Q19 opened; world export/import and schema composition stay LATER, with other plugin kinds and a book-style journal added. |
| 2026-10-28 | T-1201 done: the table is a dockview workspace (lists, documents, pages and tools as panels; one URL per table; layouts saved per browser) (ADR-059).                                     |
| 2026-10-28 | T-1202 done: a Compendium panel browses pack entries with previews; GMs copy entries into the table, owners copy items onto their actors; the whole-pack import is removed (ADR-060).     |
| 2026-10-28 | T-1203 done, M12 done: item types declare `group`, `labelPlural` and `order`; item lists show items under their groups; tiny-d20 adds spells; Q16 decided (no rename) (ADR-061).          |
| 2026-10-28 | T-1204 added to M12 and done: items open on live sheets of their own (`item:<id>:main\|secret`), from the items panel and an actor's items (ADR-062).                                     |
| 2026-10-29 | M12 grows with inventories: T-1205–T-1208 add item contributions to actor formulas (`@items.<name>`), an `items` sheet node and rolls with `@item` (FR-SHEET-12, FR-PLUGIN-15, ADR-063).  |
| 2026-10-29 | T-1205 done: item types declare `contributes`; actor formulas read the totals as `@items.<name>` in rolls, recipes, initiative and plugin code, live; an actor holds at most 500 items.   |
| 2026-10-29 | T-1206 done: an `items` sheet node lists and edits an actor's items in place, with open, remove, add from the library and drops; sheets compute `@items` from the open item documents.    |
| 2026-10-29 | T-1207 done: recipes declare `item` types and read `@item`; buttons in an `items` row or on an owned item's sheet roll as the holder with that item, checked on the server.               |

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

### 1.2 Non-goals (up to 1.0)

- Built-in game rules for any specific system.
- Built-in voice or video. Tables link to external tools (Discord, Jitsi).
- A marketplace or hosted content service.
- World export and import (LATER).
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
  9. Release, on `v*` tags only: build the image on amd64 and arm64 runners, push both under one tag to `ghcr.io/rev-oo/rpg-vtt-ai`, and create the GitHub release from `CHANGELOG.md` (ADR-046, ADR-056)
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

| ID          | Requirement                                                                                                                                                                                                   | Priority | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------- |
| FR-TABLE-01 | Any user can create a table and becomes its GM. Creation requires selecting an installed system plugin.                                                                                                       | MVP      | 0.1.0                 |
| FR-TABLE-02 | A table's system plugin is fixed at creation. Its `systemVersion` changes only when a GM or assistant upgrades the table to the installed version (ADR-058).                                                  | MVP      | 0.1.0; upgrades 0.2.0 |
| FR-TABLE-03 | GMs invite users by generating a table invite link with a role (`player`, `spectator`, `assistant`). Links can expire and be revoked.                                                                         | MVP      | 0.1.0                 |
| FR-TABLE-04 | GMs change member roles and remove members. Removing a member keeps their characters, which become unowned.                                                                                                   | MVP      | 0.1.0                 |
| FR-TABLE-05 | A user may belong to multiple tables and set a default character per table.                                                                                                                                   | MVP      | 0.1.0                 |
| FR-TABLE-06 | GMs and assistants can archive a table (read-only, still exportable in the future).                                                                                                                           | v1       | 0.2.0                 |
| FR-TABLE-07 | Only the table GM can change table settings, roles, and system-level options.                                                                                                                                 | MVP      | 0.1.0                 |
| FR-TABLE-08 | The table opens as a full-page workspace: a centre stage (sheet, journal entry or map) and collapsible, resizable panels for chat, actors, items, journal and combat. On phones each panel opens full screen. | 1.0      | 0.3.0 (ADR-059)       |

### 7.3 Actors and items (`FR-ENT`)

| ID        | Requirement                                                                                                                                                               | Priority | Status |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-ENT-01 | GMs and players can create actors of any type declared by the table's plugin. Players may create only types with `controlledBy: "player"` unless the GM allows otherwise. | MVP      | 0.1.0  |
| FR-ENT-02 | Actors have a name, image URL, and ownership (default level plus per-user levels).                                                                                        | MVP      | 0.1.0  |
| FR-ENT-03 | Ownership levels: `none`, `observer` (read), `owner` (read and edit). GMs are implicit owners of all actors.                                                              | MVP      | 0.1.0  |
| FR-ENT-04 | Actors can be duplicated, deleted (soft delete with restore for 30 days), and listed with search and type filters.                                                        | MVP      | 0.1.0  |
| FR-ENT-05 | Items exist in a table-level library. Items can be copied into an actor, creating an owned item with a `sourceId`.                                                        | MVP      | 0.1.0  |
| FR-ENT-06 | Items have a name, image URL, and plugin-defined data, edited on an item sheet (ADR-062).                                                                                 | MVP      | 0.3.0  |
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
| FR-SHEET-11 | Sheet history: the last 50 snapshots per actor are retained for recovery.                                                                                                                   | v1       | 0.2.0  |
| FR-SHEET-12 | An actor sheet lists the actor's items and edits them in place (an `items` node), with open, remove and add; items can be dropped onto it.                                                  | 1.0      | 0.3.0  |

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
| FR-CHAT-09 | Messages can be edited or deleted by their author within 5 minutes; GMs can delete any message.                                                                    | v1       | 0.2.0  |

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

| ID           | Requirement                                                                                                                                                                                   | Priority | Status                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- |
| FR-PLUGIN-01 | Plugins are folders placed in `DATA_DIR/plugins/`. A restart or admin "rescan" makes them available. No rebuild is needed.                                                                    | MVP      | 0.1.0                        |
| FR-PLUGIN-02 | Plugin manifests and all JSON files are validated against the plugin schemas. Errors are reported with file and JSON path.                                                                    | MVP      | 0.1.0                        |
| FR-PLUGIN-03 | Plugins declare `coreApi` as a semver range. Incompatible plugins are listed as disabled with the reason.                                                                                     | MVP      | 0.1.0                        |
| FR-PLUGIN-04 | Plugin CSS is scoped by the loader (see §8.6).                                                                                                                                                | MVP      | 0.1.0                        |
| FR-PLUGIN-05 | Plugin language files (`lang/*.json`) are merged into the UI, with fallback to English.                                                                                                       | MVP      | 0.1.0                        |
| FR-PLUGIN-06 | Plugins containing a `code/` folder are flagged as "includes code" in the admin UI. Admins must enable them explicitly.                                                                       | MVP      | 0.1.0                        |
| FR-PLUGIN-07 | A plugin can be enabled or disabled per instance by an admin. Tables using a disabled plugin become read-only.                                                                                | MVP      | 0.1.0                        |
| FR-PLUGIN-08 | Plugin-owned code (`code/`) runs in-process and is trusted in v1. Sandboxing is out of scope for v1.                                                                                          | MVP      | 0.1.0 (`code/client`); 0.2.0 |
| FR-PLUGIN-09 | Plugin compendium packs (`packs/*.json`) are browsable by every member. GMs and assistants copy chosen entries into the table; players copy items onto actors they own.                       | v1       | 0.3.0 (browser, ADR-060)     |
| FR-PLUGIN-10 | Plugins can declare slash commands and chat handlers in `code/`.                                                                                                                              | v1       | 0.2.0                        |
| FR-PLUGIN-11 | Item types may declare a `group` and a plural label; lists of items (library, actor, compendium) are grouped by them, so a system can show "Spells" and "Gear" (Q16).                         | 1.0      | 0.3.0 (ADR-061)              |
| FR-PLUGIN-12 | Plugins can ship data migrations that run when a GM upgrades a table to a new system version, and bring each entity's `dataVersion` up to date.                                               | 1.0      | planned (M15)                |
| FR-PLUGIN-13 | `code/client` runs sandboxed (no access to the app's DOM, cookies or APIs except through the SDK bridge); `code/server` runs with no Node APIs reachable.                                     | 1.0      | planned (M15)                |
| FR-PLUGIN-14 | Admins can build a declarative system (types, schemas, sheets, rolls, lang) in the browser and install or download it as a plugin.                                                            | 1.0      | planned (M16)                |
| FR-PLUGIN-15 | Item types declare values they contribute to their holder (`contributes`); actor formulas read the combined totals (`@items.hpBonus`), and rolls read the item they were made with (`@item`). | 1.0      | 0.3.0                        |

### 7.9 Combat (`FR-COMBAT`) — v1

| ID           | Requirement                                                                                                                      | Priority | Status |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| FR-COMBAT-01 | GM creates an encounter, adds combatants (actors or free-form entries), and runs initiative.                                     | v1       | 0.2.0  |
| FR-COMBAT-02 | Initiative is rolled using the plugin's `combat.json` formula, with ordering rule `desc`, `asc`, or `sideBased`, or a code hook. | v1       | 0.2.0  |
| FR-COMBAT-03 | Turn advance and round counter are broadcast to all members.                                                                     | v1       | 0.2.0  |
| FR-COMBAT-04 | Combatant visibility respects actor ownership and hidden status.                                                                 | v1       | 0.2.0  |

### 7.10 Settings and administration (`FR-ADMIN`)

| ID          | Requirement                                                                                                                       | Priority                   | Status                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------- |
| FR-ADMIN-01 | Instance settings: site name, registration policy (closed, invite-only), session lifetime, upload limits.                         | MVP                        | 0.1.0 (no upload limits, ADR-040) |
| FR-ADMIN-02 | Plugin admin page: list, enable, disable, rescan, view validation errors.                                                         | MVP                        | 0.1.0                             |
| FR-ADMIN-03 | Health endpoint `/api/health` reports DB status and plugin load status.                                                           | MVP                        | 0.1.0                             |
| FR-ADMIN-04 | Table settings page: name, description, house-rule options from the plugin's `settings.json`.                                     | MVP                        | 0.1.0                             |
| FR-ADMIN-05 | Backups: documented procedure to copy `vtt.sqlite` and `plugins/` safely (WAL checkpoint). Optional scheduled backup via env var. | MVP (doc) / v1 (automated) | 0.1.0 (doc); 0.2.0 (automated)    |

### 7.11 Maps and assets (`FR-MAP`, `FR-ASSET`)

| ID          | Requirement                                                                                                                                      | Priority | Status        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------- |
| FR-ASSET-01 | Members with permission upload images to the instance; files are type-checked, size-limited and counted against a per-instance quota.            | 1.0      | planned (M13) |
| FR-ASSET-02 | An asset manager lists a table's assets and picks them for actor and item images, journal entries and scene backgrounds.                         | 1.0      | planned (M13) |
| FR-ASSET-03 | Backups include the uploaded assets.                                                                                                             | 1.0      | planned (M13) |
| FR-MAP-01   | GMs create scenes with a background image and a square or hex grid, and choose the scene players see.                                            | 1.0      | planned (M14) |
| FR-MAP-02   | The scene renders on a canvas in the workspace centre, with pan and zoom, on desktop and phone.                                                  | 1.0      | planned (M14) |
| FR-MAP-03   | Tokens represent actors (or stand alone) on a scene. Owners move their tokens, GMs move any; moves show live. Hidden tokens never reach players. | 1.0      | planned (M14) |
| FR-MAP-04   | Fog of war: GMs reveal and hide areas; players receive only what is revealed, enforced on the server.                                            | 1.0      | planned (M14) |

`img` fields stay plain URL strings; an uploaded asset has a URL of its own, so nothing that stores images changes shape.

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
│  └─ items/<type>.json     item type: schema, defaults, derived, sheet, group
├─ sheets/<name>.json       layout trees (referenced by types)
├─ rolls.json               roll recipes and outcomes (optional)
├─ dice.json                custom dice (optional)
├─ combat.json              initiative formula and ordering (optional; validated, used from M9, §8.14)
├─ settings.json            per-table options (optional)
├─ cards/<name>.json        chat card templates (optional)
├─ lang/<locale>.json       translations, English required if any lang file exists
├─ styles/<name>.css        scoped CSS (optional)
├─ packs/<name>.json        compendium packs (optional; §8.14)
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

A type file declares the entity's data as a subset of JSON Schema, derived values (formulas without dice, never stored), its sheet, for actors who may create it (`controlledBy`), and for items the group that item lists show them under (`group`, `labelPlural`, `order`, ADR-061). `x-` annotations choose how the core stores each field, which is what the live document model (§9) builds on: `x-kind` (`longText`, `richText`, `collection`, `image`), `x-counter` (§9.5) and `x-layer: "secret"` (§9.3). Rules: [guide, Actor and item types](docs/plugin-authoring.md#actor-and-item-types); keys: [reference, Actor type](docs/plugin-reference.md#actor-type) and [Item type](docs/plugin-reference.md#item-type).

### 8.5 Sheets (layout JSON)

A sheet is a tree of built-in nodes (containers, fields, lists, roll buttons, derived values, text, images) plus `custom:<name>` nodes from plugin code. `visibleIf` hides nodes with a formula, but secrecy is enforced by the server, not by layout: secret fields never reach players (§9.3). Nodes: [guide, Sheets](docs/plugin-authoring.md#sheets); keys: [reference, Sheet layout](docs/plugin-reference.md#sheet).

### 8.6 Scoped CSS

The server scopes plugin stylesheets with PostCSS (in `plugin-schema`, ADR-021) and caches the result under `DATA_DIR/cache`: selectors are prefixed with `[data-plugin="<id>"]`, rules go in `@layer plugin`, sheets get `contain: layout paint`, and anything that could reach outside the plugin is removed with a warning. Rules and styling hooks: [guide, Styles](docs/plugin-authoring.md#styles).

### 8.7 Rolls

`rolls.json` holds recipes: a formula rolled on the server against the entity's current data, ordered outcomes, and an optional chat card. Buttons pass arguments as `@args.*`. A `handler` recipe calls a function in `code/server` instead (§8.10, ADR-047). Rules: [guide, Rolls](docs/plugin-authoring.md#rolls); keys: [reference, Roll recipes](docs/plugin-reference.md#rolls).

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

Three entries, each optional: `code/shared` (`defineShared`: formula functions), `code/client` (`defineClient`: sheet nodes and chat cards) and `code/server` (`defineServer`: handler recipes, slash commands and combat hooks). Working examples: [guide, Plugin code](docs/plugin-authoring.md#plugin-code).

**Status:** `code/client` runs in the browser with `defineClient` and the hooks of `@vtt/sdk/client` (ADR-025). `code/shared` and `code/server` run on the server in a worker thread per plugin, with time limits (ADR-047); the browser loads `code/shared` too, for sheets. Combat calls the hooks `onTurnStart` and `orderCombatants` (ADR-050). In handlers, `ctx.roll(formula)` rolls against the recipe's actor, and `ctx.chat.post` posts `roll` or `text` messages rather than cards (ADR-047). [Guide, Plugin code](docs/plugin-authoring.md#plugin-code).

Rules:

- Server code receives a restricted `ctx` with: `roll`, `chat.post`, `actors.get`, `actors.adjust` (validated writes only), `log`. It acts with the roller's rights, and has no database handle and no filesystem access.
- Client code receives only `@vtt/sdk/client` hooks (`useField`, `useDerived`, `useActor`, `useTranslate`). It cannot open sockets or call arbitrary APIs. It imports `react`, `react/jsx-runtime` and `@vtt/sdk/client` by name; the app's import map resolves them to its own copies (ADR-025).
- Shared code is pure and must pass the same lint boundaries as `packages/formula`.
- Custom nodes must be pure rendering: they read via hooks and write via `useField` setters.
- **Trust model:** `code/` is trusted (Q1); server code is contained in a worker per plugin (ADR-047), not sandboxed. Installing a plugin with code requires explicit admin enablement. The admin UI lists the code entry points.

### 8.11 Chat cards

A card lays out a recipe's roll in chat with formula rows that read the roll; a client component of the same name replaces it. [Guide, Chat cards](docs/plugin-authoring.md#chat-cards); [reference, Chat card](docs/plugin-reference.md#card).

### 8.12 Settings

`settings.json` declares per-table options (house rules) that the GM sets on the table settings page and formulas read as `@settings.<name>` (ADR-039). [Guide, Table settings](docs/plugin-authoring.md#table-settings); [reference, Settings](docs/plugin-reference.md#settings).

### 8.13 Plugin validation and CLI

The server runs the same validation as `vtt-plugin validate` on install and on rescan. The CLI (`packages/plugin-cli`) validates, previews (`dev`), packs to `.vttplugin` archives (ADR-026) and emits JSON Schemas. It is not published; authors run it from a build of this repository (ADR-045, Q15). [Guide, Checking, previewing and installing](docs/plugin-authoring.md#checking-previewing-and-installing).

### 8.14 Combat and pack files

Reserved in 0.1.0, built in 0.2.0:

- **`combat.json`** (M9, T-0802): `initiative`, a rolling formula each combatant rolls, and `order`: `desc`, `asc` or `sideBased`. Built in T-0802 (ADR-050): [guide, Combat](docs/plugin-authoring.md#combat). An `orderCombatants` hook in `code/server` may order combatants instead (FR-COMBAT-02), and `onTurnStart` runs at the start of each turn (§8.10).
- **`packs/<name>.json`** (M10, T-0803): compendium entries of the plugin's own actor and item types, each validated against its type's data schema, which members browse and copy into a table or onto their actors (FR-PLUGIN-09). Built in T-0803 (ADR-051); browsed since T-1202 (ADR-060): [guide, Compendium packs](docs/plugin-authoring.md#compendium-packs).

---

## 9. Live Document Model (CRDT)

### 9.1 Document naming

Every collaborative document is named `<kind>:<id>:<layer>`:

- `actor:<id>:main` — main sheet data
- `actor:<id>:secret` — GM/assistant-only data (only if the plugin declares secret fields)
- `item:<id>:main`, `item:<id>:secret` — an item's data, layered like an actor's (ADR-062)
- `journal:<id>:main` — journal entry body
- `ydocs` table holds binary state, keyed by name.

Parsing the name is the only way the auth hook derives the entity and layer; the name is never trusted for anything beyond routing.

### 9.2 Document structure

```
actor:<id>:main, actor:<id>:secret, item:<id>:main, item:<id>:secret
 └─ data   Y.Map   the layer's schema fields: objects → nested Y.Map; x-kind longText → Y.Text;
                   x-kind richText → Y.XmlFragment (TipTap blocks, ADR-037);
                   collection → Y.Map keyed by row id, each row with a `sort` value;
                   everything else → plain values
journal:<id>:main
 └─ body   Y.XmlFragment   the entry's rich text (ADR-038)
```

Items are rows in the `items` table, owned ones with an `actorId` (ADR-015); each item has documents of its own, never a part of its actor's (ADR-062). Data the layout does not know stays in `main` (ADR-029).

### 9.3 Access rules (server-enforced)

| Document                   | none   | observer  | owner      | assistant  | gm         |
| -------------------------- | ------ | --------- | ---------- | ---------- | ---------- |
| `actor:*:main`             | reject | read-only | read/write | read/write | read/write |
| `actor:*:secret`           | reject | reject    | reject     | read/write | read/write |
| `item:*:main` (owned)      | reject | read-only | read/write | read/write | read/write |
| `item:*:secret`            | reject | reject    | reject     | read/write | read/write |
| `journal:*:main` (visible) | reject | read-only | read/write | read/write | read/write |
| `journal:*:main` (hidden)  | reject | reject    | reject     | read/write | read/write |

Notes:

- An owned item's columns are its actor's ownership levels. A library item's main document is read-only for players and spectators and read/write for GMs and assistants (ADR-062).
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
- A store also keeps a copy of an actor document for its sheet history, at most every 5 minutes; the newest 50 per document stay (FR-SHEET-11, ADR-053).

### 9.7 Validation and repair

- Values written by clients are validated against the schema on input (client) and on persist (server).
- Invalid values on persist are replaced with the schema default and logged. The editor receives a `validation` message (ADR-031). Journal bodies are not repaired.
- Schema changes on a plugin version bump are **not** auto-migrated. Actors and items store the system version they were created with (`dataVersion`); missing fields read as their defaults. A table keeps its system version until a GM upgrades it to the installed one; an actor sheet whose `dataVersion` differs from its table's shows a notice (ADR-058). Migrations are LATER (see §7.11).

---

## 10. API and Realtime Contracts

### 10.1 REST

- Base path `/api/v1`. JSON bodies. Validated with Zod on entry.
- Errors use `{ error: { code, message, details? } }` with stable `code` strings.
- Actor, item and journal lists page with `?limit=…&cursor=…` and answer `nextCursor`; without `limit` they return the whole list (ADR-057). Chat history pages backwards with `?before=…`.
- Auth: session cookie. Mutating requests require a CSRF header (`X-CSRF-Token`) matched to the session.

Key resource groups:

| Group           | Endpoints (illustrative)                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth            | `POST /auth/login`, `POST /auth/logout`, `GET/PATCH /me`, `POST /me/password`                                                                                                                                     |
| Setup           | `GET /setup/status`, `POST /setup/admin`                                                                                                                                                                          |
| Users (admin)   | `GET /users`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id`                                                                                                                                              |
| Tables          | `GET /tables`, `POST /tables`, `GET /tables/:id`, `PATCH /tables/:id`, `GET /tables/:id/types`, `POST /tables/:id/archive`, `POST /tables/:id/unarchive` (ADR-054), `POST /tables/:id/upgrade-system` (ADR-058)   |
| Members         | `GET /tables/:id/members`, `PATCH /tables/:id/members/:userId`, `DELETE …`                                                                                                                                        |
| Invites         | `GET/POST /tables/:id/invites`, `DELETE /tables/:id/invites/:inviteId`, `GET /invites/:token`, `POST /invites/:token/accept`, `POST /invites/:token/signup` (ADR-040)                                             |
| Instance        | `GET /instance` (public), `GET/PATCH /admin/settings` (admin; ADR-040)                                                                                                                                            |
| Actors          | `GET /tables/:id/actors`, `POST …`, `GET/PATCH/DELETE /actors/:id`, `POST /actors/:id/duplicate`, `POST /actors/:id/restore`, `GET /actors/:id/history`, `POST /actors/:id/history/:snapshotId/restore` (ADR-053) |
| Items           | `GET /tables/:id/items`, `POST …`, `GET/PATCH/DELETE /items/:id`, `GET/POST /actors/:id/items`, `POST /items/:id/restore`                                                                                         |
| Journal         | `GET /tables/:id/journal`, `POST …`, `GET/PATCH/DELETE /journal/:id`, `POST /journal/:id/restore` (ADR-038)                                                                                                       |
| Compendium      | `GET /tables/:id/compendium`, `POST /tables/:id/compendium/copy` (ADR-060)                                                                                                                                        |
| Chat            | `GET /tables/:id/messages?before=…`, `POST /tables/:id/messages`, `PATCH`/`DELETE /messages/:id` (ADR-052)                                                                                                        |
| Systems         | `GET /systems`, `GET /systems/:id` (definition, styles and client code of an available system, ADR-025)                                                                                                           |
| Rolls           | `POST /tables/:id/rolls` (a formula or a recipe with arguments; ADR-018, ADR-025)                                                                                                                                 |
| Plugins (admin) | `GET /plugins`, `POST /plugins/:id/enable`, `POST /plugins/:id/disable`, `POST /plugins/rescan` (ADR-020), `POST /plugins/install` (ADR-026)                                                                      |
| Health          | `GET /api/health`                                                                                                                                                                                                 |

### 10.2 Events WebSocket (`/ws/events`)

- Authenticated during the HTTP upgrade using the session cookie.
- JSON messages in an envelope: `{ "v": 1, "type": "…", "tableId": "…", "payload": { … }, "id": "…" }`.
- Client → server: `subscribe`, `unsubscribe`, `chat.send`, `roll.request`, `presence.ping`.
- Server → client: `chat.message` (rolls are messages of kind `roll`, ADR-018), `chat.updated` and `chat.deleted` (ADR-052), `entity.changed`, `table.updated` (ADR-039), `combat.updated` (ADR-049), `ack`, `error`. A client message with an `id` is answered by `ack` or `error` carrying `replyTo` (ADR-016).
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

### M8–M11 — Plugin code, combat, content, operations (released as 0.2.0)

All done; the task lists with their notes are in [`docs/history/0.2.0.md`](docs/history/0.2.0.md).

| Milestone | Tasks                                  | Scope                                                                     |
| --------- | -------------------------------------- | ------------------------------------------------------------------------- |
| M8        | T-0809, T-0804                         | Plugin shared and server code in workers, handler recipes, slash commands |
| M9        | T-0801, T-0802                         | Combat tracker, initiative from `combat.json`, combat hooks               |
| M10       | T-0803, T-0805, T-0806, T-0807, T-0808 | Compendium packs, chat edits, sheet history, table archive, backups       |
| M11       | T-0811, T-0812, T-0813                 | arm64 image, list pagination, data version notice and table upgrades      |

### M12 — Table workspace, compendium and inventories (0.3.0)

The table becomes a full-page workspace, ready for maps in M14, and the compendium becomes a browser instead of a whole-pack import. Items get sheets of their own, then a place on actor sheets: an inventory, equipped and prepared state, bonuses in derived values and rolls made with an item (ADR-063).

- [x] **T-1201 · Full-page workspace**
  - **Deps:** none
  - **Do:** The table route leaves the app shell and fills the viewport (FR-TABLE-08). A centre stage shows the open sheet or journal entry (and the map from M14). Chat, actors, items, journal and combat become panels that collapse and resize; their layout is remembered per user and table. On phones each panel opens full screen, keeping T-0511's sheet route. Keyboard users can move between panels (NFR-10).
  - **Done when:** e2e opens a table on desktop and phone, collapses and resizes panels, reloads and finds the same layout; every current table feature works from the workspace; the existing e2e suite passes on it.

- [x] **T-1202 · Compendium browser**
  - **Deps:** none
  - **Do:** Replace the whole-pack import (ADR-051 §5, §7) with a browser, in a new ADR (FR-PLUGIN-09). `GET /tables/:id/compendium` lists the entries of every pack of the system, with search, pack and type filters, paged as in ADR-057, readable by every member; each entry says whether the table has it already (`pack_ref`). `POST /tables/:id/compendium/copy` takes chosen entries: GMs and assistants copy actors and items into the table; players copy items onto actors they own. Copies keep `pack_ref`. The web shows the compendium as a panel of the workspace, with entry previews. The import endpoints are removed.
  - **Done when:** endpoint tests cover listing, filters, paging, copying by role and the "already in the table" mark; a player copies a pack item onto their character and a GM copies an actor, in e2e.

- [x] **T-1203 · Item groups**
  - **Deps:** Q16
  - **Do:** Item types may declare a `group` (lang key or text) and a `labelPlural` (FR-PLUGIN-11). The schema, validator and generated reference document them. The items panel, an actor's items and the compendium list items under their groups, in the order the plugin declares. `tiny-d20` adds a `spell` item type in a "Spells" group, with a pack entry or two.
  - **Done when:** validator tests cover the new keys; web tests show grouped lists; tiny-d20's spells appear under "Spells" in the items panel, on a character and in the compendium.

- [x] **T-1204 · Item sheets**
  - **Deps:** T-1201
  - **Do:** Items open on a live sheet of their own (FR-ENT-06), which no release had: item data could not be edited. Each item gets `item:<id>:main` and, with secret fields, `item:<id>:secret`; library items are edited by GMs and assistants, owned items follow their actor. Items open as workspace panels from the items panel and from an actor's items. Owned items stay out of the actor document (ADR-062).
  - **Done when:** server tests cover item document access, stores and cascades; web tests open library and owned items; e2e shows a GM's edit reaching a player's read-only item sheet, and a player editing their own copy.

- [x] **T-1205 · Item contributions**
  - **Deps:** T-1204
  - **Do:** Item types may declare `contributes`: named values, each a `formula` over the item's own main-layer data and derived values, with a `combine` (`sum`, `max`, `min`, `any`, `count`; `max` and `min` declare a `default`). Actor formulas read the totals over the actor's live items as `@items.<name>` (FR-PLUGIN-15). The validator gathers the names, requires types sharing a name to agree on `combine` and value type, checks `@items.<name>` like `@derived`, keeps contributions off secret fields and refuses `@items` in item formulas. The rules engine computes the totals; the server joins item data (live, stored, projection) for rolls, combat and plugin code, and the SDK reads the totals. An actor holds at most 500 items (ADR-063).
  - **Done when:** validator tests cover contributions, shared names and their mismatches, unknown `@items` names and secret reads; engine tests cover each combine with and without items; server tests show a roll's derived value seeing an item edit before it is stored; a tiny-d20 armour adds to AC on the server.
- [x] **T-1206 · Items on actor sheets**
  - **Deps:** T-1205
  - **Do:** An `items` sheet node lists the actor's items of `itemTypes`, grouped, each row laid out by `item` with paths into the item's data and `@item.name/type/id` (FR-SHEET-12). Row inputs edit the item's live document; the sheet computes contributions from the open documents, so derived values follow at once. Open, remove and add (from the library), and dropping library or compendium rows onto the node.
  - **Done when:** validator tests check row paths against every listed type; web tests render, edit and add rows, read-only for observers, with a derived value following a checkbox; e2e shows a player equipping armour and AC changing on the GM's open sheet.
- [x] **T-1207 · Rolls with an item**
  - **Deps:** T-1206
  - **Do:** Recipes may declare `item` types and read `@item`; a roll button in an `items` row, or on an owned item's sheet, rolls as the holder with that item (`itemId` in the roll request, checked against the actor). Library item sheets keep no roll (ADR-063).
  - **Done when:** validator tests cover `@item`; server tests refuse an item another actor holds; e2e shows an attack from a weapon row with the weapon's damage on the card.
- [ ] **T-1208 · tiny-d20 inventory**
  - **Deps:** T-1207
  - **Do:** tiny-d20 gets armour (`equipped`, `acBonus`) contributing to an AC derived value while equipped, a gear list with an Attack per weapon, and prepared spells contributing to a prepared count on the character sheet; the pack gains armour. The guide's tutorial gains an inventory step.
  - **Done when:** the reference plugin validates; e2e on all three browsers: equip armour, prepare a spell, attack with a weapon.

### M13 — Assets (0.4.0)

Uploads, so maps and sheets need no outside image hosting.

- [ ] **T-1301 · Asset storage and uploads**
  - **Deps:** none
  - **Do:** An `assets` table and files under `DATA_DIR/assets` (FR-ASSET-01, FR-ASSET-03). Uploads are checked by content (PNG, JPEG, WebP, GIF, SVG sanitised or refused), limited in size and by an instance quota set in the admin settings (finishing FR-ADMIN-01's upload limits). Each asset belongs to a table; GMs and assistants upload, and members of the table read. Files are served with the CSP and long cache headers. Backups and their restore include the assets folder.
  - **Done when:** endpoint tests cover types, limits, quota, permissions and serving; a backup taken with assets restores them; the security review notes for uploads are written down in the ADR.

- [ ] **T-1302 · Asset manager**
  - **Deps:** T-1301
  - **Do:** A workspace panel lists a table's assets with thumbnails, uploads by picking or dropping files, and deletes unused ones (FR-ASSET-02). Image fields (actor and item images, journal images) open it as a picker that also accepts a URL.
  - **Done when:** web tests cover upload, pick and delete; e2e uploads an image and sets it as an actor's portrait.

### M14 — Maps and tokens (0.5.0)

Scenes with a grid, tokens and fog of war, in the workspace centre.

- [ ] **T-1401 · Scenes**
  - **Deps:** T-1301
  - **Do:** A `scenes` table (FR-MAP-01): name, background asset, size, grid type (square, hex) and size, and which scene is active for players. GMs and assistants create, edit, order and delete scenes; `scene.updated` events keep clients current. Players only see the active scene.
  - **Done when:** endpoint tests cover the scene life cycle, permissions and events.

- [ ] **T-1402 · Map canvas**
  - **Deps:** T-1201, T-1401, Q18
  - **Do:** The scene renders in the workspace centre on a canvas (FR-MAP-02), with the renderer chosen in Q18 (an ADR): background, grid, pan and zoom by mouse, keyboard and touch. Rendering stays smooth on a mid-range phone.
  - **Done when:** web tests cover the scene model behind the canvas; e2e pans and zooms on desktop and phone viewports; a performance check with a large background and 100 tokens is recorded.

- [ ] **T-1403 · Tokens**
  - **Deps:** T-1402
  - **Do:** Tokens link to an actor (taking its image and name) or stand alone (FR-MAP-03). GMs place, hide and remove tokens; owners of the actor move its tokens; moves snap to the grid and show live to everyone who may see them. Hidden tokens are filtered on the server and never sent to players (NFR-08). Opening a token opens its actor's sheet in the workspace.
  - **Done when:** endpoint and wire tests cover placement, movement permissions and hidden tokens; e2e has a GM and a player moving tokens in two browsers.

- [ ] **T-1404 · Fog of war**
  - **Deps:** T-1403
  - **Do:** GMs reveal and hide areas of a scene with shapes or grid cells (FR-MAP-04). Players receive only revealed areas, and tokens inside hidden areas are not sent to them. GMs see the fog as a tint.
  - **Done when:** wire tests prove hidden areas and the tokens in them never reach players; e2e reveals an area and a player sees it appear.

### M15 — Plugin platform (0.6.0)

Plugin data that follows system upgrades, and plugin code that runs contained.

- [ ] **T-1501 · Plugin data migrations**
  - **Deps:** none
  - **Do:** A plugin ships `migrations/` (FR-PLUGIN-12): declarative steps per version (rename, move, set default, drop a field) and, for what they cannot express, a `migrate` hook in `code/server`. When a GM upgrades a table (ADR-058), the steps between each entity's `dataVersion` and the new version run on its documents, in a transaction per entity, and `dataVersion` is updated, so the sheet notice clears. A failed migration leaves the entity as it was and reports it.
  - **Done when:** validator tests cover the migration files; tests upgrade reference plugin fixtures across two versions, including a failing step; the authoring guide has a migrations section.

- [ ] **T-1502 · Client code sandbox**
  - **Deps:** Q17
  - **Do:** `code/client` runs in a sandboxed iframe per plugin with the approach chosen in Q17, and reaches sheets only through the `@vtt/sdk/client` hooks over a message bridge (FR-PLUGIN-13). Custom nodes and cards keep working for the reference plugins.
  - **Done when:** tests show client code cannot read the app's DOM, cookies or fetch the API; the reference plugins' custom nodes and cards work as before.

- [ ] **T-1503 · Server code isolation**
  - **Deps:** none
  - **Do:** Plugin server code runs in an isolated runtime with no Node API reachable (no `require`, `process`, filesystem or network), keeping the worker per plugin and the time limits of ADR-047 (FR-PLUGIN-13).
  - **Done when:** tests show those APIs are unreachable from shared and server code; the reference plugins' handlers, commands and hooks pass unchanged.

### M16 — System builder (0.7.0)

Declarative systems built in the browser, for people who do not write plugins by hand (FR-PLUGIN-14).

- [ ] **T-1601 · Types and schemas builder**
  - **Deps:** none
  - **Do:** An admin page edits a draft system: manifest, actor and item types, their schemas with defaults and bounds, and derived values. Drafts are stored on the server and validated with the plugin validator as they change.
  - **Done when:** a draft equivalent to tiny-pool's types validates clean; web tests cover editing and validation errors.

- [ ] **T-1602 · Sheet layout editor**
  - **Deps:** T-1601
  - **Do:** A layout editor for the draft's sheets, adding and arranging layout nodes bound to schema fields, with a live preview through `sheet-renderer` on sample data.
  - **Done when:** tiny-pool's character sheet can be rebuilt in the editor; the preview matches the installed plugin's rendering in a test.

- [ ] **T-1603 · Rolls, translations and export**
  - **Deps:** T-1602
  - **Do:** The builder edits rolls and lang files, then packs the draft as a `.vttplugin` to download or installs it directly (ADR-026).
  - **Done when:** e2e builds a small system, installs it, creates a table with it and rolls from its sheet.

### M17 — 1.0 (1.0.0)

Stability promises, then the release.

- [ ] **T-1701 · Plugin API freeze**
  - **Deps:** M12–M16, Q19
  - **Do:** Set `CORE_API_VERSION` to `1.0.0` and document what 1.x keeps compatible (manifest, file formats, SDK, `ctx`). Plugins for 0.x load as Q19 decides. The reference plugins and the guide move to `^1.0.0`.
  - **Done when:** the compatibility promise is in the guide and an ADR; tests cover loading plugins declaring each supported range.

- [ ] **T-1702 · Upgrade guarantee**
  - **Deps:** M12–M16
  - **Do:** An automated test starts from a 0.2.0 data folder (database, plugins, documents), runs the 1.0 server on it and checks the tables, entities and documents survive. `docs/upgrading.md` explains upgrades and backups before them.
  - **Done when:** the test runs in CI; the guide is linked from the README.

- [ ] **T-1703 · Security review and hardening**
  - **Deps:** M12–M16
  - **Do:** Review the surfaces added since 0.2.0: uploads, scenes and tokens on the wire, fog filtering, the client sandbox, server isolation and the builder. Fix what is found, and record the review like T-0701.
  - **Done when:** the review document lists each surface with its checks; findings are fixed or recorded as accepted risks in §15.

- [ ] **T-1704 · Release 1.0.0**
  - **Deps:** T-1701, T-1702, T-1703
  - **Do:** Release as in §17 (item 10): versions to `1.0.0`, `CHANGELOG.md` section, tag `v1.0.0`.
  - **Done when:** the release job publishes the `1.0.0` and `1.0` image tags for both architectures and the GitHub release.

### LATER — Not scheduled

- World export and import
- Composition keywords (`$ref`, `oneOf`) in the schema subset
- Other plugin kinds: the reserved `module` kind, add-ons that extend a system (new types, sheets, packs or code) without replacing it
- A book-style journal view: entries laid out as pages, with text flowing onto the next page

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

Each open question blocks the tasks it names. Record the decision in `docs/adr/`, then move it to **Decided** below. A new question takes the next number. Code cites these numbers.

**Open**

| #   | Question                                                     | Blocks | Proposed default                                                                                                                        |
| --- | ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Q17 | How is `code/client` sandboxed?                              | T-1502 | A sandboxed `<iframe>` per plugin (no `allow-same-origin`), rendering its nodes and cards inside, with the SDK hooks over `postMessage` |
| Q18 | Which renderer draws maps?                                   | T-1402 | PixiJS (WebGL with canvas fallback), as LATER named it; React only for the panels around it                                             |
| Q19 | At 1.0, do plugins declaring `coreApi: ^0.1.0` keep loading? | T-1701 | Yes for one major version: 1.x accepts 0.x plugins whose files validate, and lists them with a "made for 0.x" note                      |

**Decided**

| #   | Question                                                                                                                                                                                                          | Decision                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Accept "trusted code only" for plugins in v1, or require sandboxing before release?                                                                                                                               | trusted only. Plugins with code are flagged and start disabled; an admin enables them (FR-PLUGIN-06, ADR-020). Sandboxing is LATER |
| Q2  | Should GMs be allowed to change a table's plugin after creation?                                                                                                                                                  | No (fixed); `PATCH` rejects it                                                                                                     |
| Q3  | TipTap for rich text, or a lighter editor?                                                                                                                                                                        | TipTap for `richText`; `longText` keeps the plain shared textarea (ADR-035, ADR-037)                                               |
| Q4  | Email-based invites, or link-only?                                                                                                                                                                                | Link-only (no SMTP dependency)                                                                                                     |
| Q5  | Is `tiny-pool` required for v0.1.0 or can it move to v1?                                                                                                                                                          | required; it shipped in 0.1.0 (T-0412)                                                                                             |
| Q6  | Soft-delete retention window: 30 days fixed, or configurable?                                                                                                                                                     | Configurable, default 30 (ADR-014)                                                                                                 |
| Q7  | Does Hocuspocus need its own port in development?                                                                                                                                                                 | no; one port, routed by upgrade path (§4.2)                                                                                        |
| Q8  | Formula parser: hand-written Pratt or Peggy/Chevrotain?                                                                                                                                                           | Hand-written Pratt (ADR-017)                                                                                                       |
| Q9  | Required Node version: current LTS at the time of M0?                                                                                                                                                             | Node 24 LTS, pinned in `.nvmrc`                                                                                                    |
| Q10 | `GET /systems/:id` sends a plugin definition, whose schema lives in `plugin-schema`, which `shared` may not import (§4.4). Where is its response schema?                                                          | `shared` types it as `record(unknown)`; the web parses it with `pluginDefinitionSchema` (ADR-025)                                  |
| Q11 | No M6 task names the journal UI. Is it built with T-0601, or later?                                                                                                                                               | later in M6, with T-0602 and T-0603; T-0601 is the server side (ADR-038)                                                           |
| Q12 | FR-ADMIN-01 names a registration policy and upload limits, but nobody can sign up and there are no uploads. What does T-0604 build?                                                                               | an `invite` policy lets invite links sign up; upload limits wait for uploads (ADR-040)                                             |
| Q13 | How is plugin server code contained in-process? A handler can loop forever or throw asynchronously. Options: a worker thread per plugin with a time limit, or `vm` contexts, or trusted code with try/catch only. | a worker thread per plugin, with time limits for functions and handlers, and `ctx` calls passed as messages (ADR-047)              |
| Q14 | Combat data model: an encounter as rows (encounters, combatants) updated through REST and events, or as a Yjs document like sheets?                                                                               | rows and events: turns are GM-driven, so live co-editing adds little (ADR-049)                                                     |
| Q15 | Publish the plugin CLI and SDK to npm?                                                                                                                                                                            | no. Plugin authors build them from this repository (ADR-045)                                                                       |
| Q16 | A spell in a compendium is an item of a plugin type `spell`. Should "item" be renamed, since items now cover spells, feats and gear?                                                                              | no rename. "Item" stays the core term; plugins name what players see through type labels and item groups (FR-PLUGIN-11, ADR-061)   |

---

## 15. Risks

| Risk                                                | Likelihood                   | Impact | Mitigation                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout JSON becomes too limited for a real system   | Low                          | High   | Two reference systems and a reader test built systems with it in 0.1.0; `custom:` nodes as escape hatch                                                                                                                                                                                 |
| CRDT + permissions bugs leak secret data            | Medium                       | High   | Wire-level tests (NFR-08), server-side checks on every update, secret docs separate from main                                                                                                                                                                                           |
| Trusted plugin code is a security hole              | High (if untrusted installs) | High   | Code plugins start disabled and are flagged; documented trust model; server code runs in a worker per plugin with time limits and a restricted `ctx` (ADR-047); sandboxing is LATER                                                                                                     |
| SQLite write contention under many active tables    | Low                          | Medium | WAL mode, batched projection writes, single writer; revisit at scale                                                                                                                                                                                                                    |
| Formula language scope creep                        | High                         | Medium | Fixed function whitelist, change requires an ADR                                                                                                                                                                                                                                        |
| Type drift between Zod, JSON Schema, and TypeScript | Medium                       | Medium | Single Zod source, emitted schemas snapshot-tested                                                                                                                                                                                                                                      |
| Mobile sheet UX is cramped                          | Low                          | Medium | Every workspace panel is a full-screen tab under 768 px (ADR-059, replacing T-0511's bar); phone e2e in CI                                                                                                                                                                              |
| Keyboard users cannot rearrange the workspace       | Medium                       | Medium | dockview's keyboard docking and resizing are paid modules (ADR-059); the default layout, tab strips and the Panels menu work by keyboard; revisit if the free packages gain them                                                                                                        |
| Yjs document growth over long campaigns             | Low                          | Medium | Periodic compaction on store; sheet history limited                                                                                                                                                                                                                                     |
| Upgrades between 0.x versions break stored data     | Medium                       | High   | Database migrations run on start; tables move to a new system version only when a GM upgrades them, and older sheets say so (ADR-058); plugin data migrations are LATER; `CHANGELOG.md` calls out breaking changes; operators pin image versions (ADR-046)                              |
| CI runners hang or flake, blocking releases         | Medium                       | Low    | Step time limits (browser install: 5 min); re-run before investigating; release job runs only after every check passes. Known intermittent e2e failures: `journal entries are hidden until the GM reveals them` and the concurrent rich-text step of `two browsers edit one live sheet` |
| Maps are slow or cramped on phones                  | Medium                       | Medium | One renderer with a measured budget (T-1402); full-screen map view on phones; performance check recorded per release                                                                                                                                                                    |
| Uploads are abused (size, malware, script in SVG)   | Medium                       | High   | Content sniffing, SVG refused or sanitised, size limits and a quota (T-1301); only table GMs and assistants upload; assets served under the CSP                                                                                                                                         |
| The system builder grows without end                | High                         | Medium | Scope fixed to what the declarative format already supports; no code editing in the builder; composition keywords stay LATER                                                                                                                                                            |

---

## 16. Decision Log (ADR index)

| ADR     | Decision                                                                                                                                        | Status                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| ADR-001 | Vite + React SPA instead of Next.js (realtime and runtime plugin loading)                                                                       | Accepted                                   |
| ADR-002 | Fastify server with Hocuspocus for Yjs, separate `/ws/events` for JSON events                                                                   | Accepted                                   |
| ADR-003 | SQLite + Drizzle, single data directory                                                                                                         | Accepted                                   |
| ADR-004 | Plugins are JSON-first; code is opt-in and trusted in v1                                                                                        | Accepted                                   |
| ADR-005 | TypeScript strict across all packages; ESLint flat config; Prettier                                                                             | Accepted                                   |
| ADR-006 | Id-keyed maps for collections in CRDT documents                                                                                                 | Accepted                                   |
| ADR-007 | Server-authoritative rolls; formulas never `eval`'d                                                                                             | Accepted                                   |
| ADR-008 | [Pin TypeScript to 6.0.x until typescript-eslint supports 7](docs/adr/ADR-008-typescript-6-pin.md)                                              | Accepted                                   |
| ADR-009 | [eslint-plugin-import-x instead of eslint-plugin-import (ESLint 10)](docs/adr/ADR-009-eslint-plugin-import-x.md)                                | Accepted                                   |
| ADR-010 | [One root ESLint config instead of per-package configs](docs/adr/ADR-010-single-root-eslint-config.md)                                          | Accepted                                   |
| ADR-011 | [M1 server decisions: plugins table, `TRUST_PROXY`, CSRF, last GM, permissions](docs/adr/ADR-011-m1-server-decisions.md)                        | Accepted                                   |
| ADR-012 | [Tailwind CSS 4 for core UI styling](docs/adr/ADR-012-tailwind-css.md)                                                                          | Accepted                                   |
| ADR-013 | [React Router framework mode (SPA), TanStack Form and a shared API contract](docs/adr/ADR-013-react-router-framework-mode-and-tanstack-form.md) | Accepted                                   |
| ADR-014 | [Entity persistence: retention, owned items, ownership defaults](docs/adr/ADR-014-entity-persistence.md)                                        | Accepted                                   |
| ADR-015 | [Actor and item REST API: type catalogue, ownership, trash, duplicate](docs/adr/ADR-015-actor-and-item-api.md)                                  | Accepted; §8 amended by ADR-062            |
| ADR-016 | [Events socket and chat: replies, session checks, audiences, history order](docs/adr/ADR-016-events-socket-and-chat.md)                         | Accepted                                   |
| ADR-017 | [Formula language: precedence, dice terms, custom dice names, errors, evaluation rules](docs/adr/ADR-017-formula-language.md)                   | Accepted                                   |
| ADR-018 | [Rolls in chat: roll messages, audiences, actor data, errors](docs/adr/ADR-018-rolls-in-chat.md)                                                | Accepted                                   |
| ADR-019 | [Plugin validation: one pure validator, issue codes, reference roots](docs/adr/ADR-019-plugin-validation.md)                                    | Accepted                                   |
| ADR-020 | [Plugin registry: scanning, status, enabling, read-only tables](docs/adr/ADR-020-plugin-registry.md)                                            | Accepted                                   |
| ADR-021 | [Scoped plugin CSS: scope, layer, at-rules, URLs, limits](docs/adr/ADR-021-scoped-plugin-css.md)                                                | Accepted                                   |
| ADR-022 | [Plugin file serving: access, allowed files, scoped CSS, headers](docs/adr/ADR-022-plugin-file-serving.md)                                      | Accepted                                   |
| ADR-023 | [Plugin engine: collections, defaults, derived values, recipes, cards, document layout](docs/adr/ADR-023-plugin-engine.md)                      | Accepted                                   |
| ADR-024 | [Sheet renderer: store, inputs, CSS hooks, phone layout, preview](docs/adr/ADR-024-sheet-renderer.md)                                           | Accepted                                   |
| ADR-025 | [Plugin host: system definitions, engine rolls and cards, import map, SDK client hooks](docs/adr/ADR-025-plugin-host.md)                        | Accepted                                   |
| ADR-026 | [Plugin CLI and archives: plugin-io, .vttplugin format, install endpoint, pack, dev](docs/adr/ADR-026-plugin-cli-and-archives.md)               | Accepted                                   |
| ADR-027 | [Reference plugins: tiny-d20 code, end-to-end path, gaps until M5–M7](docs/adr/ADR-027-reference-plugins.md)                                    | Accepted                                   |
| ADR-028 | [Collaboration socket: Hocuspocus behind @fastify/websocket, per-message access checks, frame limits](docs/adr/ADR-028-collab-socket.md)        | Accepted                                   |
| ADR-029 | [Document persistence and the Yjs mapping: ydocs, projection, unload delay](docs/adr/ADR-029-document-persistence.md)                           | Accepted                                   |
| ADR-030 | [Secret layer: filtered views and formulas, secret documents only for secret fields](docs/adr/ADR-030-secret-layer.md)                          | Accepted                                   |
| ADR-031 | [Counter adjustments and data repair over collab stateless messages](docs/adr/ADR-031-adjust-and-repair.md)                                     | Accepted                                   |
| ADR-032 | [The web app's live sheet store: Yjs SheetStore, one socket per sheet, server-side adjust](docs/adr/ADR-032-web-sheet-store.md)                 | Accepted                                   |
| ADR-033 | [Sheet presence over Yjs awareness: ids only, names and colors from the members](docs/adr/ADR-033-sheet-presence.md)                            | Accepted                                   |
| ADR-034 | [Collections under concurrent edits: server-created maps, ties broken by id](docs/adr/ADR-034-collection-concurrency.md)                        | Accepted                                   |
| ADR-035 | [Collaborative long text: a minimal shared textarea, TipTap deferred](docs/adr/ADR-035-shared-text.md)                                          | Accepted                                   |
| ADR-036 | [Pushing access changes to open documents: re-check after every change](docs/adr/ADR-036-access-revocation.md)                                  | Accepted                                   |
| ADR-037 | [Rich text with TipTap over a Y.XmlFragment; plain text as its JSON value](docs/adr/ADR-037-rich-text.md)                                       | Accepted                                   |
| ADR-038 | [Journal entries over REST and collab: hidden by default, 404 for hidden entries, a `body` fragment](docs/adr/ADR-038-journal-entries.md)       | Accepted                                   |
| ADR-039 | [Table settings checked against the system's house rules; `table.updated` event](docs/adr/ADR-039-table-settings.md)                            | Accepted                                   |
| ADR-040 | [Instance settings, invite sign-up and `/api/health`](docs/adr/ADR-040-instance-settings-and-health.md)                                         | Accepted                                   |
| ADR-041 | [UI languages: `pt-BR`, the catalogue check, and picking the language](docs/adr/ADR-041-ui-languages.md)                                        | Accepted                                   |
| ADR-042 | [Content Security Policy, security headers and the new rate limits](docs/adr/ADR-042-security-headers-and-limits.md)                            | Accepted                                   |
| ADR-043 | [The e2e suite on three browsers, one instance each](docs/adr/ADR-043-e2e-on-three-browsers.md)                                                 | Accepted                                   |
| ADR-044 | [The Docker image, and the server serving the web app](docs/adr/ADR-044-docker-image.md)                                                        | Accepted                                   |
| ADR-045 | [Plugin authoring guide and generated file reference](docs/adr/ADR-045-plugin-authoring-docs.md)                                                | Accepted                                   |
| ADR-046 | [Releases: version tags publish the image and the release notes](docs/adr/ADR-046-releases.md)                                                  | Accepted                                   |
| ADR-047 | [Plugin code runtime: a worker thread per plugin](docs/adr/ADR-047-plugin-code-runtime.md)                                                      | Accepted                                   |
| ADR-048 | [Plugin slash commands run like handler recipes](docs/adr/ADR-048-plugin-slash-commands.md)                                                     | Accepted                                   |
| ADR-049 | [Combat encounters are rows, refetched on `combat.updated`](docs/adr/ADR-049-combat-encounters-as-rows.md)                                      | Accepted                                   |
| ADR-050 | [Initiative, turn ordering and combat hooks](docs/adr/ADR-050-initiative-ordering-and-combat-hooks.md)                                          | Accepted                                   |
| ADR-051 | [Compendium packs import once into a table’s actors and items](docs/adr/ADR-051-compendium-packs.md)                                            | Accepted; §4, §5, §7 superseded by ADR-060 |
| ADR-052 | [Chat edits and deletes go to the message’s audience](docs/adr/ADR-052-chat-edit-delete.md)                                                     | Accepted                                   |
| ADR-053 | [Sheet history keeps copies of each actor document, restored in place](docs/adr/ADR-053-sheet-history.md)                                       | Accepted                                   |
| ADR-054 | [An archived table is read-only through the same checks as an unavailable system](docs/adr/ADR-054-table-archive.md)                            | Accepted                                   |
| ADR-055 | [The server takes scheduled backups when `BACKUP_DIR` is set](docs/adr/ADR-055-scheduled-backups.md)                                            | Accepted                                   |
| ADR-056 | [The image is built natively for amd64 and arm64 and merged into one tag](docs/adr/ADR-056-multi-arch-image.md)                                 | Accepted                                   |
| ADR-057 | [Actor, item and journal lists page by name with opaque cursors](docs/adr/ADR-057-list-pagination.md)                                           | Accepted                                   |
| ADR-058 | [GMs upgrade a table to its system's installed version, and sheets warn about older data](docs/adr/ADR-058-data-version-warning.md)             | Accepted                                   |
| ADR-059 | [The table is a dockview workspace with a single URL](docs/adr/ADR-059-table-workspace.md)                                                      | Accepted                                   |
| ADR-060 | [Members browse the compendium and copy chosen entries](docs/adr/ADR-060-compendium-browser.md)                                                 | Accepted                                   |
| ADR-061 | [Item types declare a group, and item lists show items under it](docs/adr/ADR-061-item-groups.md)                                               | Accepted                                   |
| ADR-062 | [Items are edited on live documents of their own](docs/adr/ADR-062-item-documents.md)                                                           | Accepted                                   |
| ADR-063 | [Actor sheets hold their items, and formulas read them](docs/adr/ADR-063-actor-inventories.md)                                                  | Accepted                                   |

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
11. **Past work:** task notes and change logs of released milestones are in `docs/history/`, one file per release (`mvp.md` for 0.1.0, `0.2.0.md`). Read them when a task touches code built then. After each release, move its milestones' tasks and change-log rows there.
