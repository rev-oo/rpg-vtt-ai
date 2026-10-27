# ADR-047: Plugin shared and server code run in a worker thread per plugin

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0809
- **Decides:** specs §14 Q13
- **Refines:** specs §8.7, §8.10, ADR-025, ADR-026

## Context

0.1.0 runs only `code/client` (ADR-025). `code/shared` and `code/server` are packed but never loaded, so `handler` recipes fail with `handler_recipe`, and formulas can call only the built-in functions. T-0809 runs both entries.

Plugin code is trusted (Q1): an admin enables it explicitly. Trust covers intent, not mistakes, so Q13 asked how a broken plugin is kept from taking the server down. A handler can throw, reject long after it returned, loop forever or exhaust memory.

The formula evaluator (ADR-017) is synchronous. Shared functions are called from inside an evaluation, which rolls run in a database transaction.

## Decision

1. **One worker thread per plugin** (Q13). The server loads a plugin's `code/shared.js` and `code/server.js` into a `worker_threads` worker the first time a roll needs them.
   - The worker has a memory limit (64 MB of heap). Crashing or exceeding a time limit terminates it; the next roll starts a new one.
   - A rescan or install terminates every worker, so new code is loaded on next use.
   - Errors in the worker are logged with the plugin id and never reach the server's own handlers.
2. **Shared functions are called synchronously.** The main thread posts the call and blocks on `Atomics.wait` until the worker answers through a `MessagePort`, for at most **100 ms**. Past that, the call fails with `function_failed` and the worker is terminated. Arguments and results are formula values (ADR-017); the evaluator checks the result as before.
3. **Handlers are async and run outside the roll's transaction.** A handler recipe:
   - checks the request, the speaker and the recipients in a transaction, as recipe rolls do;
   - then runs the handler in the worker, for at most **5 s** in total; past that, the worker is terminated and the roll fails with `handler_timeout`;
   - fails with `handler_failed` when the handler throws or rejects, with its message in the server log only.
4. **The handler's `ctx`** (specs §8.10) is the only way out of the worker. Each call is a message to the main thread, which answers it for the sender of the roll:
   - `ctx.roll(formula)` rolls in the scope of the recipe's actor (data, derived values, settings, `@args`, custom dice, shared functions) with the server's secure RNG.
   - `ctx.chat.post({ text, rolls })` posts a message as the roll's speaker, to the roll's audience. `rolls` must be results of `ctx.roll` in the same call: the server keeps them and posts its own copies, so a handler cannot forge a result (FR-CHAT-03). A message with rolls is a `roll` message, one without is a `text` message. At most 10 posts per call.
   - `ctx.actors.get(id)` returns an actor of the table that the sender may see, with only the fields the sender may see (FR-SHEET-04).
   - `ctx.actors.adjust(id, path, delta)` steps a counter (§9.5) of an actor the sender may edit, through a direct connection to its live document, so connected sheets see it at once.
   - `ctx.log(message, data)` writes to the server log with the plugin id.
5. **What the roll returns.** A handler posts its messages itself. `POST /tables/:id/rolls` answers with the first message it posted, and `roll.request` publishes them all. A handler that posts nothing fails with `handler_no_message`, so every roll leaves a trace in the chat.
6. **The SDK.** `@vtt/sdk` exports `defineShared({ functions })` and `defineServer({ handlers, hooks })` with their types. Both return their argument; the worker checks the shape of each default export. Hooks are accepted and checked but not called until combat (M9).
7. **Packing.** `vtt-plugin pack` bundles `@vtt/sdk` into `code/shared.js` and `code/server.js`, which run where no `node_modules` exists. `code/client.js` keeps importing it from the page's import map (ADR-025). `code/shared` is compiled for a neutral platform, since the browser loads it too.
8. **The worker file** imports only `node:` modules, so it runs both from the built server and, through Node's type stripping, from the sources in tests.

## Consequences

- A plugin that loops, throws or leaks memory fails its own rolls and shows in the log; the server, other plugins and other tables keep working.
- Each shared function call costs a thread round trip. They run only in rolls on the server, which evaluate a few dozen formulas at most.
- Blocking the main thread is bounded at 100 ms per call, so a stuck shared function delays the server briefly once, then its worker is gone.
- Code is still trusted: a worker can use every Node API. The worker contains mistakes, it does not sandbox malice; sandboxing stays LATER.
- Handlers see the actors the sender sees, so a player's handler cannot read secret fields or step another player's counters.
