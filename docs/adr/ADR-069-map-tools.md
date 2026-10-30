# ADR-069: A token menu on right click, and a ruler each member uses alone

- **Status:** Accepted
- **Date:** 2026-10-30
- **Tasks:** T-1405, T-1406
- **Covers:** FR-MAP-03 (the token menu), FR-MAP-05
- **Amends:** ADR-066 (scenes gain a ruler scale and a diagonal rule)

## Context

On the map, a token's actions (open its actor, hide or reveal it, remove it) were only in the token list under the canvas, and nothing measured distances. Players expect both from a virtual tabletop: a menu on the token itself, and a ruler that speaks the game's units. Scenes only knew cells and pixels, and game systems count diagonal moves on a square grid in different ways.

## Decision

1. **Token menu.** A right click on a token selects it and opens a menu with the token list's actions, as the member may take them: **Open** for an actor they can see, **Hide**/**Reveal** and **Remove** for GMs and assistants. A token with no action for the member opens no menu. The browser's own menu is turned off over the canvas. With the map focused and a token selected, the context-menu key or Shift+F10 opens the same menu by the token. The menu is a `menu` of `menuitem` buttons: the first is focused, arrows move between them, and Enter runs one. Escape, Tab, a press elsewhere or an action closes it, and focus goes back to the map. Only the left button starts a token drag.
2. **Map tools.** A toolbar over the map picks the tool: **Select** (the default: tokens are selected and moved, and the map pans), **Ruler**, **Circle** or **Cone**. While a measuring tool is on, tokens take no pointer and the map does not pan by dragging. Wheel, pinch, keys and buttons still zoom and pan.
3. **Ruler.** The ruler measures a path. A click or press on the map starts it; each later click adds a point, and a drag adds the point it ends on, so a single drag measures one leg as before. Until the path ends, a last leg follows the pointer. Enter or a double click ends it, Backspace takes back the last point, and Escape clears it; a press after the end starts a new path, and so does another tool. On a grid the points snap to cell centres, and a click on the last point adds nothing; on a gridless scene they are where the pointer is. The path and its label keep their size on screen at any zoom. A status line under the map reads the measure ("Measured 45 ft (cells: 9, points: 3).") so screen readers hear it, beside a line of these keys. Placing points needs a pointer; keyboard users have no ruler yet.
4. **Circle and cone.** A press sets a circle's centre or a cone's origin, snapped to a cell centre on a grid, and dragging sets the radius, or the cone's length and the way it points. The radius or length is counted like a one-leg ruler from the centre to the pointer's cell, and the shape is drawn that far, so the shape and its label agree ("Circle: radius 15 ft (cells: 3)."). A cone is as wide at its end as it is long (53.13°, as in D&D 5e), drawn as a sector. A shape stays until the next press, Escape or another tool. Shapes are outlines to read areas by; they do not mark the cells inside them.
5. **Counting.** A path is counted as one move, leg by leg. Square and hidden grids count steps between cells by the scene's **diagonal rule**: `one` (each diagonal is a cell, as in D&D 5e), `alternate` (every second diagonal is two cells, as in 3.5e and Pathfinder) or `straight` (the straight line between the cell centres, to a tenth). Under `alternate` the diagonals alternate along the whole path, so two legs of one diagonal each make three cells. Hex grids count hexes. A gridless scene measures the straight lines between the points, in cells of `gridSize` pixels, to a tenth.
6. **Scale.** Scenes gain `cell_distance` (what a cell measures, a positive number up to 1000, default 5), `distance_unit` (1–12 characters, default `ft`) and `diagonals` (default `one`). GMs set them in the scene form; the distance takes a point or a comma. The distance shown is `cells × cell_distance`, to a tenth.
7. **Local only.** A ruler, circle or cone is drawn in the measuring member's browser and never sent, so it needs no event or permission, and hidden tokens it crosses are not revealed.

## Consequences

- Other members do not see a measure; a shared ruler would need an event and its own filtering.
- Scenes made before T-1406 measure 5 ft per cell with one cell per diagonal until a GM changes them.
- Keyboard users can open and use a token's menu, but cannot measure.
