# ADR-064: Uploaded images are table assets on disk, checked by content

- **Status:** Accepted
- **Date:** 2026-10-29
- **Tasks:** T-1301
- **Covers:** FR-ASSET-01, FR-ASSET-03, FR-ADMIN-01 (upload limits)
- **Amends:** ADR-040 (upload limits now exist), ADR-055 and `docs/backup.md` (backups hold `assets/`)

## Context

Every image so far is a URL to somewhere else: portraits, item images, and from M14 scene backgrounds. Groups without their own image hosting have nowhere to put them. M13 adds uploads: this ADR stores and serves them, and T-1302 adds the asset manager that picks them.

Uploads are the instance's first user-supplied files. They take disk space, they come from people other than the admin, and browsers will render them, so they need limits and checks.

## Decision

1. **Ownership.** An asset belongs to one table, like actors and items.
   - GMs and assistants upload.
   - Every member of the table reads the table's assets.
   - Archived tables take no uploads (`409 table_archived`). Tables whose system is unavailable still do: assets need no system.
   - Tables are never deleted, only archived, so an asset lives as long as its table. Deleting assets is T-1302's.
2. **Storage.**
   - An `assets` table holds `id`, `table_id`, `uploader_id` (set to null when the account goes), `name`, `type`, `size`, `sha256` and `created_at`.
   - The file is `DATA_DIR/assets/<table id>/<asset id>`. It has no extension: the type comes from the row, never from a file name.
   - The file is written to a temporary name and renamed once complete. The row is inserted in the same transaction as the quota check, and the file is removed if the insert fails.
3. **Accepted types.** Only PNG, JPEG, GIF and WebP are accepted, identified by their leading bytes.
   - The request's `Content-Type` and the file name are ignored, so a renamed or mislabelled file is judged by what it is.
   - Anything else is refused with `415 unsupported_asset_type`, **SVG included**. An SVG is a document that can carry script and outside references. Sanitising one safely needs a full XML sanitiser kept up to date, and tabletop images rarely need vectors. Refusing it can be revisited if maps want it.
4. **Limits.** Two instance settings, edited by admins on the settings page:
   - `maxUploadBytes`: the largest file. Default 10 MiB, from 1 to 100 MiB. Larger files get `413 asset_too_large`.
   - `assetQuotaBytes`: all assets of the instance together. Default 1 GiB, from 1 MiB to 1 TiB. An upload that would pass it gets `413 asset_quota_exceeded`.
   - The route's own body limit is the highest allowed upload, 100 MiB. Larger bodies are cut off before they are read whole.
   - Lowering a limit keeps the assets already stored.
5. **Upload API.** `POST /api/v1/tables/:id/assets?name=<file name>` takes the image as the raw request body, as plugin archives do (ADR-026), with any `image/*` or `application/octet-stream` content type. It answers `201 { asset }`. `GET /api/v1/tables/:id/assets` lists a table's assets, newest first.
6. **Serving.** `GET /api/v1/assets/:id` serves the file, with the type from its row, to signed-in members of its table. Anyone else gets 404, as for tables.
   - **Headers:** `x-content-type-options: nosniff` and the data policy `default-src 'none'; frame-ancestors 'none'`. An image opened on its own therefore runs nothing and cannot be framed.
   - **Caching:** an asset's id never names other bytes, so the response is cached for a year: `private, max-age=31536000, immutable`. It is `private` because it needs a session.
   - **URL:** the path is under `/api/v1`. Built web files already use `/assets/`, and the dev proxy already forwards `/api`.
   - **Image fields:** they still hold plain strings, and an asset's URL is its path, `/api/v1/assets/<id>`, so a changed `PUBLIC_URL` does not break them. T-1302 lets image fields take that path.
7. **Backups.** `backupDataDir` copies `assets/` after the database, as it does `plugins/`. Restoring copies it back (`docs/backup.md`).
   - A backup taken during an upload can lack a file whose row it has, or the other way round.
   - Files are written before their rows, so a missing row leaves only a stray file. A row taken before its file arrived serves 404.

## Security review notes

| Threat                                    | Answer                                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Script in an upload (SVG, HTML as `.png`) | Only four raster types are accepted, by their bytes; SVG is refused. Responses carry the type from the row, `nosniff` and a policy allowing nothing, so even a crafted file is not run. |
| Filling the disk                          | Per-file limit and instance quota, checked before the row is written; the body limit cuts off larger requests early. Only GMs and assistants upload, and only into tables they manage.  |
| Path traversal                            | Files are named by server-made UUIDs under a fixed folder; nothing from the request reaches a path.                                                                                     |
| Reading another table's images            | Serving checks membership of the asset's table and answers 404 otherwise, so ids cannot be probed.                                                                                      |
| Malformed images attacking the browser    | The server does not decode images. Decoding is left to the browser, as for any image URL.                                                                                               |
| Metadata in photos (EXIF location)        | Files are stored as uploaded and readable only by the table's members. Stripping metadata would need decoding, so it is left out. GMs choose what they upload.                          |
| Stale caches after a change               | An asset's bytes never change under its id, so long caching cannot serve a wrong image.                                                                                                 |

## Consequences

- Groups can keep images on their own instance, within limits the admin sets.
- A file type outside the four, SVG included, needs converting before upload.
- `DATA_DIR` grows by the assets, and backups with it.
- Assets go with their table only when it is purged, which no route does yet. T-1302's delete is the way to free space.
