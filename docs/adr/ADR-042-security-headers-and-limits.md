# ADR-042: Content Security Policy, security headers and the new rate limits

- **Status:** Accepted
- **Date:** 2026-10-23
- **Tasks:** T-0701
- **Refines:** NFR-05, FR-AUTH-07, FR-ADMIN-01

## Context

NFR-05 asks for CSP headers, but the app sent none. The SPA is a prerendered `index.html` with inline scripts (the import map and React Router's start-up code). Today it is served by `vite preview` in e2e, and by the Node server once T-0703 adds that. The security review (`docs/security-review.md`) also found two endpoints that check secrets without a limit: password change and invite sign-up.

## Decision

1. **The page's policy is a `<meta>` tag written at build time.**
   - `apps/web/scripts/finish-page.ts` runs after `react-router build`. It hashes every inline script of `index.html` and puts the policy right after the charset.
   - Scripts load only from the instance itself, or by hash. There are no nonces, so serving the file needs no server code.
   - Styles allow `'unsafe-inline'`, because the editor adds a `<style>` tag.
   - Images may come from any HTTP(S) site.
   - Everything else is limited to the instance itself, with `object-src` and `base-uri` set to none.
2. **The server adds headers to every response** (`apps/server/src/http/security-headers.ts`): `nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: same-origin`. The CSP header depends on the response:
   - non-HTML answers get `default-src 'none'; frame-ancestors 'none'`;
   - HTML gets `frame-ancestors 'none'`, the one rule a `<meta>` policy cannot express. The browser enforces both policies.
   - A route that sets its own policy keeps it, like plugin SVGs.
3. **A wrong current password counts as a failed login** for the user and IP, so a stolen session can guess no faster than the login form allows.
4. **Sign-up through an invite link is limited to 10 attempts per IP per hour.**
   - The window counting moved into `RateLimit`, which `LoginThrottle` now uses too.
   - Attempts count once the body is valid, so a taken username counts too.
   - The limiter runs on the app clock, so tests can move time.
5. **Logged requests are method, URL, host and client address**, with invite tokens in the URL redacted. Headers and the raw request are no longer logged.
6. **`no-eval` is on in the shared lint config.**

## Consequences

- `e2e/tests/security.spec.ts` runs the app under the built policy and fails on any reported violation. A new inline script in the page is hashed by the build; a new kind of source (fonts or connections to another site) needs the policy changed.
- `pnpm --filter @vtt/web dev` runs without a policy.
- Behind a proxy, `TRUST_PROXY` should be a hop count. `true` lets clients pick the address that the limits count (README).
