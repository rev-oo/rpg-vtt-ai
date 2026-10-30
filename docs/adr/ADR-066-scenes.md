# ADR-066: Scenes are rows sized in grid cells, with one active per table

- **Status:** Accepted
- **Date:** 2026-10-29
- **Tasks:** T-1401
- **Covers:** FR-MAP-01, FR-ASSET-02 (scene backgrounds)
- **Amends:** ADR-065 (scene backgrounds count as asset uses)
- **Amended by:** ADR-067 (the background keeps its size), ADR-068 (hidden and gridless grids), ADR-069 (a ruler scale and diagonal rule)

## Context

M14 adds maps. T-1401 stores a table's scenes: a background, a grid, and which scene players see. Like encounters (ADR-049), scenes are prepared by one person, the GM, and nobody co-edits them; tokens (T-1403) and fog (T-1404) come later and need their own filtering, so they are not part of this decision.

## Decision

1. **Rows.** `scenes(id, table_id, name, background_url?, columns, rows, grid_type, grid_size, active, sort)`. Deleting a table deletes its scenes. A table holds at most 100 scenes.
2. **Size in grid cells.** A scene is `columns × rows` cells (1–200 each); `grid_size` (16–400) is a cell's size in pixels of the background, so the grid spans `columns × grid_size` by `rows × grid_size` pixels of the background, which is drawn at its own size from the top left (amended by ADR-067: it was stretched to the grid). The grid is `square`, `hex`, `hidden` (square cells that are not drawn) or `none` (gridless: the cells are only a unit, and tokens stand anywhere; amended by ADR-068). New scenes default to 30 × 20 square cells of 70 px.
3. **Backgrounds** are image URLs checked like actor images (ADR-065): an http(s) URL, or an asset of the same table. A scene's background counts as a use of its asset, so the image cannot be deleted while a scene shows it.
4. **One active scene** per table, enforced by a partial unique index (`active = 1`). Activating a scene deactivates the previous one in the same transaction; activating `null` shows players none.
5. **Visibility.** GMs and assistants (`canManageScenes`) read every scene in their order. Players and spectators read only the active scene; any other scene is `404` to them, as it is to non-members, so its existence does not leak.
6. **Endpoints.** `GET`/`POST /tables/:id/scenes`, `POST /tables/:id/scenes/order {sceneIds}` (every scene of the table, once), `POST /tables/:id/scenes/active {sceneId | null}`, and `GET`/`PATCH`/`DELETE /scenes/:id`. Changes need `canManageScenes` and an unarchived table. New scenes go last.
7. **A payload-less `scene.updated` event** goes to the table's subscribers after each change, and clients refetch what they may see, as with `combat.updated` (ADR-049).

## Consequences

- Inactive scenes, their names included, never reach players: not on the event stream, and not through REST.
- The background is never distorted: the GM lines the grid up with a map's printed grid by its cell size, and fits the grid to the image by its columns and rows. Parts of the image outside the grid show but hold no cells.
- Players see a single scene at a time; per-player scenes would need another decision.
