# Study: 3D dice as a module (T-1604)

**Date:** 2026-11-09 · **Plugin:** [`plugins/dice-3d`](../../plugins/dice-3d) · **Status:** findings and proposals await the user's choice

T-1604 builds a 3D dice module using only what the plugin format and the module SDK offer, as a module author would. The [authoring guide](../plugin-authoring.md) and the [file reference](../plugin-reference.md) were the references. Where they were not enough and the code had to be read, that is recorded under [What the docs did not answer](#what-the-docs-did-not-answer).

## What was built

`plugins/dice-3d` is a `kind: module` plugin with one overlay, `dice`, and five `user` settings: which rolls to show (every roll you see, or only yours), the dice and number colours, the dice size, and how many seconds the dice stay after landing.

For each `chat.message` event that has rolls, the overlay:

1. picks the dice to throw from `message.rolls`: one die per result of d4, d6, d8, d10, d12 and d20; a tens and a units d10 for d100 (100 shows as 00 and 0). Dice that do not count (dropped, rerolled) are thrown dimmed. Other dice (custom dice such as dF, d3…) are skipped, and so is a message with more than 30 dice;
2. throws them in a [cannon-es](https://github.com/pmndrs/cannon-es) world ahead of time, recording every step until no die moves. The throw is seeded with the message id, so viewers with the same window size see the same throw;
3. reads which face (on a d4, which corner) landed up, and swaps labels so that face shows the server's result. The labels opposite those two faces are swapped too, so opposite faces still add up as on real dice;
4. plays the recorded throw back with [three.js](https://threejs.org), under an orthographic camera looking straight down on an invisible floor the size of the page, then fades the dice out. With `prefers-reduced-motion`, the dice appear already landed.

The chat never waits: it shows the result at once, while the dice still roll.

| Part                     | Where                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| Dice shapes              | `code/src/shapes.ts`: the five Platonic solids and a pentagonal trapezohedron |
| Labels and relabelling   | `code/src/labels.ts`                                                          |
| Which dice a roll throws | `code/src/dice.ts`                                                            |
| Physics                  | `code/src/simulate.ts`                                                        |
| Rendering                | `code/src/stage.ts`                                                           |
| The overlay              | `code/client.tsx`                                                             |
| Unit tests (55)          | `code/test/`: run `pnpm test` and `pnpm typecheck` in `code/`                 |
| e2e                      | `e2e/tests/dice-3d.spec.ts`                                                   |

The e2e packs, installs and enables the module and adds it to a table. The GM rolls `1d20 + 2d6 + 1d4 + 1d8 + 1d10 + 1d12 + 1d100`. The test checks that the chat shows the total while the GM's dice are still rolling, and that both the GM's and a player's dice land showing exactly the server's results, then fade. After the player turns **Overlays** off, their dice frame is gone while the GM's still rolls. It passes on Chromium; Firefox and WebKit run in CI.

The packed archive is 159 KB, with a 627 KB `code/client.js`, almost all of it three.js and cannon-es.

### Setting up the code

The guide says client code may import anything, and `vtt-plugin pack` bundles it, but not where those packages come from. The study task may not touch the workspace, so `code/package.json` is a package of its own: exact versions of three.js and cannon-es, plus TypeScript, Vitest, `@types/three` and `@types/react`, and the SDK linked from `packages/sdk` for its types (it is not published). Install it with:

```bash
cd plugins/dice-3d/code
pnpm install --ignore-workspace --lockfile=false
```

There is no lockfile, so the versions of transitive dependencies can change between installs. `pack` resolves imports from the plugin folder, so it finds `code/node_modules`. It compiles only `code/client.*`, and skips the other `.ts` and `.json` files under `code/` and `node_modules`, so the tests and `package.json` stay out of the archive.

## Findings

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                        | Kind          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| F1  | **The shape of a roll is not documented.** The guide says `chat.message` comes "including its `rolls` with dice and totals". A dice module needs each die's type and value, and whether it counts. That is only in `packages/shared/src/api/rolls.ts` (see C1).                                                                                                                                | Docs gap      |
| F2  | **The SDK exports no message or roll types.** `TableEvent` is exported, but `ChatMessage`, `Roll`, `DiceRoll` and `DieResult` are not. Workaround: `Extract<TableEvent, { type: 'chat.message' }>['message']`.                                                                                                                                                                                 | SDK gap       |
| F3  | **Plugin code has no documented way to depend on npm packages.** Bundling works, but installing, versioning and type-checking are left to the author. The guide's advice for types ("keep the plugin in this repository's `plugins/` folder, as `tiny-d20` does") does not cover a plugin with dependencies of its own. Workaround: a standalone `code/package.json` with no lockfile (above). | Format gap    |
| F4  | **Nothing in CI checks plugin code.** `pnpm lint` ignores `plugins/dice-3d` (ESLint reports every file as ignored), and the plugin's unit tests and type check run only by hand. The e2e installs the code's dependencies itself before packing.                                                                                                                                               | Tooling gap   |
| F5  | **Settings have no colour type.** Colours are free `string` settings, so members type `#8b1e2d` into a text field with no picker. The frame must check the value itself; dice-3d lets the canvas parse it and falls back to the default.                                                                                                                                                       | Format gap    |
| F6  | **Enum choices have no labels of their own.** The settings form passes each `enum` value through the plugin's translations (C5), but the docs do not say so. To get translated choices, dice-3d's values are lang keys (`rolls.all`, `rolls.mine`), and those keys become the stored values.                                                                                                   | Docs gap      |
| F7  | **An overlay does not know the page's layout.** It covers the whole page and cannot tell where the map, the chat or the panels are, so dice land on top of the chat and the sheets. A dice tray over the map would need the map panel's box.                                                                                                                                                   | SDK gap       |
| F8  | **Custom dice cannot be drawn.** A custom die's result carries its `label`, but a frame does not see the system's `dice.json`, so it cannot know the die's faces. dice-3d skips them (dF, for example).                                                                                                                                                                                        | SDK gap       |
| F9  | **The chat shows the result before the dice land.** This is by design (FR-PLUGIN-16: the chat never waits for a frame), but many players of 3D dice expect the result to stay hidden until the dice stop. It cannot be done from a module.                                                                                                                                                     | Design choice |
| F10 | **An overlay holds a WebGL context all the time.** It stays mounted while the table is open, even when no dice are shown, and the map panel has a WebGL context too. Browsers cap how many contexts a page may hold, so several 3D modules could push the map's context out. Nothing tells an overlay that it is idle or hidden. Not observed in this study, only a risk.                      | Rough edge    |
| F11 | **Throws differ between window sizes.** Each viewer simulates the throw locally, on a floor the size of their window, so the throw is the same only for viewers with the same window size. The faces always match the server's results. Sharing one throw would need either a fixed floor in world units or the throw sent with the event.                                                     | Rough edge    |
| F12 | **Testing a frame takes data attributes.** The frame is an opaque-origin iframe. The e2e reads its state through `data-state`, `data-message` and `data-shown` on the overlay's root element, which the module writes for that purpose. There is no SDK helper to render a module component with a fake table in unit tests, though `ModuleFrameContext` is exported and could serve.          | Rough edge    |
| F13 | **Small doc inaccuracies.** The guide says "a file over 1 MB is not read"; that applies only to JSON and CSS files (C3). The `rolls` field's comment says it is "empty for other kinds" than `roll`, but recipe (`card`) messages carry their roll in it too (C4). The guide lists `code/client.js` as a module file, while authors write `client.tsx` and `pack` compiles it.                 | Docs gap      |

The plugin format worked well for the rest. Overlays, user settings, translations and the per-user Overlays switch all worked as documented. WebGL runs in the sandboxed frame. The frame reads `prefers-reduced-motion` itself; that path is not tested. The "only my rolls" choice works by comparing `message.senderId` with `useViewer().id`; it is not covered by the e2e.

## What the docs did not answer

These came from reading the code, as the user asked to record:

| #   | Question                                                    | Answer, and where                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | What is in `message.rolls`?                                 | `packages/shared/src/api/rolls.ts`. Each roll has `expression`, `resolved`, `total` and `dice`, one entry per dice term. Each term has `formula`, `count`, `die` (`d20`, `d100`, or a custom die's name such as `dF`), `total` and `results`. Each result has `value` and `active`, plus `label` for custom dice and the flags `rerolled`, `exploded`, `dropped`, `success` and `failure`. |
| C2  | Where do imported packages come from when packing?          | `packages/plugin-cli/src/commands/pack.ts`. Rolldown bundles each `code/{client,server,shared}.*` entry with the plugin folder as its working directory, so packages resolve from `node_modules` there. `react`, `react-dom` and `@vtt/sdk` stay external in client code. Other `.ts` and `.json` files under `code/` are not shipped, and neither are `node_modules` or dot files.        |
| C3  | Does the 1 MB file limit apply to the bundled `client.js`?  | No. `packages/plugin-io/src/folder.ts` applies it to JSON and CSS files only. Archives may hold files up to 20 MB (`packages/plugin-io/src/archive.ts`).                                                                                                                                                                                                                                   |
| C4  | Do rolls from sheet buttons (recipe cards) reach the frame? | Yes. `apps/server/src/domain/rolls.ts` creates `card` messages with `rolls: [result.roll]`, so dice-3d throws dice for sheet rolls too.                                                                                                                                                                                                                                                    |
| C5  | How does the settings form show `enum` choices?             | `apps/web/src/features/settings/SettingFields.tsx` shows each value through `translate`, so a value that is a lang key shows its text.                                                                                                                                                                                                                                                     |
| C6  | What is the overlay frame's title, to find it in e2e?       | `<plugin name>: <overlay name>`, here `3D dice: dice`. Found in `e2e/tests/module-frames.spec.ts`.                                                                                                                                                                                                                                                                                         |

## Proposed follow-up tasks

None of these are planned. Those the user approves join M16.

| #   | Task                                                                                                                                                                                                                                                    | From   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P1  | **Document table events in full and export their types.** Describe the message and roll fields in the guide (C1, C4), and export `ChatMessage`, `Roll`, `DiceRoll` and `DieResult` from `@vtt/sdk/client`.                                              | F1, F2 |
| P2  | **Dependencies for plugin code.** Support and document a `code/package.json`: either add `plugins/*/code` to the workspace with its lockfile, or give `vtt-plugin` an install step. Then fix the guide's advice on types for plugins with dependencies. | F3     |
| P3  | **Check plugin code in CI.** Lint, type-check and unit-test the code of the plugins in `plugins/`, and add dice-3d to the validator's reference-plugin tests.                                                                                           | F4     |
| P4  | **Better setting inputs.** Add a colour setting (a `string` with `format: "colour"`, checked by the server and edited with a colour picker), and labels for `enum` choices, or at least document that `enum` values are translated.                     | F5, F6 |
| P5  | **Layout for overlays.** Add an SDK hook that gives the boxes of the page's named parts (`map`, `chat`, `workspace`…) and tells the frame when they change, so an overlay can keep to the map.                                                          | F7     |
| P6  | **Custom dice for frames.** Pass the table system's custom dice (faces and labels) to module frames, so a dice module can draw them.                                                                                                                    | F8     |
| P7  | **Idle overlays.** Tell a frame when the page is hidden, or when the viewer turns overlays off and on, so it can let go of its WebGL context; or document the context limit for module authors.                                                         | F10    |
| P8  | **Fix the small doc errors** of F13 and C3.                                                                                                                                                                                                             | F13    |

## Decisions for the user

| #   | Question                                                                                                                      | Options                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Should a member be able to hide roll results in the chat until their dice land (F9)?                                          | Keep "the chat never waits" (no change), or add a per-user setting that delays showing results by at most a few seconds, which changes FR-PLUGIN-16. |
| D2  | Should dice-3d stay in `plugins/` as a reference module, checked by CI like `tiny-d20` (P3), or only as this study's example? | Reference module (needs P2 and P3), or example only.                                                                                                 |
| D3  | Should viewers see the same throw (F11)?                                                                                      | Leave throws per window (now), or simulate on a fixed floor in world units and scale it to each window, so every viewer sees the same throw.         |
