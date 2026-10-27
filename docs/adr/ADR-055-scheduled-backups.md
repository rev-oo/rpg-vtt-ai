# ADR-055: The server takes scheduled backups when `BACKUP_DIR` is set

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0808
- **Covers:** FR-ADMIN-05 (automated part)

## Context

FR-ADMIN-05 asks for an optional scheduled backup set by an environment variable. 0.1.0 has `pnpm backup`, which writes a consistent copy of `DATA_DIR` (`VACUUM INTO` plus `plugins/`) into a new dated folder (T-0605), and the docs tell self-hosters to run it from cron. The Docker image has no cron, and the server restarts on every upgrade.

## Decision

1. **Settings.** `BACKUP_DIR` turns scheduled backups on and names the folder; `BACKUP_INTERVAL_HOURS` (default 24, at least 1) and `BACKUP_KEEP` (default 7) set how often and how many.
2. **Same backup.** The server calls the backup command's function, so a scheduled backup is the same `vtt-backup-<UTC time>` folder as a manual one, and restores the same way.
3. **Due, not timed.** Every 15 minutes, and at start, the server reads the folder: when the newest backup is at least an interval old, or there is none, it takes one. A restart therefore neither skips a backup nor takes an extra one, and manual backups into the same folder count.
4. **Rotation.** After each scheduled backup, all but the newest `BACKUP_KEEP` backup folders are removed. Only folders named like backups are touched.
5. **Failures.** A failed backup is logged as an error and tried again at the next check; the server keeps running.

## Consequences

- Docker users mount a second volume for `BACKUP_DIR`; a folder inside `DATA_DIR` works but shares its disk.
- The backup runs on the server's thread: requests wait while a large database is copied.
- Off-site copies remain the self-hoster's job.
