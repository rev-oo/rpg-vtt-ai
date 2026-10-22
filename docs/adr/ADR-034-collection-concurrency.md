# ADR-034: Collections under concurrent edits

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0508
- **Refines:** specs §9.4, FR-SHEET-06

## Context

Collections are id-keyed `Y.Map`s of rows with fractional `sort` keys (§9.4, ADR-029, ADR-032).

- Adding a row writes one key.
- Removing a row deletes one key.
- Moving a row changes only that row's `sort`.

Under concurrency this can't duplicate a row, because a row is one key whatever its order. It can't lose a row either, as long as the collection's map already exists.

The property test for T-0508 found the exception. When the map is missing, two clients that add a row at the same time each create the map. Yjs keeps one of the two maps, and the rows written into the other are lost. This happens whenever a stored document predates a schema's object or collection field.

## Decision

1. **The server creates the containers.** `ensureMaps` (`@vtt/plugin-engine`) adds the `Y.Map` of every object and collection field a document lacks, at every depth outside collection rows. `loadDocument` runs it on every load, both for documents built from the projection and for stored states, before any client syncs. Clients still create maps when one is missing, as a fallback, but with the server's load that no longer happens in practice.
2. **Ties in order are broken by id.** Two clients can move rows to the same gap at once and get the same `sort` key. `collectionRows` sorts by key and then by id, so every client shows the same order. The next move gives that row a fresh key.
3. **Property test.** In `apps/web/test/collab-concurrency.test.ts`:
   - two stores over two `Y.Doc`s, started from a server-loaded state, run random adds, removes and moves, and sync at random points;
   - after a final sync, both show the same rows in the same order;
   - no id appears twice, and the rows are exactly those added and not removed.

## Consequences

- Maps inside a new collection row are created by the client that adds the row, together with the row. Nobody else can write into a row before it exists, so this has no race.
