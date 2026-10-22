# ADR-029: Document persistence and the Yjs mapping

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0502, T-0504
- **Refines:** specs §9.2, §9.6

## Context

T-0502 stores collaborative documents in `ydocs` and keeps the `system` JSON projection in step with them. A document that was never stored has to start from the entity's projection, and a store has to turn the document back into JSON. Both need the JSON ↔ Yjs mapping of T-0504, so T-0504's mapping was built first.

## Decision

1. **The mapping lives in `@vtt/plugin-engine`, which now depends on `yjs`.**
   - `writeLayer` and `readLayer` follow `documentLayout`:
     - `longText` and `richText` are `Y.Text`;
     - objects are nested `Y.Map`s;
     - collections are `Y.Map`s of rows keyed by id, each row with its `sort` key;
     - everything else is a plain value.
   - `splitLayers` and `mergeLayers` divide an entity's JSON between `main` and `secret` and join it back.
   - Yjs is plain JavaScript with no I/O, so the package stays pure under §4.4. The server and the web app (T-0506) share one mapping.
   - Data the layout doesn't know, such as fields of an older plugin version, stays in `main`. Values of the wrong type stay plain values. Nothing is dropped; repairing values is T-0505.
2. **The `ydocs` table** holds `name`, `state` and `updated_at`, plus nullable `actor_id` and `journal_entry_id` foreign keys with `ON DELETE CASCADE`. A purged entity takes its documents with it.
3. **Loading.**
   - A stored document loads from its state.
   - Otherwise an actor document starts from the projection, with the type's defaults filled in (`withDefaults`) and split by layer.
   - When the system no longer declares the type, every value is plain. Such tables are read-only anyway.
   - A journal body starts empty.
   - Starting a document doesn't store it. The projection stays the source of truth until the first change.
4. **Storing.**
   - `onStoreDocument` writes the state and refreshes `actors.system` in one transaction.
   - The projection joins both layers. The other layer comes from its live document when that is loaded, else from its stored state, else from the current projection.
5. **Timing (§9.6).**
   - Stores are debounced by 2 s, with at most 10 s between them.
   - When the last client leaves, Hocuspocus stores at once and then asks before it unloads. The first ask is refused and retried after 60 s. A client reopening the document cancels the retry.
   - Tests shorten these delays through `buildApp({ collabTiming })`.
6. **Shutdown.** `preClose` closes the collab sockets, flushes pending stores and waits for every document's save lock, before the database closes.

## Consequences

- Rolls and listings read the projection, which can lag the live document by up to the debounce. §9.6 says rolls should read the live document; that is T-0509.
- A store doesn't publish `entity.changed`, so actor lists don't refresh on sheet edits yet.
- `app.injectWS` sockets never end their stream after a clean close, so the server never sees them leave. Tests that need a disconnect use `drop()`, which terminates the socket, in `test/support/collab.ts`.
