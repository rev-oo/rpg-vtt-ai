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

## Running with Docker

Releases are published as `ghcr.io/rev-oo/rpg-vtt-ai`, tagged by version (`0.1.0`, `0.1`); [`CHANGELOG.md`](CHANGELOG.md) lists what each one changed. From 0.2.0, each release runs on `linux/amd64` and `linux/arm64` (a Raspberry Pi 4 or 5, for example); 0.1.0 is amd64 only. To run one:

```bash
docker run -d -p 3000:3000 -v vtt-data:/data -e PUBLIC_URL=http://localhost:3000 ghcr.io/rev-oo/rpg-vtt-ai:0.1.0
```

To build the image from a checkout instead, use the example compose file:

```bash
docker compose -f docker/docker-compose.example.yml up -d --build
```

Open http://localhost:3000 and create the admin account. The data (database, plugins) lives in the one volume, `vtt-data`.

- **Public address:** behind a domain, set `PUBLIC_URL` in the compose file.
- **HTTPS:** [`docker/Caddyfile.example`](docker/Caddyfile.example) shows Caddy in front, with HTTPS and both WebSockets passed through.

The image runs as a non-root user and has a healthcheck on `/api/health`.

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
pnpm --filter @vtt/server start       # http://localhost:3000
```

After `pnpm build`, the server also serves the built web app. Without one, it serves the API only.

The server is configured with environment variables:

| Variable                     | Default                 | Meaning                                                                       |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `DATA_DIR`                   | `./data`                | Folder holding the SQLite database and plugins; see [backups](docs/backup.md) |
| `PORT`                       | `3000`                  | HTTP port                                                                     |
| `PUBLIC_URL`                 | `http://localhost:PORT` | Public URL, used for invite links; `https` makes session cookies Secure       |
| `SESSION_TTL`                | `604800` (7 days)       | Default session lifetime in seconds; admins can change it in the app          |
| `LOG_LEVEL`                  | `info`                  | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                |
| `TRUST_PROXY`                | `false`                 | Proxy hops to trust behind a reverse proxy, usually `1` (see below)           |
| `SOFT_DELETE_RETENTION_DAYS` | `30`                    | Days a deleted actor, item or journal entry can still be restored             |
| `WEB_DIR`                    | `apps/web/build/client` | The built web app to serve; when set, it must hold `index.html`               |
| `BACKUP_DIR`                 | unset                   | Turns on scheduled backups into this folder; see [backups](docs/backup.md)    |
| `BACKUP_INTERVAL_HOURS`      | `24`                    | Hours between scheduled backups                                               |
| `BACKUP_KEEP`                | `7`                     | Scheduled backups kept; older ones are removed                                |

Behind a reverse proxy, set `TRUST_PROXY` to the number of proxies in front of the server (`1` for a single Caddy or Traefik), so login and sign-up limits count the real client address. `true` trusts every `X-Forwarded-For` entry, which a client can write itself, so it can dodge those limits.

### Running the web app

With the server running, start the Vite dev server; it proxies `/api` to `VTT_API_URL` (default `http://localhost:3000`):

```bash
pnpm --filter @vtt/web dev            # http://localhost:5173
```

`GET /api/health` reports the database and the enabled plugins, and answers 503 when the database is unavailable.

Back up a running instance with `pnpm backup <folder>`; [docs/backup.md](docs/backup.md) covers taking and restoring backups.

On a fresh instance the app opens the setup screen. Creating a table needs an enabled system plugin: install one from **Plugins** in the admin menu, or copy a plugin folder into `DATA_DIR/plugins` and press **Rescan**.

### Writing plugins

The [plugin authoring guide](docs/plugin-authoring.md) walks through building a system from an empty folder, then covers the format file by file. Every key of every file is in the generated [plugin file reference](docs/plugin-reference.md).

`vtt-plugin` (from `packages/plugin-cli`) checks, previews and packs a plugin folder:

```bash
pnpm --filter @vtt/plugin-cli build
node packages/plugin-cli/dist/src/bin.js validate plugins/tiny-d20   # the server's checks
node packages/plugin-cli/dist/src/bin.js dev plugins/tiny-d20        # live sheet preview
node packages/plugin-cli/dist/src/bin.js pack plugins/tiny-d20       # tiny-d20-0.1.0.vttplugin
node packages/plugin-cli/dist/src/bin.js schema --out schemas        # JSON Schemas for editors
```

An admin installs the `.vttplugin` file from the plugin admin page.

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

Before the first `pnpm e2e`, install the browsers once: `pnpm --filter @vtt/e2e exec playwright install chromium firefox webkit`. The suite runs on all three, each against its own server and data folder; `E2E_BROWSERS=chromium pnpm e2e` runs just one.

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
  plugin-io/         Plugin folders and .vttplugin archives on disk (Node)
  plugin-cli/        `vtt-plugin` CLI: validate, dev, pack, schema
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
