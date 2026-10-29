# Backing up and restoring an instance

Everything an instance knows lives in `DATA_DIR` (default `./data`):

- `vtt.sqlite`: users, tables, actors, items, journal entries, chat, and the live sheet and journal documents;
- `vtt.sqlite-wal` and `vtt.sqlite-shm`: SQLite's write-ahead log, which can hold recent changes not yet in `vtt.sqlite`;
- `plugins/`: the installed plugin folders;
- `assets/`: the images uploaded to tables, one folder per table (ADR-064).

## Taking a backup

Copying `vtt.sqlite` by hand while the server runs is **not safe**: the copy can miss the changes still in the WAL, or catch the file halfway through a write. Use the backup command instead. It works while the server keeps running (NFR-02):

```bash
DATA_DIR=/srv/vtt/data pnpm backup /srv/backups
# → /srv/backups/vtt-backup-2026-10-23T18-30-05Z/{vtt.sqlite, plugins/, assets/}
```

- The database is written with SQLite's `VACUUM INTO`, a consistent snapshot that includes the WAL. Writes made while it runs are either all in the backup or not at all.
- `plugins/` is copied after the database. It only changes when an admin installs or removes a plugin, so avoid doing that during a backup.
- `assets/` is copied after the database too. An image uploaded while a backup runs may be in the backup without its record, which is harmless, or the other way round, in which case that one image is missing after a restore.
- Each backup goes into a new dated folder; the command never overwrites one.
- A relative destination is resolved from the folder where you typed the command.

Without the repository at hand, the `sqlite3` command-line tool does the same for the database:

```bash
sqlite3 /srv/vtt/data/vtt.sqlite "VACUUM INTO '/srv/backups/vtt.sqlite'"
cp -r /srv/vtt/data/plugins /srv/vtt/data/assets /srv/backups/
```

Keep backups somewhere other than the server's disk.

## Scheduled backups

The server can take the same backups on a schedule. Set `BACKUP_DIR` to turn them on:

| Variable                | Default | Meaning                                                     |
| ----------------------- | ------- | ----------------------------------------------------------- |
| `BACKUP_DIR`            | unset   | Folder scheduled backups go into; unset, there are none     |
| `BACKUP_INTERVAL_HOURS` | `24`    | Hours between backups, at least 1                           |
| `BACKUP_KEEP`           | `7`     | How many backups to keep; older ones are removed after each |

- The first backup is taken when the server starts if the folder has none; after that, whenever the newest one is `BACKUP_INTERVAL_HOURS` old. The server checks every 15 minutes and reads the folder each time, so restarting it does not reset the schedule, and backups you take with `pnpm backup` into the same folder count too.
- Only folders named `vtt-backup-<time>` are counted and removed; anything else in `BACKUP_DIR` is left alone.
- A failed backup is logged as an error and tried again at the next check.
- Requests wait while a backup runs, which takes a moment for a large database.

With Docker, mount a second volume for the backups:

```bash
docker run -d -p 3000:3000 -v vtt-data:/data -v /srv/vtt-backups:/backups \
  -e BACKUP_DIR=/backups -e PUBLIC_URL=https://vtt.example.com ghcr.io/rev-oo/rpg-vtt-ai:0.3.0
```

The backups are still on the server's machine: copy `BACKUP_DIR` elsewhere too, for example with a nightly `rsync`.

## Restoring

1. Stop the server.
2. Move the current `DATA_DIR` aside, including `vtt.sqlite-wal` and `vtt.sqlite-shm`: a WAL left next to a restored database would be replayed into it.
3. Copy the backup folder's `vtt.sqlite`, `plugins/` and `assets/` into an empty `DATA_DIR`.
4. Start the server. It applies any newer migrations on start, so a backup from an older version can be restored on a newer one (not the other way round).
5. Sessions are restored with the database, so anyone who signed in after the backup was taken signs in again.
