# ADR-067: Maps render with PixiJS v8 in a lazy-loaded panel, drawn on demand

- **Status:** Accepted
- **Date:** 2026-10-30
- **Tasks:** T-1402
- **Covers:** FR-MAP-01 (the Scenes panel), FR-MAP-02
- **Answers:** Q18
- **Amends:** ADR-066 (the background keeps its own size)

## Context

T-1402 draws a scene (ADR-066) in the workspace centre: its background and grid, panned and zoomed by mouse, touch and keyboard, smoothly on a mid-range phone. Tokens (T-1403) and fog (T-1404) will be drawn by the same renderer, so it must handle many sprites and masks. The page's CSP allows scripts only from its origin (no `'unsafe-eval'`, no blob workers), fetches only to its origin, and images from any http(s) host.

Q18 weighed PixiJS (WebGL), Konva (Canvas 2D scene graph), hand-written Canvas 2D, and SVG in React. Canvas 2D and SVG slow down on phones once a large background, many tokens and fog compositing are combined; Konva has the same Canvas 2D limits.

## Decision

1. **PixiJS v8** draws the map, with **pixi-viewport** for drag, pinch, wheel and deceleration. v8 has no Canvas 2D fallback, so Q18's "canvas fallback" wording no longer applies: it uses WebGL (WebGPU stays off). A browser without WebGL sees "This browser cannot draw maps" instead of the map.
2. **Lazy loaded.** `MapCanvas` loads only when a scene is shown, so Pixi stays out of the main bundle. React draws everything around the canvas: the scene picker, notices and zoom buttons.
3. **CSP.** `pixi.js/unsafe-eval` is imported so Pixi compiles its shaders without `new Function`. Backgrounds load through an `<img>`, not Pixi's `Assets` loader, which fetches and uses workers that the CSP blocks.
4. **External backgrounds** are loaded with `crossOrigin = 'anonymous'`. WebGL only draws images from another host that allows CORS. When it does not, the map shows the grid and a notice asking the GM to upload the image instead. Uploaded images are same-origin and always draw.
5. **Drawn on demand.** The app's own ticker never starts. A separate ticker drives pixi-viewport and renders only when the viewport is marked dirty (after a move, a resize, a new background), so an idle map costs no GPU time. Deceleration is off under `prefers-reduced-motion`.
6. **The camera** (`view.ts`) is plain data: the scene point at the panel's centre and the zoom. Keys, buttons and the clamp after each gesture go through it. Zoom stays between half the smaller of the fit zoom and 1:1, and the larger of 4× and the fit zoom, and the scene may be dragged until its edge meets the panel's far edge, so the space around it can be brought to the middle but the scene cannot be lost. The view is framed on the grid and the background together, whichever is larger. pixi-viewport gets the same zoom limits (`clampZoom`), so a wheel or pinch stops at a limit with the point under the pointer kept still; clamping only afterwards moved the map towards the pointer on each turn at the limit. The canvas wrapper writes the view to `data-zoom`, `data-x` and `data-y` for tests.
7. **Geometry** (`geometry.ts`) is shared with tokens to come. Hexes are pointy-top, `gridSize` wide, with odd rows shifted half a hex right. `cellAt` rounds in cube coordinates. The grid is one `Graphics` of 1 px lines (`pixelLine`), each shared hex edge drawn once; `hidden` and `none` grids draw no lines. The background is drawn at its own size from the top left, under the grid, since the cell size is in its pixels; stretching it to the grid distorted it whenever the grid changed. Images larger than 4096 px on a side are scaled down first, since not every phone GPU takes larger textures.
8. **Panels.** A **Map** panel sits in the centre of the default layout, ahead of the Table overview; on a phone it is the first tab. Players see the active scene, or "No scene is shown yet". GMs and assistants pick any scene to look at, marked "Preview" while players do not see it; the choice is saved with the layout. A **Scenes** panel, among the lists and only for them, creates, edits, orders, deletes and shows scenes through the ADR-066 endpoints.
9. **Keyboard.** The map is a focusable `application` region: arrows move the selected token a cell, if the member may move it, and otherwise pan; `+` and `-` zoom, `0` fits the scene. The zoom buttons cover touch users and screen readers.

## Consequences

- Phones and desktops get the same GPU path; browsers without WebGL cannot show maps.
- A GM using an external background must use a host that allows CORS, or upload the image.
- Opening a large hex scene builds its grid on the main thread: a 200 × 200 hex grid has about 120,000 edges and takes 0.8 s on a desktop and 2.7 s at 4× CPU throttling. A 40 × 30 hex grid takes 0.3 s on a desktop.
- The performance check of T-1402 ran on software WebGL (SwiftShader), because neither the development machine nor CI exposes a GPU to the browser. Its frame times are an upper bound; a check on a real mid-range phone is still owed and is recorded with each release.
