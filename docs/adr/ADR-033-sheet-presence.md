# ADR-033: Sheet presence over Yjs awareness

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0507
- **Refines:** FR-SHEET-02, specs §9

## Context

FR-SHEET-02 asks each field to show who else is editing it, with a coloured outline and a name badge. Yjs awareness, which Hocuspocus relays to every connection of a document, is the natural channel. However, awareness states come from clients and the server doesn't check them.

## Decision

1. **Awareness carries ids only.** Each client shares `{ user: { id }, focus: FieldPath | null }` on the actor's main document, and only there. Secret documents have no awareness, so a focus on a secret field is still a path in the main document's awareness. Observers therefore learn that someone is in a field they can't see. They learn only that, never its contents.
2. **Names and colours come from the table, not from the client.**
   - `useSheetPresence` validates each state with Zod and looks the user id up in the table's members.
   - Unknown ids, malformed states and the viewer's own other tabs are ignored.
   - The colour is derived from the user id, using a fixed palette that takes white badge text.

   A client can't appear under someone else's name or inject styles. A client can still claim another member's id, because awareness isn't authenticated. That would only fake a badge, never data access, and it's accepted for MVP.

3. **The renderer takes `presence` as an optional prop.** `presence` has two parts:
   - `at(path)` lists the other viewers in a field;
   - `focus(path | null)` reports where the viewer is.
   - Field wrappers report focus, treating moves between one field's controls as staying in it. They also draw the first viewer's outline and every viewer's badge (`[data-presence]`).
   - Without the prop the markup is unchanged.
   - Checkboxes, images and lists themselves show no presence. A list's row fields do.

## Consequences

- Focus is shared as soon as a field is focused, including by keyboard navigation through read-only sheets.
- Presence is per actor sheet. Item sheets and journals get it when they become live (M6).
