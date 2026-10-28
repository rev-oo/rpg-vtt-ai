import { useEffect, useEffectEvent, useState } from 'react';

import type { ListPage } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';

export interface PanelList<T> {
  /** False until the first page arrives; later reloads keep the rows shown meanwhile. */
  loaded: boolean;
  rows: T[];
  nextCursor: string | null;
  error: string | null;
}

/**
 * The first page of a browse-panel list (ADR-059). It loads again when `query` changes, and
 * whenever `reload` does: the table's loaded data, which every revalidation replaces.
 */
export function usePanelList<T>(
  load: () => Promise<ListPage<T>>,
  query: string,
  reload: unknown,
): PanelList<T> {
  const [state, setState] = useState<PanelList<T>>({
    loaded: false,
    rows: [],
    nextCursor: null,
    error: null,
  });
  const fetchFirst = useEffectEvent(load);

  useEffect(() => {
    let current = true;
    fetchFirst().then(
      (page) => {
        if (current) setState({ loaded: true, ...page, error: null });
      },
      (error: unknown) => {
        if (current)
          setState({ loaded: true, rows: [], nextCursor: null, error: errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [query, reload]);

  return state;
}
