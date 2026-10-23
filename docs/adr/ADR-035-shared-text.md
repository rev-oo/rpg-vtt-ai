# ADR-035: Collaborative long text with a minimal editor

- **Status:** Accepted. Q3 is decided: `richText` fields use TipTap (ADR-037), and `longText` keeps this editor.
- **Date:** 2026-10-22
- **Tasks:** T-0510
- **Refines:** specs §9.2, FR-SHEET-07, FR-JOURNAL-01, FR-JOURNAL-04

## Context

T-0510 binds `longText` fields, and later journal bodies, to their `Y.Text`. The task allows TipTap with its Collaboration extension, or a minimal editor if TipTap is deferred. Before this, sheets wrote the whole string on every keystroke, so two people typing at once overwrote each other (ADR-032).

## Decision

1. **A minimal plain-text editor for now; TipTap is deferred.**
   - `SharedTextarea` in `@vtt/sheet-renderer` is a `<textarea>` bound to a `SharedText`.
   - Each input event becomes one splice: the part between the common prefix and suffix of the old and new text.
   - Other people's changes replace the area's value, and the caret and selection are moved through each change.
   - Only plain text is involved, which needs no new dependency, fits phones, and is all MVP sheets require.
   - `richText` fields were edited as plain text in the same `Y.Text` until a rich editor arrived. ADR-037 now gives them TipTap over a `Y.XmlFragment` instead.
2. **The renderer stays free of Yjs.**
   - `SheetStore.text(path)` returns a `SharedText` (`read`, `splice`, `observe`) for live stores, and the same object for the same text.
   - The Yjs store wraps the field's `Y.Text` and turns `YTextEvent` deltas into splices.
   - Without `text`, as in memory stores, text areas write the whole value as before.
3. **The server creates texts too.** `ensureMaps` becomes `ensureContainers` and also adds a missing `Y.Text` on load (ADR-034). Without this, two clients could each create the text and one of them would be lost.
4. **Journal bodies** reuse `SharedTextarea` with the journal document's text when the journal UI arrives (T-0601).

## Consequences

- Concurrent typing merges character by character. Tested with two `Y.Doc`s and in two browsers (`e2e/tests/live-sheets.spec.ts`).
- There is no formatting, and no undo beyond the browser's own. TipTap (or another rich editor) can replace `SharedTextarea` behind the same `SharedText` interface later.
- A `longText` inside a collection row has its text created with the row. If the row came from older data without one, the field falls back to whole-value writes.
