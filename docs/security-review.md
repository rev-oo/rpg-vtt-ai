# Security review (T-0701)

- **Date:** 2026-10-23
- **Scope:** the server (`apps/server`), the web app (`apps/web`), the formula engine and plugin packaging, as of M6. Covers what T-0701 names: CSRF, CSP headers, rate limits, formula sandboxing, audience leaks and path traversal, plus what came up on the way.
- **Method:** reading the code paths, then a test for each fix. Each finding below is **fixed** (with its test) or **accepted** (with the reason).

## Summary

| #   | Area           | Finding                                                                                 | Outcome  |
| --- | -------------- | --------------------------------------------------------------------------------------- | -------- |
| 1   | CSP            | The app sent no Content Security Policy and no anti-framing or anti-sniffing headers    | Fixed    |
| 2   | Rate limits    | Changing the password let a stolen session guess the current password without limit     | Fixed    |
| 3   | Rate limits    | Invite sign-up had no limit: one client could make accounts and password hashes in bulk | Fixed    |
| 4   | Secrets        | Request logs showed invite tokens in URLs                                               | Fixed    |
| 5   | Rate limits    | `TRUST_PROXY=true` lets a client choose the address that the limits count               | Fixed    |
| 6   | Code from text | "No `eval`" (specs §17) was not enforced by lint                                        | Fixed    |
| 7   | CSP            | Styles allow `'unsafe-inline'`                                                          | Accepted |
| 8   | CSP            | The Vite dev server sends no policy                                                     | Accepted |
| 9   | Plugins        | An enabled plugin's client code runs with the user's full rights in the page            | Accepted |
| 10  | Rate limits    | Members are not rate limited on chat, rolls or edits                                    | Accepted |
| 11  | Rate limits    | Limits live in memory and reset on restart                                              | Accepted |

No problem was found in CSRF, formula sandboxing, audience filtering or path traversal; what was checked is listed under each area.

## CSRF

Checked, no finding:

- Every mutating request made with a session must carry `X-CSRF-Token`, compared in constant time with the session's token (`apps/server/src/http/auth.ts`).
- Requests without a session (login, setup, sign-up) accept only JSON. The `text/plain` parser is removed, so a cross-site form cannot post without a CORS preflight, and the server sends no CORS headers.
- The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS.
- WebSocket upgrades carry cookies cross-site too, so both sockets check `Origin` against the instance (`apps/server/src/realtime/upgrade.ts`).
- Session tokens are stored hashed. Passwords use Argon2id (19 MiB, 2 passes, the OWASP minimum).

## CSP and other headers

**1 · Fixed.** There was no policy at all. The fix has two parts (ADR-042):

- **The page** gets a policy as a `<meta>` tag, added to `build/client/index.html` after `react-router build` (`apps/web/scripts/finish-page.ts`):
  - scripts only from the instance itself, plus the page's own inline scripts by SHA-256 hash: the import map and React Router's start-up code;
  - no plugins (`object-src 'none'`), no `<base>`, and forms post only to the instance;
  - connections only to the instance (`connect-src 'self'` covers both sockets);
  - images from the instance or any HTTP(S) site, as actor portraits are URLs.

  The policy travels with the file, whoever serves it.

- **Every server response** gets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: same-origin` (`apps/server/src/http/security-headers.ts`). Its `Content-Security-Policy` header depends on the response:
  - API answers get `default-src 'none'; frame-ancestors 'none'`;
  - HTML gets only `frame-ancestors 'none'`, which a `<meta>` policy cannot express;
  - plugin SVGs keep their own stricter policy.

Tests:

- `apps/server/test/security-headers.test.ts` checks the server headers;
- `apps/web/test/finish-page.test.ts` checks the hashes and where the tag goes;
- `e2e/tests/security.spec.ts` runs a plugin sheet, chat and the journal editor under the policy and fails on any violation it reports. Breaking the policy on purpose makes it fail: without the hashes the app does not start, and without inline styles the editor's style tag is reported.

**7 · Accepted: `style-src 'unsafe-inline'`.** The rich-text editor adds a `<style>` tag, and sheets and presence set style attributes. Injected CSS can restyle the page but not run code, and script injection stays blocked. Removing it would mean shipping the editor's CSS ourselves and keeping it in step with TipTap.

**8 · Accepted: no policy in development.** `pnpm --filter @vtt/web dev` serves Vite's own page with hot reload, which needs inline code. The policy is added to the build, which is what e2e and production run.

## Rate limits

**2 · Fixed.** `POST /api/v1/me/password` checked the current password with no limit, so someone holding a stolen session cookie could guess it and take over the account. A wrong current password now counts as a failed login for that user and IP (`LoginThrottle`). After five, both the password change and login answer 429 with `Retry-After`. Tested in `apps/server/test/auth.test.ts`.

**3 · Fixed.** With the `invite` registration policy, anyone holding a link could make accounts as fast as the server hashes passwords. Sign-up attempts are now limited to 10 per IP per hour (`RateLimit`, `apps/server/src/domain/auth/rate-limit.ts`). Tested in `apps/server/test/instance.test.ts`.

**5 · Fixed (docs).** With `TRUST_PROXY=true`, Fastify takes the client address from the left of `X-Forwarded-For`, which the client writes itself, so it can dodge the per-IP limits. The README now tells operators to set the number of proxies (`1` behind one Caddy) instead.

Checked, no finding:

- Login is limited per IP (20) and per username (5) every 15 minutes (FR-AUTH-07).
- Invite tokens have 256 random bits, so guessing them needs no limit.
- Request bodies are capped by Fastify (1 MiB; 20 MiB for plugin archives), collab messages at 1 MiB, chat text at 2000 characters and formulas at 500.

**10 · Accepted: members are not rate limited.** A member can flood a table's chat or rolls. Members are invited by the GM, who can remove them, and every roll is cheap (see below). Revisit if instances open to strangers.

**11 · Accepted: limits are in memory.** They reset when the server restarts. That fits the single process (specs §4.2); an attacker who can restart the server has bigger options.

## Formula sandboxing

Checked, no finding:

- Formulas are parsed by our own lexer and parser and evaluated over the syntax tree (`packages/formula`). No text ever becomes code, and the engine has no access to anything but the values it is given.
- Work is bounded:
  - nesting depth at 200;
  - evaluation steps at 10,000;
  - dice per roll at 1,000, explosions and rerolls included;
  - sides per die at 1,000,000;
  - formula length at 500.
- Results that are not finite numbers are errors.
- Server dice use `crypto.randomInt` (NFR-06).

**6 · Fixed.** Nothing stopped `eval` from being added later. The shared lint config now has `no-eval`; type-checked linting already flagged `new Function` and string timers (`no-implied-eval`).

## Audience leaks

Checked, no finding:

- **Chat:** whispers and GM-only messages are filtered in SQL for history, and per subscriber for live delivery, with the same `canSeeAudience` rule (FR-CHAT-02, NFR-08).
- **Rolls:** a player's formula runs against the system's types with secret fields removed, so a formula cannot read them (FR-SHEET-04).
- **Hidden entries:** actors, items and journal entries a player cannot see answer 404, the same as missing ones, so ids cannot be probed. Their events never reach players.
- **Documents:** collab access is re-checked after every mutating request, which closes a document a player has just lost (T-0512).
- **Wire tests:** the secret layer and hidden entries have tests on the wire (`apps/server/test`).

**4 · Fixed.** An invite token is a bearer secret: whoever reads it can join the table, or sign up with the `invite` policy. Request logs showed it in the URL (`GET /api/v1/invites/<token>`), so anyone with log access could use it. Logged URLs now show `[redacted]` in its place. Logged requests also no longer carry headers or the raw request object, which kept the cookie out only by a redaction list. Tested in `apps/server/test/app.test.ts`. The `same-origin` referrer policy also keeps the token out of `Referer` when an invite page links elsewhere.

## Path traversal

Checked, no finding:

- **Plugin files** (`/plugins/<id>/*`) are served only to signed-in users, and only while the plugin is available. The id must match the plugin id pattern. The path may not have empty, `.` or `..` segments, hidden files, backslashes or NUL, and must have an allowed extension. The resolved file must equal its `realpath` inside the plugin folder, so links cannot lead out. SVGs are sent with a policy that blocks scripts.
- **Plugin archives** refuse:
  - absolute names, drive letters, backslashes, and `.` or `..` segments;
  - links, duplicate names (case-insensitive), encryption, ZIP64 and methods other than deflate.

  They also cap each file and the total unpacked size, and inflating stops at the size the archive declares, so an archive cannot unpack to more than it claims.

- **Backups** write only into a new folder and refuse an existing one.

## Plugins

**9 · Accepted: plugin code is trusted.** An enabled plugin's client bundle runs in the page, so it can do anything the user can. This is the trust model in the specs (risk register): only admins install plugins, enabling one with code needs an explicit acknowledgement, and a disabled plugin's files are not served. The CSP limits where code comes from, not what plugin code does. Sandboxing is planned for later.
