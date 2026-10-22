# ADR-031: Counter adjustments and data repair on the collab socket

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0505
- **Refines:** specs §9.5, §9.7, §10.3, FR-SHEET-08, FR-SHEET-09

## Context

Two things need a server-side path next to Yjs sync:

- `adjust(path, delta)` must add up when two clients change the same counter at once. Two Yjs `set`s of "value − 3" would overwrite each other.
- Values that don't fit the schema must be repaired on persist, and the editor must be told.

## Decision

1. **Hocuspocus stateless messages carry the protocol.** These are JSON strings on the document they concern, defined once in `@vtt/shared/api` (`collabClientMessage`, `collabServerMessage`) and holding codes only, no wording:
   - the client sends `adjust {id, path, delta}`;
   - the server answers `adjusted {id, value, clamped}` or `error {id, code}`, where `code` is `invalid_message`, `read_only` or `not_a_counter`;
   - after a repair, the server sends `validation {issues: [{path, reason}]}`.

   Paths are map keys, with row ids inside collections.

2. **Adjustments run on the server's copy.**
   - `adjustCounter` (`@vtt/plugin-engine`) reads the current value inside a transaction on the server's document, adds the delta and sets the result.
   - Hocuspocus handles one message at a time, so concurrent deltas add up. The change is then broadcast like any update.
   - Only `x-counter` fields of type `integer` or `number` in the document's own layer can be adjusted.
   - The result is clamped to `minimum`/`maximum` ("clamped per the field's rule", FR-SHEET-09), and `clamped` says so.
   - Stateless messages pass the same per-message access check as updates, so a read-only connection gets `read_only`.
3. **Repair on persist sets the default (§9.7).**
   - Before each store, `repairLayer` walks the document against its layer's schema (`layerSchemas`). Every value with the wrong shape or type, or that breaks `enum`, a bound or a length, is replaced with the field's default. Collection rows that aren't maps are removed.
   - Missing fields and keys the schema doesn't know are left alone (ADR-029).
   - The repair transaction skips the store hooks, because the store that made it saves it.
   - The repair is logged as `collab data repaired`.
   - `validation` goes to the connections that changed the document since its last store, which Hocuspocus's `onChange` reports. Others see only the corrected values.
4. **Journals aren't repaired.** Their bodies have no schema. Actors of types the system no longer declares aren't repaired either.

## Consequences

- An invalid value can be live for up to the store debounce (2 s, at most 10 s) before it is repaired. The client checks values on input (T-0506), so this only catches clients that skip that check.
- `adjust` from plugin server code (`ctx.actors.adjust`, §8.8) can reuse `adjustDocument` once server hooks exist.
