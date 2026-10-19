# ADR-012: Tailwind CSS 4 for core UI styling

- **Status:** Accepted
- **Date:** 2026-10-19
- **Task:** T-0111
- **Amends:** §4.1 (adds a styling decision; the PRD did not name one for the core UI)

## Context

T-0111 builds the first screens. The PRD asks `packages/ui` for "design tokens + primitives" but does not choose a styling approach for the core UI. The project owner chose Tailwind CSS 4.

## Decision

- The core UI (`apps/web`, `packages/ui`) is styled with **Tailwind CSS 4** utility classes, compiled by `@tailwindcss/vite`.
- Design tokens live in `packages/ui/src/theme.css` as a Tailwind `@theme` (colours `canvas`, `surface`, `fg`, `muted`, `line`, `primary`, `danger`, …). The dark scheme overrides the same CSS variables under `prefers-color-scheme: dark`, so every utility follows the system theme.
- `apps/web/src/styles.css` imports `tailwindcss` and the theme, and adds `packages/ui/src` with `@source`, because Tailwind only scans the app by default.
- Primitives (`Button`, `TextField`, `Select`, `Dialog`, `Alert`, `Card`) own their classes; apps compose them and use utilities for layout.

## Consequences

- **Plugin CSS is unchanged.** Plugin sheets still ship their own CSS, scoped by the plugin loader (§4.1, M4). Plugins should not rely on Tailwind classes. Tailwind's preflight reset applies to the whole page, so the M4 scoping work must account for it.
- Theme changes are made in one file. Components should use token utilities (`bg-surface`, `text-danger`) rather than raw palette colours, so both schemes keep AA contrast (NFR-10).
- Lint and type-checking are unaffected; class strings are plain strings.
