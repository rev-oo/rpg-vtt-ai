# ADR-037: Rich text with TipTap over a Y.XmlFragment

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tasks:** T-0510 (journal bodies follow with T-0601)
- **Resolves:** open question Q3 (specs §14)
- **Refines:** ADR-035, specs §8.4, §8.5, §9.2, FR-SHEET-07, FR-JOURNAL-04

## Context

ADR-035 gave long text a minimal shared textarea and left the rich editor to Q3. Q3 is now decided: use TipTap with its Collaboration extension. That extension binds the editor to a `Y.XmlFragment`, a tree of blocks with formatted text. It cannot use the `Y.Text` that long text fields used until now.

## Decision

1. **TipTap edits `richText` fields only.**
   - `longText` stays a plain `Y.Text` with the shared textarea (ADR-035). Notes need no formatting, and formulas, validation and REST keep reading them as they are.
   - `richText` fields get the editor on sheets now, and journal bodies get it with T-0601.
2. **A `richText` field lives in a `Y.XmlFragment`** of TipTap's blocks (paragraphs, headings, lists, quotes, code) with marks on their text (bold, italic, links and the rest of StarterKit).
3. **Its JSON value is its plain text.** `plainText()` in `@vtt/plugin-engine` returns each block on its own line and hard breaks as line breaks. The projection, `maxLength`, repair, formulas and rolls all read this value. The formatting lives only in the document, which is what is stored once a sheet has been opened (ADR-029).
   - Writing a string, such as a projection built before the document existed, a repair, or a whole-value `set`, makes one paragraph per line and drops the formatting (`richTextOf`, `replaceRichText`).
   - A field stored as the other kind of text, because the plugin moved it between `longText` and `richText`, is converted with its plain text when the server loads the document (`ensureContainers`), so nothing is reset.
4. **The renderer stays free of Yjs and the editor.**
   - `<Sheet renderRichText>` lets the host render the editor of a `richText` field. It receives the path, the label's id, `readOnly` and the control's class.
   - When the host renders nothing, for example because there is no fragment, and in memory stores, the field is a text area as before.
   - In the web app, `YjsStore.richText(path)` returns the fragment and `RichTextEditor` binds TipTap to it. The editor is loaded lazily, so ProseMirror is only fetched for sheets with rich text.
5. **Editing:**
   - TipTap's own undo is off. The Collaboration extension's undo replaces it, and only undoes the viewer's own changes.
   - A toolbar offers bold, italic, heading and both kinds of list. Shortcuts and Markdown-like input rules cover the rest.
   - Typed and pasted URLs become links, which do not open on click while editing. TipTap's link extension refuses `javascript:` and other unsafe protocols.
   - Observers get a read-only editor without the toolbar.

## Consequences

- Concurrent typing and formatting merge, as tested in two browsers in `e2e/tests/live-sheets.spec.ts` and against two `Y.Doc`s in `apps/web/test/rich-text.test.tsx`.
- Reading a `richText` field over REST or in a formula gives plain text. Writing one there replaces its formatting.
- The editor chunk is about 140 kB gzipped and is loaded on demand.
- Inline images (FR-JOURNAL-04) and a link button are not in the toolbar yet; they come with the journal (T-0601).
- `tiny-d20` characters gain a `biography` rich text field, which exercises the editor end to end.
