# ADR-020: Plugin registry and read-only tables

- **Status:** Accepted
- **Date:** 2026-10-21
- **Tasks:** T-0403
- **Amends:** §10.1 (adds `POST /plugins/:id/disable`), FR-PLUGIN-07 (what read-only means)

## Context

T-0403 turns plugin folders in `DATA_DIR/plugins` into `plugins` rows (FR-PLUGIN-01), lists incompatible plugins with a reason (FR-PLUGIN-03), and lets admins enable and disable plugins, making the tables of a disabled plugin read-only (FR-PLUGIN-07). The spec does not say what happens to a plugin whose folder breaks or disappears, when a new plugin is enabled, or what read-only covers.

## Decision

1. **Scanning.** The server scans once at startup and again on `POST /plugins/rescan`. Scans run one at a time.
   - Each folder whose name is a plugin id is read and validated with `validatePlugin` (ADR-019). Other names, such as `.git`, are logged and skipped.
   - Symbolic links are skipped, never followed. JSON files over 1 MiB are not read and are reported as `file_too_large`.
2. **Status.** Each row has a status: `ready`, `invalid` (errors), `incompatible` (the only errors are `incompatible_core_api`), or `missing` (the folder is gone). The row stores the last scan's issues, including warnings, for the admin page (T-0406).
   - A row is never deleted, because tables reference it.
   - A plugin that is not `ready` keeps the actor and item types of its last good scan, so its tables still list their entities.
3. **Enabling.** New plugins start disabled, and only admins change `enabled`. A rescan keeps the choice.
   - Only `ready` plugins can be enabled (409 `plugin_not_ready`).
   - A plugin with a `code/` folder needs `{ "acknowledgeCode": true }` (422 `code_not_acknowledged`), because its code runs in-process (FR-PLUGIN-06, 08).
   - An enabled plugin that gains a `code/` folder is disabled by the next scan until an admin enables it again.
   - `POST /plugins/:id/disable` is added next to `enable`.
4. **Availability.** A plugin is available when it is enabled and `ready`. Only available plugins are listed in `GET /systems` and accepted when creating a table.
5. **Read-only tables.** When a table's system is not available:
   - Creating, editing, duplicating, deleting and restoring actors and items fails with 409 `table_read_only`, and so do rolls.
   - Members can still read everything and send chat messages.
6. **Core API version.** `CORE_API_VERSION` (`0.1.0`) lives in `@vtt/shared`, so the validator, the server and the CLI agree.

## Consequences

- The e2e server copies a fixture plugin into its data directory and seeds only `enabled`.
- Tests that need a system without a folder insert a `ready` row directly, as the scanner would.
- `plugin.changed` events (§10.2) are not sent yet; the admin page reloads the list after each action.
