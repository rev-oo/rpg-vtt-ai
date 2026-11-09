# Study: 3D dice as a module (T-1604)

`plugins/dice-3d` is a module whose overlay throws 3D dice (d4, d6, d8, d10, d12, d20 and d100 as two d10s) for each roll the viewer sees and lands them on the results the server rolled. It is built only with what the plugin format and the module SDK offer (ADR-075, ADR-077), with [three.js](https://threejs.org) to draw and [cannon-es](https://github.com/pmndrs/cannon-es) for the physics, both bundled by `vtt-plugin pack`. This study records what was missing, what needed a workaround, what was rough, and what needed reading the app's code rather than the [authoring guide](../plugin-authoring.md). It ends with proposed follow-up tasks.

## How the module works

- **Overlay.** `code/client.tsx` exports one click-through overlay, `dice`. It listens with `useTableEvents` and throws for each `chat.message` with rolls. Edited messages (`chat.updated`) are not thrown again.
- **Which dice.** `src/dice.ts` turns each result of each dice term into physical dice: `d4`–`d20` as themselves, `d100` as a tens die (`00`–`90`) and a units die (`0`–`9`). Dropped and rerolled dice (`active: false`) are thrown dimmed. Custom dice and other sizes (`d3`, `d7`…) are left out (see F6). A throw has at most `maxDice` dice, and a d100's two dice go together or not at all.
- **Simulate, then label, then play.** `src/simulate.ts` runs the whole throw in cannon-es at a fixed 60 Hz step before anything is drawn. It records every step and ends when every die has been still for a quarter of a second, retrying a throw that ends with a die tilted (up to 4 tries). It then reads which face is up (for a d4, which corner). `src/labels.ts` writes the server's result on that face and moves the face's usual number to where the result was. `src/stage.ts` builds the meshes with those labels and plays the recorded steps back. The physics never needs to know the numbers, and every viewer's dice land on the same results, though along different paths.
- **Shapes.** `src/polyhedra.ts` builds each die from its vertices with a small convex hull, so the physics body and the mesh share one face list. The d10 is a pentagonal trapezohedron whose rings sit at the height that keeps its kites flat.
- **Settings.** `colour` (user scope, an enum of five), `seconds` the dice stay after landing (user), `showOthers` (user: throw other people's rolls too) and `maxDice` (instance, 1–30).
- **State on the element.** The overlay's root carries `data-state` (`idle`, `rolling`, `resting`), `data-shown` (what each die shows on top, read back from its final pose) and `data-drawing` (whether WebGL draws). The e2e test reads these, since a canvas cannot be read for numbers.
- **Without WebGL** the throw still runs, unseen, so the state stays right. With `prefers-reduced-motion`, the dice appear already landed.

## Findings

Each finding is a gap (the format or SDK lacks it), a workaround (done another way), or a rough edge (it works but is awkward).

### F1. Plugin code with npm dependencies is undocumented (workaround)

The guide says that what client code imports, apart from React and the SDK, "is bundled by `vtt-plugin pack`", but not where `pack` looks for it. From `packages/plugin-cli/src/commands/pack.ts`: rolldown runs with the plugin folder as `cwd`, so imports resolve from a `node_modules` next to `code/` or above it. Every other file under `code/` with a code or JSON extension is skipped, and `node_modules` and dot files never reach the archive (`isIgnoredFile` in `plugin-io`). An author outside this repository would have to find this out alone, and then run `npm install` in `code/`.

Inside the repository, `plugins/dice-3d/code` became a pnpm workspace package (`@vtt/plugin-dice-3d`, in `pnpm-workspace.yaml`) with three and cannon-es as dependencies, its own `tsconfig.json`, unit tests and lint. That needed:

- registering it in `packages/config/eslint/workspace.mjs` (type `plugin-code`), and un-ignoring it in `packages/config/eslint/index.mjs`, which ignores `plugins/*/code/` because plugin code "is not a workspace module";
- allowing the `sdk` element as well as `sdk-client`: `@vtt/sdk/client` resolves to the SDK's build (`packages/sdk/dist/src/client`), which the boundary rules see as `sdk`. A `no-restricted-imports` rule keeps imports to `@vtt/sdk/client` alone;
- making the plugin-schema test helpers skip `node_modules` and the JSON under `code/` (`package.json`, `tsconfig.json`), as `pack` does, so dice-3d could join the reference plugins.

The validator accepts these extra files (`code/package.json`, `code/src/*.ts`, `code/test/*.ts`) without a word, which is right but also undocumented. Turborepo warns that the package's `typecheck` has no outputs, since it only runs `tsc --noEmit`.

### F2. Frames cannot start workers (gap)

The frame page's policy (`FRAME_PAGE_POLICY` in `apps/server/src/http/security-headers.ts`) has `default-src 'none'` and no `worker-src`, so a frame cannot start a Worker, even from a `blob:` URL. The physics therefore runs on the frame's main thread. Measured in Node: 1 to 20 dice take 20–60 ms per throw, 40 dice about 400 ms (and they often do not settle within 6 seconds). A sandboxed frame may share its thread with the table page, so a large throw can stall the page briefly. The workaround is a cap: `maxDice` stops at 30.

### F3. Large client code is loaded again in every frame (rough edge)

The packed `code/client.js` is 627 KB (159 KB zipped), almost all of it three.js and cannon-es. From `apps/web/src/plugin-frame/frame.tsx` and `plugin-host/load.ts`: the host sends the code to each frame by `postMessage`, and the frame imports it from a `data:` URL. A module's code runs in a probe frame that lists its exports, and again in each overlay and panel frame. Each frame parses the whole bundle once. That is acceptable for one overlay, but a module with an overlay and two panels would load three.js four times.

### F4. An overlay covers the whole page and knows nothing of its layout (gap)

Overlays fill the window above the workspace (`ModuleOverlays`: `fixed inset-0 z-30`). The dice land anywhere, so they cover the chat, the actor list or the map alike, and the frame cannot learn where any of them are. A dice tray over the map, or a throw that stays clear of the chat, cannot be built.

### F5. Settings: no labels for enum values, no colour type (gap)

`colour` is a `string` setting with an `enum`. The settings form shows each value through `translate(option)` (`apps/web/src/features/settings/SettingFields.tsx`), so a value is translated only if it is itself a lang key: pt-BR members see "crimson". The workaround would be values such as `colour.crimson`, which leak into the stored data. There is also no colour type, so a free choice of colour would be a text field. `useModuleSettings` returns untyped `Value`s, so the client checks each setting by hand (`isColour`, `number()`).

### F6. Modules do not know the system's custom dice (gap)

A roll's results carry the face's `label` for custom dice (`dF` and the like), but a module cannot see the system's `dice.json`, so it does not know the other faces or how many there are. dice-3d leaves custom dice out. Die names follow `d<sides>` for standard dice and `d<NAME>` for custom ones (`packages/formula/src/dice.ts`); the guide documents the second but not the first. `d100` is an ordinary 100-sided die to the formula engine; the module chooses to show it as two d10s.

### F7. No test support for module components (rough edge)

The SDK offers no way to render an overlay outside a frame (a provider for `ModuleFrameContext` with fake events, settings and actions). dice-3d keeps its React component thin and tests the pure parts (shapes, dice, labels, physics) with Vitest. The overlay itself is tested only end to end, through data attributes on its root.

### F8. What worked as documented

- `useTableEvents` delivers rolls with every die's result, already filtered for the viewer, and never replays history, so old rolls are never thrown again.
- The chat does not wait for the frame: the e2e test reads the result in the chat while the dice still roll.
- The per-user **Overlays** switch removes the frame entirely, so a member who turns it off pays nothing.
- WebGL, canvas textures (`img-src data: blob:`) and `matchMedia` work in the sandboxed frame. The frame's page is transparent for overlays (`frame.tsx` sets `background: transparent` on `html` and `body`), which the guide implies but does not say.
- `useModuleSettings` redraws the overlay when the viewer changes a setting, with no reload.

## What needed reading the code

Answers the guide does not give, and where they came from:

| Question                                          | Answer                                                                                                                   | Source                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| How are dice named in a roll?                     | `d<sides>` for standard dice (`d20`, `d100`), `d<NAME>` for custom ones (`dF`)                                           | `packages/formula/src/dice.ts` (`standardDie`)           |
| What does a die result hold?                      | `value`, `active`, and optional `label`, `rerolled`, `exploded`, `dropped`, `success`, `failure`; only active dice count | `packages/shared/src/api/rolls.ts`                       |
| Where and how big is an overlay?                  | The whole window, above the workspace (`z-30`); pointer events off unless `interactive`                                  | `apps/web/src/features/workspace/ModuleFrames.tsx`       |
| Is the overlay's background transparent?          | Yes: the frame sets `html, body { background: transparent }` for overlays and panels                                     | `apps/web/src/plugin-frame/frame.tsx` (`startModule`)    |
| Can a frame use WebGL, canvas images, workers?    | WebGL and `data:`/`blob:` images yes; workers no (no `worker-src`)                                                       | `apps/server/src/http/security-headers.ts`               |
| Where does `pack` resolve npm imports?            | From the plugin folder (`cwd`), so a `node_modules` in `code/` or above; other files under `code/` are skipped           | `packages/plugin-cli/src/commands/pack.ts`               |
| Does the validator accept extra files in `code/`? | Yes: `package.json`, `tsconfig.json`, sources and tests pass; `node_modules` and dot files are ignored                   | `packages/plugin-io/src/archive.ts` (`isIgnoredFile`)    |
| How often does module code run?                   | Once in a probe frame that lists its exports, then once per overlay or panel frame                                       | `apps/web/src/plugin-frame/frame.tsx` (`start`, `probe`) |
| Are enum values translated in the settings form?  | Only if the value is itself a lang key                                                                                   | `apps/web/src/features/settings/SettingFields.tsx`       |

## Proposed tasks

For the user to approve; approved ones join M16.

| ID  | Task                                                                                                                                                                                                                                                     | From   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P1  | **Plugin code with dependencies.** Document in the authoring guide where `pack` resolves imports and which files under `code/` it leaves out, with an example `code/package.json`; have `pack` print the size of each bundle and warn above a threshold. | F1, F3 |
| P2  | **Workers in frames.** Allow `worker-src blob:` in the frame page's policy (and the page's own `<meta>` policy), with a security review, so modules can run heavy work off the main thread. Then move dice-3d's physics into a worker and lift its cap.  | F2     |
| P3  | **Declared exports.** Let `plugin.json` (or a small `module.json`) declare a module's overlays and panels so the app needs no probe frame, saving one full load of the code per table load.                                                              | F3     |
| P4  | **Overlay regions.** Let an overlay declare where it draws: the whole page, or over a named part such as `map`. The app sizes and moves the frame with that part, and the overlay follows it as panels move.                                             | F4     |
| P5  | **Settings polish.** Add `enumLabels` (a lang key per value) and a `colour` format for `string` settings, drawn as a colour picker; generate a typed settings object for plugin code.                                                                    | F5     |
| P6  | **System dice for modules.** Give module frames the table system's custom dice (faces, labels, values), so a module can draw them; document die names (`d<sides>`, `d<NAME>`) in the guide.                                                              | F6     |
| P7  | **Module test kit.** Export a test provider from the SDK (`@vtt/sdk/client/testing`) that renders an overlay or panel with fake events, settings and actions, and records what it asked for.                                                             | F7     |

P2 and P4 change the module contract before the API freeze (T-1701), so they matter most if modules are to stay stable after 1.0. P1 and P6 are documentation and small additions.

## Decisions

- **D1. The dice show results; they never delay them.** The chat shows a result at once, as T-1603 requires. A "reveal after the dice land" option would need the chat to wait on a frame, which ADR-077 rules out.
- **D2. Physics first, labels after.** Landing on a given face by steering the physics would bend the throw. Relabelling after a free throw keeps it natural. The cost is that a die's numbers are not the standard layout: the result and one other number swap places.
- **D3. Dice are thrown per viewer.** Each viewer simulates their own throw, so the paths differ between screens while the results match. Sharing a throw would need the server to send a seed with each roll, a core change no other feature needs yet.
