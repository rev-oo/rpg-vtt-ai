# ADR-051: Compendium packs import once into a table's actors and items

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0803
- **Covers:** FR-PLUGIN-09

## Context

FR-PLUGIN-09 lets a plugin ship compendium packs, `packs/*.json`, which GMs import into a table. §8.14 reserved the folder in 0.1.0 without a format. A table has no library apart from its actors and its library items (FR-ENT-05). The server has never checked entity data against a type's schema (data is written through live documents, §9.7). Importing twice must not duplicate entries.

## Decision

1. **Format.** `packs/<name>.json` is `{ label, entries: [{ id, kind, type, name, data? }] }`. `kind` is `actor` or `item`, and `type` names one of the plugin's own types. `id` is a name, unique in the pack and stable across versions. `label` is a lang key or text. A pack holds at most 1,000 entries.
2. **Data.** `data` follows the type's schema as written in JSON: collections are lists of rows, as in defaults. The validator checks it like defaults (types, bounds, enums) and reports unknown keys, with the file and JSON path of each problem. Fields it leaves out take their defaults when the entity loads. On import, collection lists become keyed rows (`p0`, `p1`…) with sort keys.
3. **Library.** Importing creates the table's actors (owned by the GM, as when a GM creates one) and library items. There is no separate compendium store.
4. **Once only.** Each imported entity keeps `pack_ref`, `<plugin>:<pack>:<entry id>`. Importing again creates only the entries with no entity of that ref in the table, live or in the trash, so a GM's edits are never overwritten and deleted entries do not come back while they can be restored. An entry removed for good can be imported again.
5. **Endpoints.** GMs and assistants (`canImportPacks`) list the system's packs with their counts at `GET /tables/:id/packs`, and import one with `POST /tables/:id/packs/:name/import`, answered `{ created, skipped }`. Each created entity is announced with `entity.changed`.
6. **Off the browser.** `GET /systems/:id` leaves packs out of the definition: they can be large, and players have no use for them. The web lists them through the endpoint.
7. **UI.** The table settings page, GM-only, has a Compendium section.

## Consequences

- Plugins can ship ready-made NPCs and gear; `tiny-d20` ships a bestiary.
- A pack update adds new entries on the next import but does not change entries already imported.
- Assistants may import through the API, but the settings page that shows the button is the GM's.
- The data checker can serve other hand-written data later, such as the `dataVersion` warning (T-0813).
