# ADR-044: The Docker image, and the server serving the web app

- **Status:** Accepted
- **Date:** 2026-10-25
- **Tasks:** T-0703
- **Refines:** specs §4.2, ADR-043

## Context

Specs §4.2 has one Node process serving the API, both sockets, plugin files and the SPA. Until now nothing served the SPA in production: development uses the Vite dev server and e2e used `vite preview`. T-0703 needs an image that serves the app and completes setup on a clean machine. Docker is not installed on the development machine, so CI is where the image gets checked.

## Decision

1. **The server serves the built web app** (`apps/server/src/http/web-app.ts`, with `@fastify/static`).
   - `WEB_DIR` names the folder. It defaults to `apps/web/build/client` when that has been built. The server refuses to start if `WEB_DIR` names a folder without `index.html`.
   - Files under `assets/` have hashed names and are cached for a year. Everything else is revalidated with `no-cache`, since a new build reuses those names: `index.html` and the plugin runtime shims.
   - A GET or HEAD that matches no route gets `index.html`, so the app routes it, unless it is under `/api/`, `/ws/` or `/plugins/`, or its last segment looks like a file name. Those get the usual JSON 404.
2. **A 304 carries no Content-Security-Policy.** It has no content type, so the security-headers hook (ADR-042) gave it the data policy (`default-src 'none'`), and the browser applied that to the cached page on reload, which blocked every script. Now the browser keeps the stored page's policy.
3. **The image is two stages on `node:24-bookworm-slim`** (`docker/Dockerfile`).
   - **The builder:** fetches from the lockfile, installs, builds the server and the web app, and runs `pnpm deploy --prod` for the server. That copies its production dependencies with the workspace packages.
   - **Package `files`:** the server and every workspace package it uses now list their `files`, so the deploy carries `dist/src` (plus `drizzle` and the plugin schemas) and not tests, coverage or local data.
   - **The runtime:** copies the deploy and the web build. The code is owned by root, and the server runs as the image's `node` user (uid 1000) with `/data` as its one volume. A healthcheck polls `/api/health`.
   - No compiler is needed: `better-sqlite3` ships prebuilt binaries, and argon2 comes as a platform package.
4. **`docker/docker-compose.example.yml`** builds from the repository and publishes port 3000 with the `vtt-data` volume. **`docker/Caddyfile.example`** puts Caddy in front for HTTPS. Its `reverse_proxy` forwards both WebSockets with no extra settings.
5. **CI checks the image on every push and PR.** The Docker job starts the compose example, waits for the healthcheck, and runs `docker/smoke-test.sh`:
   - the page and an app route are served;
   - a fresh instance completes setup;
   - the server is not root;
   - the setup survives a restart.

   Publishing the image comes with the release (T-0705).

6. **e2e runs against the server serving the app**, as in production, instead of `vite preview` (refines ADR-043). Each browser still has its own instance.

## Consequences

- **Two bugs surfaced, both fixed:**
  - the 304 policy above, which would have broken every reload in production;
  - a race in counter steps: the first step on a counter that was not stored yet wrote `default + delta`, so two people stepping at once lost a step. The sheet now always asks the server to adjust (FR-SHEET-08), and the server starts a missing counter from its default.
- `pnpm --filter @vtt/server start` after `pnpm build` serves the whole app on one port.
- The image is built for the machine that builds it. Publishing images for several architectures is left to T-0705.
