# ADR-066: Scenes are rows sized in grid cells, with one active per table

- **Status:** Accepted
- **Date:** 2026-10-29
- **Tasks:** T-1401
- **Covers:** FR-MAP-01, FR-ASSET-02 (scene backgrounds)
- **Amends:** ADR-065 (scene backgrounds count as asset uses)

## Context

M14 adds maps. T-1401 stores a table's scenes: a background, a grid, and which scene players see. Like encounters (ADR-049), scenes are prepared by one person, the GM, and nobody co-edits them; tokens (T-1403) and fog (T-1404) come later and need their own filtering, so they are not part of this decision.

## Decision

1. **Rows.** `scenes(id, table_id, name, background_url?, columns, rows, grid_type, grid_size, active, sort)`. Deleting a table deletes its scenes. A table holds at most 100 scenes.
2. **Size in grid cells.** A scene is `columns × rows` cells (1–200 each); `grid_size` (16–400) is a cell's size in pixels of the background, so the background is drawn at `columns × grid_size` by `rows × grid_size`. The grid is `square` or `hex`. New scenes default to 30 × 20 square cells of 70 px.
3. **Backgrounds** are image URLs checked like actor images (ADR-065): an http(s) URL, or an asset of the same table. A scene's background counts as a use of its asset, so the image cannot be deleted while a scene shows it.
4. **One active scene** per table, enforced by a partial unique index (`active = 1`). Activating a scene deactivates the previous one in the same transaction; activating `null` shows players none.
5. **Visibility.** GMs and assistants (`canManageScenes`) read every scene in their order. Players and spectators read only the active scene; any other scene is `404` to them, as it is to non-members, so its existence does not leak.
6. **Endpoints.** `GET`/`POST /tables/:id/scenes`, `POST /tables/:id/scenes/order {sceneIds}` (every scene of the table, once), `POST /tables/:id/scenes/active {sceneId | null}`, and `GET`/`PATCH`/`DELETE /scenes/:id`. Changes need `canManageScenes` and an unarchived table. New scenes go last.
7. **A payload-less `scene.updated` event** goes to the table's subscribers after each change, and clients refetch what they may see, as with `combat.updated` (ADR-049).

## Consequences

- Inactive scenes, their names included, never reach players: not on the event stream, and not through REST.
- Sizes in cells keep a scene's grid aligned however large its background is; a background whose aspect ratio does not match is stretched to the scene, which the GM fixes by changing columns, rows or the cell size.
- Players see a single scene at a time; per-player scenes would need another decision.
