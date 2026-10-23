# ADR-040: Instance settings, invite sign-up and the health endpoint

- **Status:** Accepted
- **Date:** 2026-10-23
- **Tasks:** T-0604
- **Refines:** FR-ADMIN-01, FR-ADMIN-03, specs §10.1

## Context

FR-ADMIN-01 lists four instance settings: site name, registration policy (closed or invite-only), session lifetime and upload limits. The `instance_settings` table existed since M1, but nothing read or wrote it. Nobody could sign up: an admin created every account, so a registration policy had nothing to govern. Uploads only arrive with the asset manager (LATER). FR-ADMIN-03 asks for `/api/health`.

## Decision

1. **Three settings, stored one row per key** in `instance_settings`:
   - `siteName` (default `VTT`), shown in the app header;
   - `registration`, `closed` (default) or `invite`;
   - `sessionLifetimeSeconds`, 1 hour to 90 days. `SESSION_TTL` is now only its default. New sessions read the setting; sessions already issued keep their expiry.
   - A stored value that no longer fits falls back to its default, so a bad row never breaks the instance.
   - **Upload limits are left out** until uploads exist (decided with the user).
2. **Routes:**
   - `GET /admin/settings` and `PATCH /admin/settings`, admin only. The schemas are `instanceSettingsSchema` and `updateInstanceSettingsBody` in `@vtt/shared/api`.
   - `GET /instance`, public: the site name and the registration policy, which the join page needs before anyone signs in.
3. **With `invite`, a table invite link also signs up** (decided with the user):
   - `POST /invites/:token/signup` creates a non-admin account with the given username, display name and password, makes it a member with the invite's role, and signs it in. It answers 403 `registration_closed` under `closed`.
   - The link is checked before and again after the password is hashed, so a link revoked meanwhile is refused.
   - `GET /invites/:token` answers without a session while sign-up is open, so the join page can say where the link leads. Under `closed` it still needs a session.
   - An admin can still create accounts directly under either policy.
4. **`GET /api/health`** is outside `/api/v1` and needs no session, for Docker and load balancers:
   - `{ status, database, plugins: { enabled, ready, failed } }`.
   - It answers 200 while the database answers `select 1`, and 503 `unhealthy` otherwise, with the error logged.
   - Plugins that fail to load are reported but do not make the instance unhealthy: tables of other systems keep working.

## Consequences

- Tested in `apps/server/test/instance.test.ts`: defaults, admin-only changes, the session lifetime, sign-up under both policies, unusable links, and health with a closed database.
- The web app has an instance settings page (`/admin/settings`) and a join page (`/invite/:token`) that offers sign-up when it is open. Covered by `e2e/tests/table-admin.spec.ts`.
- Sign-up has no rate limit of its own: it needs a valid invite token, which only a GM hands out.
