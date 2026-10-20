# ADR-013: React Router framework mode (SPA) and TanStack Form

- **Status:** Accepted
- **Date:** 2026-10-20
- **Task:** T-0111
- **Amends:** §4.1 "Frontend routing" (names the mode) and adds a forms decision

## Context

The first web shell used React Router in declarative mode, with guard components and hand-rolled form state (`useState` plus a submit hook). The project owner asked for TanStack Form, and for React Router's framework mode. M2+ adds many routes (`/tables/:id`, sheet windows) and forms (actors, items, journal), so the pattern is set now, while there are five routes and four forms.

## Decision

- **React Router framework mode in SPA mode** (`ssr: false`, `apps/web/react-router.config.ts`). The `@react-router/dev` Vite plugin builds the app; routes are declared in `src/routes.ts`, modules live in `src/routes/`, and `react-router typegen` generates per-route types (`./+types/<route>`). There is still no SSR: the build writes static files to `build/client`, which the Fastify server will serve (§4.2).
- **Access rules run in `clientLoader`s** and redirect before a page renders. The rules are pure functions in `src/shell/access.ts`.
- **The session is a cached promise** (`src/shell/session.ts`). Child loaders run in parallel with the root loader, so they share that promise instead of the root's data. Login, setup, logout and profile changes update the cache; pages read the session from the root loader with `useSession()`.
- **Forms use `@tanstack/react-form`** with Zod schemas (`src/forms/schemas.ts`) as validators, through Standard Schema. Messages come from the i18n catalogue. Fields validate on change, but errors show only after the field is left or the form is submitted. Server errors show in the form's `Alert`.
- **`@vtt/ui` stays form-library agnostic.** Adapters in `src/forms/fields.tsx` connect a TanStack field to `TextField` and `Select`.

## Consequences

- Client rules mirror the server's, but the server stays the authority and re-validates every request.
- Route modules export `clientLoader`, `shouldRevalidate`, `HydrateFallback` and similar next to the component. The web package's ESLint config allows those names for `react-refresh` in `src/root.tsx` and `src/routes/`.
- Tests mount the real route modules with `createRoutesStub`, so loaders and redirects are covered without a browser.
- `isbot` is a dependency because the SPA build prerenders `index.html` with React Router's default server entry.
- Zustand remains for UI state (§4.1); it no longer holds the session.
