import { useState } from 'react';

import type { ListPage } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';

/** Entries per page of the actor, item and journal tabs (§10.1, ADR-057). */
export const LIST_PAGE = 50;

interface Pages<T> {
  /** The loader's first page these pages follow; a new one starts over. */
  first: readonly T[];
  rows: T[];
  cursor: string | null;
}

/**
 * A list's first page, from the route loader, and the pages loaded after it (ADR-057). A
 * revalidation brings a new first page, and the list starts over from it.
 */
export function usePagedList<T>(
  first: readonly T[],
  firstCursor: string | null,
  fetchPage: (cursor: string) => Promise<ListPage<T>>,
): {
  rows: readonly T[];
  more: boolean;
  loading: boolean;
  error: string | null;
  loadMore: () => void;
} {
  const [pages, setPages] = useState<Pages<T>>({ first, rows: [], cursor: firstCursor });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  let current = pages;
  if (pages.first !== first) {
    current = { first, rows: [], cursor: firstCursor };
    setPages(current);
  }

  const loadMore = () => {
    const { cursor } = current;
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    fetchPage(cursor).then(
      (page) => {
        setPages((now) =>
          now.first === first && now.cursor === cursor
            ? { first, rows: [...now.rows, ...page.rows], cursor: page.nextCursor }
            : now,
        );
        setLoading(false);
      },
      (e: unknown) => {
        setError(errorMessage(e));
        setLoading(false);
      },
    );
  };

  return {
    rows: current.rows.length === 0 ? first : [...first, ...current.rows],
    more: current.cursor !== null,
    loading,
    error,
    loadMore,
  };
}
