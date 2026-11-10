# ADR-080: Testing kits for plugin code

- **Status:** Accepted
- **Date:** 2026-11-10
- **Tasks:** T-1613
- **Covers:** FR-PLUGIN-10, FR-PLUGIN-16
- **Builds on:** ADR-047 (server code and `ctx`), ADR-073 (QuickJS), ADR-074 (plugin frames), ADR-077 (module overlays and panels)

## Context

The 5e study (`docs/studies/dnd5e-srd.md`, F18) and the dice-3d study (`docs/studies/dice-3d.md`, F7) found that plugin code is hard to test outside a running table:

- The SDK had no fake `ctx`, so dnd5e-srd built its own to test its handlers. That fake took any formula, so a handler's formula was only ever checked on a server.
- The server tests copied reference plugins without their code, because the server loads only compiled code (ADR-026).
- Nothing could render a module's overlay or panel outside a frame, so dice-3d tested its overlay only end to end.

## Decision

1. **`@vtt/sdk/testing` tests shared and server code, in Node.**
   - `fakeHandler(options)` returns a handler's input with a fake `ctx`.
     - Rolls give scripted totals, or the plugin's real formulas with scripted dice.
     - Counters start at the entity's data and stay within the bounds the test gives.
     - Posts, rolls, counter steps, sets and logs are recorded, and `ctx.fail` throws a `HandlerFailure`.
     - The fake checks no rights.
   - `loadTestSystem(folder)` validates a plugin's files and gives the engine's `Rules` for them: defaults, derived values, item totals and recipe rolls. Shared functions are passed in from `code/shared`, which the test imports.
   - `scriptedDice(...faces)` gives dice that land on the given faces, and throws when they run out or a face cannot be shown.
   - The kit reads files with Node, so it gets its own tsconfig (Node types). The rest of the SDK stays pure.
2. **`@vtt/sdk/client/testing` tests module frames.**
   - `createTestFrame(options)` returns a `Provider` for `ModuleFrameContext`, with the viewer, settings, system dice, lang texts and an encounter.
   - `emit` sends table events. `setSettings` and `setDice` change what the hooks return.
   - Every action and `setSetting` is recorded in `calls`. A `refuse` option refuses calls with a reason, as the server would.
   - It renders nothing itself: tests use React Testing Library, or `react-dom`, as usual.
3. **Plugin code may import the kits only from its tests.** In `workspace.mjs`, a restriction can give test files a looser list. `plugin-code` bans `@vtt/sdk/client/*` and allows `@vtt/sdk/client/testing` in tests. `plugin-server-code` bans `@vtt/sdk/testing` and allows it in tests. A packed plugin could load neither kit: the frame's import map has no testing module, and QuickJS has no Node.
4. **Server tests can load a reference plugin's compiled code.** `packedReferencePlugin(id)` in the server's test support runs the built `vtt-plugin pack` and reads the archive. `copyReferencePlugin(id, target, { code: true })` writes it to a plugin folder.
   - The server may not import the CLI (specs §4.4), so the tests run it as a separate process, as the e2e suite does.
   - `@vtt/plugin-cli` becomes a dev dependency of the server, so that turbo builds it before the server's tests.

## Consequences

- dnd5e-srd's handler tests use `fakeHandler`. Two of them roll the real formulas, and they found that the death save had failed on every roll since T-1609 (`@derived.saveEdge does not exist`). The death save now rolls `1d20 - @derived.d20Penalty`. A server test rolls it with the packed code.
- dice-3d's overlay is tested in a test frame. jsdom has no WebGL, so the throws run unseen and the tests read the landed faces from the overlay's data attributes.
- The Docker image's build also builds `@vtt/plugin-cli`, because turbo follows dev dependencies. It is a `tsc` build of a package whose dependencies the web app builds anyway.
- The kits are part of the SDK that T-1701 freezes for 1.x.
