# VTT — a self-hostable virtual tabletop

A browser-based virtual tabletop for tabletop RPGs. The core provides only the infrastructure for running a game table (users, tables, actors, items, live character sheets, dice and chat). Everything specific to a game system, such as attributes, derived values, roll rules, sheet layouts and custom dice, comes from **plugins**, which are written mostly in JSON and scoped CSS.

Goals:

- **System-agnostic core:** no game rules are built in.
- **Live collaboration:** everyone with a sheet open sees edits in real time (Yjs CRDTs), with no save button.
- **Trustworthy dice and secrets:** rolls are computed on the server, and secret data never leaves the server for unauthorised users.
- **Easy self-hosting:** one container image and one data volume (SQLite), with no external services.

The full product spec, roadmap and progress tracker are in [`specs.md`](specs.md).

## Roadmap

Early development. Current status is tracked in the [Progress Tracker](specs.md#0-progress-tracker) in `specs.md`.

| Milestone | Scope                                                   |
| --------- | ------------------------------------------------------- |
| M0        | Foundation                                              |
| M1        | Core server: users, auth, tables, membership            |
| M2        | Entities and realtime: actors, items, events, chat      |
| M3        | Formula and dice engine                                 |
| M4        | Plugin system: loader, validator, scoped CSS, sheets    |
| M5        | Live sheets (CRDT): sync, presence, observer mode       |
| M6        | Journal, members, table settings, plugin admin          |
| M7        | Reference plugins, hardening, Docker, docs → **v0.1.0** |

## Tech stack

TypeScript (strict) everywhere · pnpm workspaces + Turborepo · React + Vite (React Router framework mode, SPA) · TanStack Form · Tailwind CSS 4 · Node.js + Fastify · WebSocket events + Hocuspocus/Yjs · SQLite via Drizzle · Zod · Vitest + Playwright · ESLint + Prettier.

## Getting started

Requirements:

- **Node.js 24 LTS.** The version is pinned in [`.nvmrc`](.nvmrc), so `nvm use` picks it up.
- **pnpm 12.** The version is pinned in `package.json`'s `packageManager` field; run `corepack enable pnpm` to use it.

```bash
nvm use
corepack enable pnpm
pnpm install          # also installs the git hooks
pnpm build
pnpm test
```

### Running the server

```bash
pnpm db:migrate                       # creates data/vtt.sqlite (also runs on start)
pnpm --filter @vtt/server start       # http://localhost:3000/api/v1
```

The server is configured with environment variables:

| Variable                     | Default                 | Meaning                                                                 |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `DATA_DIR`                   | `./data`                | Folder holding the SQLite database; back up by copying it               |
| `PORT`                       | `3000`                  | HTTP port                                                               |
| `PUBLIC_URL`                 | `http://localhost:PORT` | Public URL, used for invite links; `https` makes session cookies Secure |
| `SESSION_TTL`                | `604800` (7 days)       | Session lifetime in seconds                                             |
| `LOG_LEVEL`                  | `info`                  | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`          |
| `TRUST_PROXY`                | `false`                 | `true` or a hop count when running behind a reverse proxy               |
| `SOFT_DELETE_RETENTION_DAYS` | `30`                    | Days a deleted actor, item or journal entry can still be restored       |

### Running the web app

With the server running, start the Vite dev server; it proxies `/api` to `VTT_API_URL` (default `http://localhost:3000`):

```bash
pnpm --filter @vtt/web dev            # http://localhost:5173
```

On a fresh instance the app opens the setup screen. Creating a table needs an enabled system plugin; until the plugin scanner lands (M4), the e2e start script in `e2e/scripts/` shows how one is seeded.

## Scripts

Run these from the repository root. Turborepo runs the build, typecheck, lint and test scripts per package and caches the results.

| Command             | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `pnpm build`        | Builds every package                                     |
| `pnpm typecheck`    | Type-checks every package (`tsc -b`)                     |
| `pnpm lint`         | ESLint with zero warnings allowed                        |
| `pnpm test`         | Vitest per package, with coverage                        |
| `pnpm test:all`     | All Vitest projects in one run (handy in the editor)     |
| `pnpm format`       | Formats the repository with Prettier                     |
| `pnpm format:check` | Checks formatting (used by CI)                           |
| `pnpm e2e`          | Builds the apps and runs the Playwright suites in `e2e/` |

To run a task for one package, filter it: `pnpm turbo run test --filter @vtt/formula`.

Before the first `pnpm e2e`, install the browser once: `pnpm --filter @vtt/e2e exec playwright install chromium`.

## Repository layout

```
apps/
  server/            Fastify API, WebSockets, plugin loader (Node)
  web/               React + Vite single-page app
packages/
  shared/            Entity types, ids, permission rules, event protocol (pure)
  formula/           Formula parser, evaluator and dice engine (pure)
  plugin-schema/     Zod schemas for plugin files, emitted as JSON Schema
  plugin-engine/     Defaults, derived data, roll recipes (pure)
  ui/                Design tokens and UI primitives (React)
  sheet-renderer/    Sheet layout JSON → React
  sdk/               Public API for plugin code
  plugin-cli/        `vtt-plugin` CLI: validate, dev, pack
  config/            Shared tsconfig, ESLint and Vitest presets
plugins/             Reference game systems (tiny-d20, tiny-pool)
docs/adr/            Architecture decision records
e2e/                 Playwright suites
docker/              Container image and compose example
```

## Code quality rules

These are enforced by tooling, not just convention:

- **TypeScript strict,** plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **No `any` and no non-null assertions** outside tests.
- **Layer boundaries are linted.** Pure packages (`shared`, `formula`, `plugin-engine`) cannot import React, Fastify, Drizzle or Node built-ins. The server cannot import React packages. Packages never import apps. The rules live in [`packages/config/eslint/workspace.mjs`](packages/config/eslint/workspace.mjs); a new package has to be registered there.
- **Coverage gates:** at least 80% for `formula`, `plugin-engine` and the permission logic.
- **Pre-commit hook:** ESLint and Prettier run on staged files.
- **CI** (GitHub Actions) runs format, lint, typecheck, test and build on every push and pull request.

## Contributing

- Use [conventional commits](https://www.conventionalcommits.org/) and reference the task ID, e.g. `feat(formula): add dice keep modifiers (T-0303)`.
- Pick tasks from the tracker in [`specs.md`](specs.md) §0 and §12, and update the tracker when a task changes state.
- Record any decision that differs from the spec as an ADR in [`docs/adr/`](docs/adr/).
- AI coding agents should also read [`AGENTS.md`](AGENTS.md).
