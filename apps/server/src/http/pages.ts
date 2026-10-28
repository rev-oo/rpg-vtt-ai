import { z } from 'zod';

import type { ListWindow, NameKey } from '../db/repositories/index.js';
import { badRequest } from '../errors.js';

// Cursor pages for actor, item and journal lists (§10.1, ADR-057).

const keySchema = z.tuple([z.string(), z.string()]);

/**
 * The key a row sorts by. SQLite's `lower()` folds ASCII letters only, so the key does too:
 * `toLowerCase()` would fold `É` and miss the row's place.
 */
export const nameKey = (name: string, id: string): NameKey => ({
  name: name.replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
  id,
});

/** The opaque cursor of a name-ordered list: the last entry's lowercased name and id. */
export function encodeListCursor(key: NameKey): string {
  return Buffer.from(JSON.stringify([key.name, key.id])).toString('base64url');
}

export function decodeListCursor(cursor: string): NameKey {
  try {
    const parsed = keySchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    if (parsed.success) return { name: parsed.data[0], id: parsed.data[1] };
  } catch {
    // Falls through to the error below.
  }
  throw badRequest('invalid_cursor', 'Invalid list cursor.');
}

/**
 * One page of a list whose rows the caller may not all see (ADR-057). Rows are read in
 * batches after the cursor until the page is full, so a page is short only at the end.
 * Without a limit, the whole list.
 */
export function listPage<Row, View>(
  {
    fetch,
    keyOf,
    view,
  }: {
    fetch: (window: ListWindow) => Row[];
    keyOf: (row: Row) => NameKey;
    /** `undefined` leaves the row out. */
    view: (row: Row) => View | undefined;
  },
  { limit, cursor }: { limit?: number | undefined; cursor?: string | undefined },
): { views: View[]; nextCursor: string | null } {
  let after = cursor === undefined ? undefined : decodeListCursor(cursor);
  if (limit === undefined) {
    return { views: fetch({ after }).flatMap((row) => view(row) ?? []), nextCursor: null };
  }
  const views: View[] = [];
  let last: NameKey | undefined;
  for (;;) {
    const rows = fetch({ after, limit: limit + 1 });
    for (const row of rows) {
      const seen = view(row);
      if (seen === undefined) continue;
      // One more visible row than the page holds: there is a next page.
      if (views.length === limit)
        return { views, nextCursor: last ? encodeListCursor(last) : null };
      views.push(seen);
      last = keyOf(row);
    }
    if (rows.length <= limit) return { views, nextCursor: null };
    const tail = rows.at(-1);
    if (!tail) return { views, nextCursor: null };
    after = keyOf(tail);
  }
}
