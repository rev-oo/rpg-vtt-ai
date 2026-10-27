# ADR-048: Plugin slash commands run like handler recipes

- **Status:** Accepted
- **Date:** 2026-10-27
- **Tasks:** T-0804
- **Covers:** FR-PLUGIN-10
- **Refines:** ADR-047, ADR-018

## Context

The chat knows two commands, `/r` and `/gmr` (ADR-018), and the browser answers any other `/name` with "Unknown command". FR-PLUGIN-10 lets plugins add commands. Since ADR-047, `code/server` runs in a worker per plugin with a restricted `ctx`, which is what a command needs too.

The browser does not know a system's commands: they are in server code, which the browser never loads.

## Decision

1. **Declaration.** `defineServer({ commands: { name: (input) => … } })`. A name is lower-case letters, digits, `-` and `_`, starting with a letter, up to 32 characters. `r` and `gmr` stay built in: a plugin command with either name, or with an invalid name, is ignored with a warning in the log.
2. **One endpoint.** The browser keeps handling `/r` and `/gmr`. It sends any other well-formed `/name args` to `POST /tables/:id/commands` with `{ name, args, audience, recipientIds, actorId }`. The server answers `422 unknown_command` when the table's system declares no such command, and the browser then shows the same notice as before, so a typo reads alike whoever handles it. Invalid names stay unknown without a request.
3. **Running.** A command runs exactly like a handler recipe (ADR-047): same worker, time limit, `ctx`, posting rules and errors. It gets `{ ctx, actor, args }`: `actor` is the actor the member speaks as, or `null`, and `args` is the text after the name. `ctx.roll` rolls against that actor's data, or against no data without one. The answer is the first message posted, and all are published.
4. **`ctx.fail(message)`.** Commands need to say how to use them. `ctx.fail` stops the code with a message the caller sees, as the error of the request (`handler_failed`). Other errors keep showing only "… failed", with the details in the server log. Handlers get `ctx.fail` too.
5. **Audience.** Commands use the composer's audience and recipients, as `/r` does, and `chat.post` posts to them. Whispered and GM-only results reach only their audience.
6. **Not on the socket.** Commands go over HTTP only, as typed rolls do from the composer. `roll.request` on the events socket is unchanged.

## Consequences

- Plugins add commands without the web app knowing them; the browser learns of a missing command from the server, at the cost of one request for a typo.
- A command cannot shadow `/r` or `/gmr`.
- `ctx.fail` is the one way plugin text reaches a caller as an error, so plugins choose what players see.
- Hooks (`defineServer({ hooks })`) are still not called: combat calls them (M9).
