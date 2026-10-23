# ADR-032: The web app's live sheet store

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0506
- **Refines:** specs §9.1, §9.2, §9.4, §9.5, FR-SHEET-01, FR-SHEET-03

## Context

Up to M4, the sheet renderer ran on a memory store filled from the REST projection, and actor sheets were read-only. T-0506 binds it to the actor's Yjs documents. It does this through the same `SheetStore` interface, so the renderer and plugin nodes don't change.

## Decision

1. **`createYjsStore` (`apps/web/src/collab/yjs-store.ts`)** implements `SheetStore` over an actor's `main` document and, for GMs and assistants, its `secret` document.
   - **Reads** join both layers with `mergeLayers`. A new snapshot is built after every update, as `useSyncExternalStore` requires.
   - **Writes** go to the document whose layout holds the field (`documentLayout`), and the mapping follows ADR-029:
     - writing a string to a text field replaces the contents of the existing `Y.Text` (collaborative typing is T-0510);
     - new rows are keyed maps with their `sort` key in the main document;
     - a row's secret fields go to the secret document under the same row id;
     - removing a row deletes it from both documents.
   - **`adjust`** sends the stateless `adjust` message (ADR-031) to the document's provider and waits for the server's broadcast. There is no optimistic change, so concurrent steps add up exactly.
   - Players have no secret document, so writes to secret fields go nowhere.
2. **`useLiveSheet`** opens the documents while the sheet is shown:
   - one `HocuspocusProviderWebsocket` per sheet, with a provider per document;
   - the empty token, since the session cookie authenticates the socket;
   - awareness only on the main document.
   - It reports one of three states:
     - `connecting`, until every opened document is synced;
     - `denied`, when the main document is refused;
     - `ready`, with the server's read-only scope and the last `validation` issues.
   - The sheet is read-only when the server opened the document read-only (an observer, or an unavailable system) or the viewer isn't an owner.
3. **The actor route** renders the sheet over the live store and shows a notice when the server reset values (FR-SHEET-09). Item sheets keep the memory store, because items have no collaborative documents (§9.1).
4. **Tests.**
   - The store is unit-tested on plain `Y.Doc`s.
   - The route's jsdom tests mock `useLiveSheet`.
   - The socket path is covered end to end in `e2e/tests/live-sheets.spec.ts`: two browsers within 500 ms, concurrent counter steps, observers read-only, and data kept after a reload.

## Consequences

- Number and text fields write on every valid keystroke, which other viewers see as they type.
- `longText` fields are still plain text areas that replace the whole text. Concurrent typing in one note can lose characters until T-0510 binds an editor to `Y.Text`.
- The REST actor list still shows the projection, which lags the live document by up to the store debounce (ADR-029).
