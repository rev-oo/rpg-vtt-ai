import { useEffect, useState } from 'react';

import type { ItemView } from '@vtt/shared/api';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { useTableEvents } from '../../realtime/use-table-events.js';

export type ActorItems =
  | { status: 'loading' }
  | { status: 'failed'; error: string }
  | { status: 'ready'; items: readonly ItemView[] };

/**
 * An actor's items (at most 500, ADR-063), kept current: changes to them, by anyone, reload
 * the list (FR-ENT-07). Nothing loads while `enabled` is false.
 */
export function useActorItems(
  tableId: string,
  actorId: string,
  enabled: boolean,
): { items: ActorItems; reload: () => void } {
  const [items, setItems] = useState<ActorItems>({ status: 'loading' });
  const [generation, setGeneration] = useState(0);
  const reload = () => {
    setGeneration((value) => value + 1);
  };

  useTableEvents(tableId, {
    onEvent: (event) => {
      if (
        enabled &&
        event.type === 'entity.changed' &&
        event.payload.kind === 'item' &&
        event.payload.actorId === actorId
      ) {
        reload();
      }
    },
    onResync: () => {
      if (enabled) reload();
    },
  });

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    api.listActorItems(actorId).then(
      (loaded) => {
        if (current) setItems({ status: 'ready', items: loaded });
      },
      (error: unknown) => {
        if (current) setItems({ status: 'failed', error: errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [actorId, enabled, generation]);

  return { items, reload };
}
