import { useCallback, useEffect, useEffectEvent, useSyncExternalStore } from 'react';

import type { ServerEvent } from '@vtt/shared/api';

import { eventsClient, type ConnectionStatus } from './events-client.js';

export interface TableEventHandlers {
  onEvent: (event: ServerEvent) => void;
  /**
   * Called when the connection opens after having been down since the component mounted:
   * events sent meanwhile were missed and must be fetched over REST (specs §10.2).
   */
  onResync?: () => void;
}

/** Subscribes to a table's events while mounted, and reports the connection status. */
export function useTableEvents(
  tableId: string,
  { onEvent, onResync }: TableEventHandlers,
): ConnectionStatus {
  const status = useSyncExternalStore(
    useCallback((notify: () => void) => eventsClient().onStatus(notify), []),
    () => eventsClient().status,
  );
  const handleEvent = useEffectEvent(onEvent);
  const handleResync = useEffectEvent(() => onResync?.());

  useEffect(() => {
    const client = eventsClient();
    let missed = client.status !== 'open';
    const unsubscribe = client.subscribe(tableId);
    const offEvent = client.onEvent((event) => {
      if ('tableId' in event && event.tableId === tableId) handleEvent(event);
    });
    const offStatus = client.onStatus((next) => {
      if (next !== 'open') {
        missed = true;
      } else if (missed) {
        missed = false;
        handleResync();
      }
    });
    return () => {
      offStatus();
      offEvent();
      unsubscribe();
    };
  }, [tableId]);

  return status;
}
