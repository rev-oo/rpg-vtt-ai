# ADR-011: M1 server decisions (plugins table, proxy trust, CSRF, permissions)

- **Status:** Accepted
- **Date:** 2026-10-19
- **Task:** T-0101, T-0102, T-0104, T-0108, T-0110
- **Amends:** T-0101 (env var list), T-0102 (table list)

## Context

M1 needed a few decisions the PRD does not spell out or that change a task's listed scope.

## Decision

1. **`plugins` table in T-0102.** T-0107 must reject disabled plugins, but the plugin scanner arrives in M4 (T-0403). The initial migration adds a `plugins` table (`id`, `name`, `version`, `enabled`, `has_code`, `updated_at`), and `game_tables.system_id` references it. Until the scanner exists, tests insert rows directly.
2. **`TRUST_PROXY` env var.** The PRD deploys behind a reverse proxy (§4.2), and per-IP login limits (FR-AUTH-07) need the real client IP. `TRUST_PROXY` is `false` by default; set it to `true` or a hop count to trust `X-Forwarded-For`.
3. **CSRF.** Requests that carry a session must send an `X-CSRF-Token` that matches the session (§10.1). Requests without a session (login, setup) are protected because the server accepts only JSON bodies (the `text/plain` parser is removed), so a cross-site form cannot reach them without a CORS preflight. The CSRF token is returned by login, setup and `GET /me`.
4. **A table always has a GM.** Demoting or removing the last GM returns `409 last_gm`. Members may leave a table themselves; only the GM removes others.
5. **Permission semantics** (`@vtt/shared` permissions):
   - A per-user ownership level overrides the default level, so a GM can hide an actor from one player.
   - Spectators are capped at `observer` because they never edit (§2).
   - Whispers reach only the sender and recipients, not the GM (§10.2).
   - `gm` messages reach GMs, assistants and the sender (FR-CHAT-05).
   - Hidden journal entries are visible only to GMs and assistants (§9.3).
6. **Non-members get 404 for a table**, instance admins included (FR-AUTH-08), so table ids cannot be probed.

7. **`GET /api/v1/systems` (added in T-0111).** The create-table dialog must list the enabled system plugins, and any user may create a table (FR-TABLE-01). The admin-only `GET /plugins` (§10.1) cannot serve them, so `GET /systems` returns `id`, `name` and `version` of enabled plugins to any signed-in user. Table responses also include `systemName`.

## Consequences

- The M4 scanner (T-0403) writes to the existing `plugins` table instead of creating it.
- Self-hosters behind a proxy must set `TRUST_PROXY`. Otherwise every request appears to come from the proxy's IP and shares one login limit.
- UI code can use the same permission functions as the server for hints. The server remains the authority.
