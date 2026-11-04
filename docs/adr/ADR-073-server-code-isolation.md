# ADR-073: Plugin shared and server code run in QuickJS inside their worker

- **Status:** Accepted; amended by [ADR-074](ADR-074-client-code-sandbox.md)
- **Date:** 2026-11-03
- **Tasks:** T-1503
- **Covers:** FR-PLUGIN-13, §8.10
- **Amends:** ADR-047

## Context

ADR-047 runs each plugin's `code/shared.js` and `code/server.js` in a worker thread with time and memory limits. That contains mistakes but not intent: the worker is Node, so plugin code can `import('node:fs')`, read `process.env`, open sockets or spawn processes. FR-PLUGIN-13 asks that `code/server` run with no Node API reachable, keeping the worker per plugin and its time limits.

Three runtimes were considered, and the user chose QuickJS:

- **QuickJS compiled to WebAssembly** (`quickjs-emscripten-core` with the `@jitl/quickjs-wasmfile-release-sync` build). It is a separate JavaScript engine: nothing of Node exists inside it. It is pure JavaScript and WebAssembly, so it runs the same on the amd64 and arm64 images, and it has its own memory limit and interrupt. It is an interpreter, slower than V8, which suits formula functions and short handlers.
- **isolated-vm**, a separate V8 isolate. It is fast and strongly isolated, but it is a native addon, built per Node version and architecture, and it needs `--no-node-snapshot`.
- **`node:vm` contexts.** These need no dependency, but Node documents them as not a security mechanism: objects from the host realm lead back to its `Function` and `process`.

## Decision

1. **One engine per worker.** The worker of ADR-047 stays: one per plugin, with its heap limit, the 100 ms limit on shared functions (the main thread waits on `Atomics`) and the 5 s limit on handlers, commands and hooks, after which the main thread terminates it. Inside it, the worker loads QuickJS and evaluates `code/shared.js` and `code/server.js` there as ES modules. Plugin code runs only in that engine.
2. **Nothing but the language.** The engine has the ECMAScript built-ins and no module loader, so an `import` fails the load. It has no `process`, `require`, `Buffer`, `fetch`, timers, sockets or WebAssembly. Packed code bundles what it imports (ADR-047 point 7), so packed plugins run unchanged.
3. **Values cross as JSON.** Arguments, inputs, results and `ctx` answers are copied through `JSON.stringify` and the engine's own `JSON.parse`, which was taken before plugin code ran. No host object or function reaches plugin code. A result that JSON cannot carry fails like one that cannot be sent.
4. **`ctx` is built in the engine.** A bootstrap script, run before the plugin's modules, builds each call's `ctx` in a closure over the host functions and its call number. Plugin code sees neither, so it cannot speak for another call. `ctx.fail` throws a `PluginFailure` error, as before. `console` writes to the worker's output, which the server logs, as before.
5. **Engine limits.** The engine may allocate 32 MB and use a 512 KB stack. Past that, the running code fails with an error and the engine keeps serving the plugin. An interrupt stops code that runs past twice the host's time limit. This is a backstop: the host's own limits act first and terminate the worker.
6. **The worker file** now imports the two QuickJS packages, as well as `node:` modules (ADR-047 point 8). Both resolve from the server's dependencies, so it still runs from the built server and from source in tests.

## Consequences

- Shared and server code reach the server only through `ctx`. An admin enabling plugin code still trusts it with what `ctx` allows for each roller, but no longer with the server's files, environment and network.
- Plugin code runs in an interpreter. The reference plugins' functions, handlers, commands and hooks run unchanged, but heavy computation is slower than it was on V8.
- Each worker compiles the engine once, when the plugin's code is first used.
- The browser still loads `code/shared` as a module for sheets. Sandboxing the browser side is T-1502 (Q17). _Amended by ADR-074: the browser runs `code/shared` in QuickJS too._
