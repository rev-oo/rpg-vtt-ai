# ADR-065: The Images panel picks and deletes table assets, and journal text holds images

- **Status:** Accepted
- **Date:** 2026-10-29
- **Tasks:** T-1302
- **Covers:** FR-ASSET-02
- **Amends:** ADR-037 (journal text may hold images), ADR-064 (assets can be deleted)

## Context

T-1301 (ADR-064) stores and serves a table's images, but nothing in the app could upload them or put them anywhere. Actor and item images were plain `http(s)` URLs, set only when an actor or item was created. Journal entries had no images at all, and their rich text had no image node. T-1302 adds the asset manager.

Two choices were made with the user:

- Journal images go inside the entry's text, not as a cover image.
- An image still in use cannot be deleted, rather than leaving a broken image behind.

## Decision

1. **Image fields take asset paths.** An actor's or item's `imageUrl` is an `http(s)` URL or an asset's path, `/api/v1/assets/<id>`.
   - The path must name an asset of the same table; anything else gets `422 unknown_asset`.
   - The path is relative, so a changed `PUBLIC_URL` keeps working.
   - Validation describes a value that fits neither form by the URL rule (`describeIssue` describes a union by its first branch).
2. **The Images panel.** A list panel of the workspace (ADR-059), beside the compendium. It shows the table's images as thumbnails, newest first, to every member.
   - GMs and assistants of a table that is not archived upload by picking files or dropping them on the panel, and delete images.
   - Deleting asks first and is permanent.
3. **The image picker.** A dialog with the Images gallery (uploads included) and a URL field. It is used by:
   - the new-actor and new-item dialog;
   - a **Choose image** or **Change image** button by an actor's or item's sheet title, for whoever may edit it, which also removes the image;
   - the journal editor's **Image** button.
4. **Images in journal text.** Journal entries' editor adds TipTap's image node: `src`, `alt` (the asset's file name) and `title`, with `data:` URLs refused.
   - Sheet `richText` fields keep no images: their schema stays as ADR-037 left it.
   - Images are stored in the entry's Yjs body like any other node.
5. **Deleting.** `DELETE /api/v1/assets/:id`, for GMs and assistants of the asset's table, refuses an image in use with `409 asset_in_use` and lists the uses (`details.uses`: `kind`, `id`, `name`).
   - **Uses:** actor and item images, and images in journal text.
   - **Trash:** entities in the trash count, so restoring one never shows a missing image.
   - **Unsaved edits:** journal bodies are read from their live documents while open, so an image inserted moments ago counts.
   - **Unused images:** the row and the file are removed.
6. **Image fields of plugin data.** A sheet's `image` node shows a field marked `x-kind: "image"`. For whoever may edit the sheet it is a button that opens the image picker; the renderer asks the host through `pickImage`, as it does for rich text, and the chosen URL, or `""` to remove it, goes into the field. Such fields count as uses too: the stored data of the table's actors and items is searched for the asset's path, and so are their live documents while open.
7. **Not live.** Uploads and deletions do not send events. The panel loads again whenever the table's data does, and a page reload shows the rest.

## Consequences

- Groups can upload images and use them for portraits, item images and in journal text without outside hosting.
- Chat messages keep the speaker's image URL from when they were sent. If that image is later deleted, the message shows a missing image; messages do not count as uses.
- Images in sheet rich text are left for later. Scene backgrounds count as uses since T-1401 (`kind: "scene"`, ADR-066).
