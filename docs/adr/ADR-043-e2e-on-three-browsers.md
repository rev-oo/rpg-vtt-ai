# ADR-043: The e2e suite on three browsers, one instance each

- **Status:** Accepted
- **Date:** 2026-10-25
- **Tasks:** T-0702
- **Refines:** specs §17 (testing), ADR-025

## Context

T-0702 asks for the Playwright scenarios to pass in CI on three browsers. Until now the suite ran on Chromium only, against one API server and one `vite preview`. The tests create users and tables with fixed names, such as `gwen` and `D20 Table`, and some write to the server's database or plugins folder directly. Running every test once per browser against the same server would clash.

## Decision

1. **The suite runs on Chromium, Firefox and WebKit** (Desktop Chrome, Firefox and Safari devices). CI installs all three.
2. **Each browser gets its own instance:**
   - an API server on its own port and data folder (`e2e/.data/<browser>`), with its own `vite preview` in front;
   - its own first-run project, which creates the admin.

   The tests stay as they are. Helpers that touch the server's files find the folder through the project's metadata (`e2e/tests/support/instance.ts`).

3. **`E2E_BROWSERS`** picks a subset locally (`E2E_BROWSERS=firefox pnpm e2e`). CI runs all three.
4. **Workers stay at 1.** The browsers run one after another, about 2.5 minutes in all.
5. **The secret layer is checked on the wire.** The tiny-d20 test records everything the player's page receives over both sockets and from the API, and checks that the GM-only value never arrives, even when the GM edits it live (FR-SHEET-04).

## Consequences

Running on Firefox found two bugs, both fixed:

- **Plugin client code did not load in Firefox.** React hoists the `modulepreload` links above the import map, and Firefox ignores an import map that comes after a module started loading. The post-build step (`apps/web/scripts/finish-page.ts`, formerly `content-security-policy.ts`) now moves the import map right after the charset, before the policy is hashed.
- **On a phone, the chat box overflowed by 2 px in Firefox.** A textarea's default width kept it from shrinking in its flex row. It now has `min-w-0`.

Three servers and three preview servers start before the suite. A new test that writes to the server's files must use the `instance.ts` helpers.
