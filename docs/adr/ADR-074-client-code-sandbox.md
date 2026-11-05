# ADR-074: Plugin client code runs in sandboxed frames; shared code runs in QuickJS in the browser

- **Status:** Accepted
- **Date:** 2026-11-04
- **Tasks:** T-1502
- **Covers:** FR-PLUGIN-13, §8.10, Q17
- **Amends:** ADR-025, ADR-047, ADR-073

## Context

ADR-025 loads a system's `code/client.js` into the app's page with a dynamic `import()`, and renders its components in the app's React tree. The browser also imports `code/shared.js` there, so sheets can call its functions from formulas (ADR-047). Plugin code in the page can do anything the page can: read the DOM, the CSRF token and every open document, and call the API as the signed-in user. ADR-073 took Node out of reach on the server; FR-PLUGIN-13 asks the same of the browser, with access to sheets only through the SDK bridge.

Q17 asked how. The user chose, for client code:

- **a sandboxed `<iframe>` per custom node and per card**, rather than one frame per plugin drawing into the page, or a worker with no DOM. Each frame renders one component with React, so plugin components keep their React API and the SDK hooks keep their signatures.

and, for shared code, which formulas call synchronously:

- **QuickJS in the browser**, the engine the server uses (ADR-073), compiled to WebAssembly. A frame or a worker cannot answer a synchronous call.

### Options considered for client code

- **A sandboxed frame per node or card** (chosen). Each component renders with its own React in a frame with an opaque origin and no network. Isolation is strong, the plugin API does not change, and components may use any DOM and CSS. Each frame carries its own React, a frame takes its height only after it renders, and focus, portals and popovers cannot cross the frame's edge.
- **One frame per plugin.** One frame renders all of a plugin's nodes as overlays placed over their slots in the sheet. There is one React per plugin, but keeping the overlays aligned through layout changes, scrolling and dock resizes is fragile, and overlapping nodes are hard.
- **A frame on a separate origin** (such as `plugins.<host>`). Frames get a real origin of their own, so caching works normally and plugins can load their own images and fonts. Every self-hosted instance would need a second host name with its own TLS and DNS.
- **Remote rendering from a worker or QuickJS** (the pattern of Shopify's remote-ui). Plugin code returns a tree of allowed components and props, which the app draws with its own React and `@vtt/ui`. There is no React per node, the look and theme are the app's, and layout and focus behave like the rest of the sheet. Plugins lose arbitrary DOM, CSS and React: the SDK would have to offer a fixed set of components, and events would reach plugin code asynchronously. Running the plugin in the page's QuickJS instead of a worker makes calls synchronous, but interpreted and too slow for React itself.
- **Same-realm isolation**, with SES (`lockdown()` and Compartments) or the TC39 ShadowRealm. Plugin code runs in the app's page with frozen built-ins and only the objects it is handed, so its React could render straight into the app's tree. Every DOM object it touches would need a wrapper that is easy to get wrong, SES conflicts with some libraries, and ShadowRealm has not shipped in browsers.
- **Declarative sheets only.** Removing client code and growing the JSON node vocabulary (as tiny-pool works) leaves nothing to isolate, but every new widget needs a change to the core.
- **Shadow DOM and Web Components** isolate styles only, and give no security.

Plugin code is TypeScript or JavaScript, which `vtt-plugin pack` compiles before install. Writing code in the app would need a compiler in the browser (esbuild-wasm, sucrase or TypeScript's `transpileModule`), and the result would still run in the sandbox above.

## Decision

1. **The frame page.** The web build emits `/plugin-frame.html`, built by `apps/web/scripts/frame-page.ts` (served by Vite in dev). It is self-contained: React, ReactDOM, `@vtt/sdk/client` and the frame's half of the bridge (`src/plugin-frame/frame.tsx`) inline as one classic script, and an import map that points `react`, `react/jsx-runtime` and `@vtt/sdk/client` at `data:` modules re-exporting those from the frame's global. Its policy, in a `<meta>`, lets those two inline scripts run by hash and `data:` modules load, and nothing else: `default-src 'none'`, so no `connect-src`, no images or fonts from a server, no frames. The server sends it with `sandbox allow-scripts` and the same restrictions as a header, and without `X-Frame-Options`: the page holds no data and reaches nothing, so any page may frame it.
2. **One frame per node or card.** `PluginFrame` renders `<iframe sandbox="allow-scripts" src="/plugin-frame.html">`. Without `allow-same-origin` the frame has an opaque origin: no cookies, no storage, no access to the app's window, and its requests carry no session. The app fetches `code/client.js` with the session and hands it to the frame as text; the frame imports it as a `data:` module.
3. **The bridge.** Messages are `postMessage` with target `*` (the frame's origin is opaque). The app accepts a message only from that frame's window and only if it passes `frameMessageSchema` (`src/plugin-host/frame-protocol.ts`).
   - App → frame: `init` with the code, the plugin's texts, the page's stylesheets as text and what to render; then `sheet` whenever a node's sheet changes.
   - Frame → app: `ready`, `height` (the frame takes its content's height, capped at 4000 px), `set` and `adjust` (field writes, as dot paths relative to the node's row), `exports` and `failed`.
   - The frame answers `useField`, `useDerived`, `useActor` and `useTranslate` from the last sheet it was sent: the data the viewer sees, the derived values, the actor and `readOnly`. A write goes to the app, which drops it on a read-only sheet and otherwise passes it to the sheet's store, which checks it as it checks the viewer's own edits.
   - A card frame gets the stored card, the rolls, the speaker, and `translate` built from the plugin's texts.
4. **Exports.** Once per load, the app runs the code in a hidden frame that lists the names under `nodes` and `cards`. The sheet mounts a frame for each `custom:<name>` node the code exports; a card message uses a frame when the code exports that card. If the code fails to load, the sheet says so and custom nodes show the missing-node notice, as before.
5. **Styles.** The frame gets the page's stylesheets as text: the app's, so components look like the app (light and dark follow the system setting in both), and the plugin's scoped ones (ADR-021). The frame's root carries `data-plugin="<id>"`, so scoped selectors match.
6. **Failures.** An error boundary in the frame reports a failing component; the app logs it and shows `plugin.componentFailed` in place of the frame. A frame that navigates away is treated as failed.
7. **Shared code in QuickJS.** The app fetches `code/shared.js` as text and evaluates it as a module in a QuickJS engine in the page, loaded only for systems with shared code. Functions are called synchronously, with values as JSON, a 100 ms interrupt per call, 32 MB of memory and a 512 KB stack, as on the server. The engine has no DOM, cookies or network. The page's policy gains `'wasm-unsafe-eval'`, which lets WebAssembly compile and allows no JavaScript `eval`.
8. **The app page no longer shares modules.** The root layout's import map, the `/plugin-runtime/` shims and the app's runtime global are gone (amends ADR-025 point 4); `finish-page` no longer moves an import map. `vtt-plugin pack` still leaves `react` and `@vtt/sdk` out of client bundles, and the frame provides them, so packed plugins run unchanged.

## Consequences

- Plugin code in the browser reaches the app only through the bridge: it cannot read the page, the session or other documents, or call the API. The e2e fixture's `probe` node checks this in every browser.
- Each custom node and card is a frame with its own copy of React (about 300 KB of HTML, cached once). A sheet with many custom nodes costs more memory than before.
- A frame takes its height after it renders, so custom nodes and cards appear a moment after the rest of the sheet.
- Components that relied on the page, such as portals, focus moving between a node and the sheet, or reading app state, no longer work. The SDK never offered these.
- Plugin images and fonts cannot load from the plugin's files inside a frame; components can use `data:` URLs. The plugin's CSS, applied in the page, can still use its files for core nodes.
- Tests in jsdom run no frames: the host's half is tested by playing the frame's messages, and the frame's half in the e2e suite.
