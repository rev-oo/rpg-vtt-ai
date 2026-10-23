# Backing up and restoring an instance

Everything an instance knows lives in `DATA_DIR` (default `./data`):

- `vtt.sqlite`: users, tables, actors, items, journal entries, chat, and the live sheet and journal documents;
- `vtt.sqlite-wal` and `vtt.sqlite-shm`: SQLite's write-ahead log, which can hold recent changes not yet in `vtt.sqlite`;
- `plugins/`: the installed plugin folders.

## Taking a backup

Copying `vtt.sqlite` by hand while the server runs is **not safe**: the copy can miss the changes still in the WAL, or catch the file halfway through a write. Use the backup command instead. It works while the server keeps running (NFR-02):

```bash
DATA_DIR=/srv/vtt/data pnpm backup /srv/backups
# → /srv/backups/vtt-backup-2026-10-23T18-30-05Z/{vtt.sqlite, plugins/}
```

- The database is written with SQLite's `VACUUM INTO`, a consistent snapshot that includes the WAL. Writes made while it runs are either all in the backup or not at all.
- `plugins/` is copied after the database. It only changes when an admin installs or removes a plugin, so avoid doing that during a backup.
- Each backup goes into a new dated folder; the command never overwrites one.
- A relative destination is resolved from the folder where you typed the command.

Without the repository at hand, the `sqlite3` command-line tool does the same for the database:

```bash
sqlite3 /srv/vtt/data/vtt.sqlite "VACUUM INTO '/srv/backups/vtt.sqlite'"
cp -r /srv/vtt/data/plugins /srv/backups/
```

Keep backups somewhere other than the server's disk. Scheduled backups come later (T-0808); until then, run the command from cron or a systemd timer.

## Restoring

1. Stop the server.
2. Move the current `DATA_DIR` aside, including `vtt.sqlite-wal` and `vtt.sqlite-shm`: a WAL left next to a restored database would be replayed into it.
3. Copy the backup folder's `vtt.sqlite` and `plugins/` into an empty `DATA_DIR`.
4. Start the server. It applies any newer migrations on start, so a backup from an older version can be restored on a newer one (not the other way round).
5. Sessions are restored with the database, so anyone who signed in after the backup was taken signs in again.
