# ADR-070: Fog of war is a list of revealed rectangles, filtered on the server

- **Status:** Accepted
- **Date:** 2026-10-31
- **Tasks:** T-1404
- **Covers:** FR-MAP-04
- **Amends:** ADR-066 (scenes gain fog), ADR-068 (who sees a token)

## Context

GMs need to hide parts of a scene until the players explore them, and the tokens there must not reach players (NFR-08). Scenes have square, hex, hidden or no grids (ADR-066), and gridless tokens stand anywhere (ADR-068). The fog must be cheap to keep, to send and to test a token against, on every list and every event.

## Decision

1. **Fog per scene.** Scenes gain `fog` (on or off, default off) and `revealed`, a JSON list of rectangles in cells from the grid's top-left corner (on a hex grid, in its columns and rows). With fog on, nothing is revealed until the GM reveals it; with fog off, `revealed` is kept but ignored. GMs and assistants turn fog on in the scene form.
2. **Changes.** `POST /scenes/:id/fog` takes `{ action: 'reveal' | 'hide', area }` or `{ action: 'revealAll' | 'hideAll' }`, for GMs and assistants. The server keeps the revealed areas apart from each other: revealing adds the parts of the area not yet revealed, hiding cuts the area out of each revealed rectangle, and rectangles sharing a whole edge are joined. So later changes win where they overlap, and the list is what players receive. A scene keeps at most 1000 rectangles (`fog_too_complex` past that). Revealing all stores one rectangle over the largest scene.
3. **Tokens.** A token is in the fog when its centre, half a cell right of and below its column and row, is in no revealed rectangle. Players and spectators get no token in the fog, in lists, on `token.updated` or by id (404), except the tokens of actors they own, which they see and move as usual: players know where their characters stand. `canSeeToken` and `canMoveToken` take the member and these facts, and the server's filters for lists and events use them.
4. **Events.** A fog change or a scene edit sends `scene.updated` and a `token.updated` for the scene to the whole table, and members refetch what they may see. A token moving into the fog sends its last `token.updated` to players, who refetch and lose it; its later moves reach no player.
5. **Drawing.** The fog lies over the background and grid and under the tokens: opaque for players, a half tint for GMs and assistants, who keep preparing beneath it. On square, hidden and gridless scenes it is the scene's area minus the revealed rectangles; on a hex grid each hex whose centre is not revealed is drawn, and everything past the grid is fog.
6. **Tools.** With fog on, GMs and assistants get **Reveal** and **Hide** on the map toolbar. A drag reveals or hides every cell from the one it starts on to the one it ends on (a click, one cell), outlined while dragging; on a gridless scene the drag is the area. **Reveal all** and **Hide all** sit by the tool's hint. Escape drops a drag in progress.

## Consequences

- The background image is one file: a player who opens its address sees all of it. The fog hides tokens and, in the app, the picture; it does not cut the image. Uploading a separate background per revealed state is the way around it.
- Fog is rectangles: no polygons, walls or lines of sight. On a hex grid an area is a span of columns and rows, so its ragged edge follows the hex rows.
- Revealed areas stay when a scene's grid changes size or type, and may then cover other cells.
