# ADR-013: React Router framework mode (SPA), TanStack Form and a shared API contract

- **Status:** Accepted
- **Date:** 2026-10-20
- **Task:** T-0111
- **Amends:** §4.1 "Frontend routing" (names the mode) and adds a forms decision

## Context

The first web shell used React Router in declarative mode, with guard components and hand-rolled form state (`useState` plus a submit hook). The project owner asked for TanStack Form, and for React Router's framework mode. M2+ adds many routes (`/tables/:id`, sheet windows) and forms (actors, items, journal), so the pattern is set now, while there are five routes and four forms. The owner also asked that the server and the web share the API's Zod schemas, which until then were written twice (route bodies on the server, a copy for forms and response checks on the web).

## Decision

- **React Router framework mode in SPA mode** (`ssr: false`, `apps/web/react-router.config.ts`). The `@react-router/dev` Vite plugin builds the app; routes are declared in `src/routes.ts`, modules live in `src/routes/`, and `react-router typegen` generates per-route types (`./+types/<route>`). There is still no SSR: the build writes static files to `build/client`, which the Fastify server will serve (§4.2).
- **Access rules run in `clientLoader`s** and redirect before a page renders. The rules are pure functions in `src/shell/access.ts`.
- **The session is a cached promise** (`src/shell/session.ts`). Child loaders run in parallel with the root loader, so they share that promise instead of the root's data. Login, setup, logout and profile changes update the cache; pages read the session from the root loader with `useSession()`.
- **Forms use `@tanstack/react-form`**, with the shared API request schemas (below) as validators through Standard Schema. Fields validate on change, but errors show only after the field is left or the form is submitted. Server errors show in the form's `Alert`.
- **The API contract lives in `@vtt/shared/api`** (`packages/shared/src/api/`): field limits, every request body the server parses, and the response shapes. The server parses bodies with them and builds responses with the inferred types (`PublicUser`, `TableView`); the web validates responses and runs its forms with the same schemas. URL params stay in the server routes.
- **The shared schemas carry no messages.** Zod prefers a schema's own message to the global map, so a message there would block translation. `describeIssue()` names each issue (`required`, `tooShort`, `tooLong`, `username`), and each app installs a `z.config({ customError })`: English on the server (`http/validation.ts`), the i18n catalogue on the web (`src/forms/zod-messages.ts`).
- **`@vtt/ui` stays form-library agnostic.** Adapters in `src/forms/fields.tsx` connect a TanStack field to `TextField` and `Select`.

## Consequences

- Client and server run the same rules, so they cannot drift; a field added on one side only fails `tsc`. The server stays the authority and re-validates every request.
- `@vtt/shared` now depends on `zod`. The contract is exported from the `./api` subpath, so packages that only need permissions do not load it.
- Route modules export `clientLoader`, `shouldRevalidate`, `HydrateFallback` and similar next to the component. The web package's ESLint config allows those names for `react-refresh` in `src/root.tsx` and `src/routes/`.
- Tests mount the real route modules with `createRoutesStub`, so loaders and redirects are covered without a browser.
- `isbot` is a dependency because the SPA build prerenders `index.html` with React Router's default server entry.
- Zustand remains for UI state (§4.1); it no longer holds the session.
