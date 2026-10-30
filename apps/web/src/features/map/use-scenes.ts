import { useCallback, useEffect, useState } from 'react';

import type { SceneView } from '@vtt/shared/api';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { useTableEvents } from '../../realtime/use-table-events.js';

export interface Scenes {
  /** `undefined` until the first answer. */
  scenes: SceneView[] | undefined;
  error: string | null;
  /**
   * Waits for a change: an answer with the list replaces it, `null` refetches it, and a
   * failure is reported. The returned promise tells the caller whether it succeeded.
   */
  settle: (change: Promise<SceneView[] | null>) => Promise<boolean>;
}

/**
 * The table's scenes as the member may see them (FR-MAP-01, ADR-066): every scene for GMs
 * and assistants, else only the active one. They refetch on `scene.updated`.
 */
export function useScenes(tableId: string): Scenes {
  const [scenes, setScenes] = useState<SceneView[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.listScenes(tableId).then(
      (next) => {
        setScenes(next);
      },
      (e: unknown) => {
        setError(errorMessage(e));
      },
    );
  }, [tableId]);
  useEffect(refresh, [refresh]);
  useTableEvents(tableId, {
    onEvent: (event) => {
      if (event.type === 'scene.updated') refresh();
    },
    onResync: refresh,
  });

  const settle = (change: Promise<SceneView[] | null>) => {
    setError(null);
    return change.then(
      (next) => {
        if (next) setScenes(next);
        else refresh();
        return true;
      },
      (e: unknown) => {
        setError(errorMessage(e));
        return false;
      },
    );
  };
  return { scenes, error, settle };
}
