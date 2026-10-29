import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

import type { DocumentLayout } from '@vtt/plugin-engine';
import { documentName } from '@vtt/shared';

import { collabUrl, parseMessage, REVOKED } from './connection.js';
import { createYjsStore, type YjsStore } from './yjs-store.js';

/** One item's live main document, for an actor sheet's `items` node and totals (ADR-063). */
export interface LiveItem {
  store: YjsStore;
  /** Synced with the server; before that the item's projection stands in. */
  ready: boolean;
  readOnly: boolean;
  denied: boolean;
}

interface Entry {
  type: string;
  view: () => LiveItem;
  close: () => void;
}

interface Pool {
  /** Opened with the first item, so sheets without items never connect. */
  socket: () => HocuspocusProviderWebsocket;
  entries: Map<string, Entry>;
  publish: () => void;
}

function openItem(
  socket: HocuspocusProviderWebsocket,
  id: string,
  layout: DocumentLayout,
  changed: () => void,
): Omit<Entry, 'type'> {
  const doc = new Y.Doc();
  const state = { ready: false, readOnly: true, denied: false };
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: documentName({ kind: 'item', id, layer: 'main' }),
    document: doc,
    token: '',
    // Presence belongs to the item's own sheet.
    awareness: null,
    onAuthenticated: ({ scope }) => {
      state.readOnly = scope === 'readonly';
      changed();
    },
    onAuthenticationFailed: () => {
      state.denied = true;
      changed();
    },
    onSynced: ({ state: synced }) => {
      state.ready = synced;
      changed();
    },
    onStateless: ({ payload }) => {
      const message = parseMessage(payload);
      if (message?.type !== 'access') return;
      state.readOnly = message.readOnly;
      changed();
    },
    onClose: ({ event }) => {
      if (!REVOKED.has(event.reason)) return;
      state.denied = true;
      changed();
    },
  });
  provider.attach();
  let counter = 0;
  const store = createYjsStore({
    docs: { main: doc },
    layout,
    adjust: (_layer, path, delta) => {
      counter += 1;
      const ref = `a${String(counter)}`;
      provider.sendStateless(JSON.stringify({ type: 'adjust', id: ref, path, delta }));
    },
  });
  // Edits change the holder's totals, so every one publishes.
  const unsubscribe = store.subscribe(changed);
  return {
    view: () => ({ store, ...state }),
    close: () => {
      unsubscribe();
      provider.destroy();
      doc.destroy();
      store.destroy();
    },
  };
}

/**
 * Opens the main documents of an actor's items on one socket while the sheet is shown
 * (FR-SHEET-12, ADR-063), opening and closing them as `items` changes. Each item's access is
 * its own (§9.3); secret fields stay on the item's sheet. Items whose type has no layout are
 * skipped.
 */
export function useLiveItems(
  items: readonly { id: string; type: string }[],
  layoutOf: (type: string) => DocumentLayout | undefined,
): ReadonlyMap<string, LiveItem> {
  const pool = useRef<Pool | null>(null);
  const [live, setLive] = useState<ReadonlyMap<string, LiveItem>>(() => new Map());

  useEffect(() => {
    let socket: HocuspocusProviderWebsocket | undefined;
    const entries = new Map<string, Entry>();
    pool.current = {
      socket: () => {
        socket ??= new HocuspocusProviderWebsocket({ url: collabUrl() });
        return socket;
      },
      entries,
      publish: () => {
        setLive(new Map([...entries].map(([id, entry]) => [id, entry.view()])));
      },
    };
    return () => {
      for (const entry of entries.values()) entry.close();
      socket?.destroy();
      pool.current = null;
      setLive(new Map());
    };
  }, []);

  useEffect(() => {
    const current = pool.current;
    if (!current) return;
    const wanted = new Map(items.map((item) => [item.id, item.type]));
    for (const [id, entry] of current.entries) {
      if (wanted.get(id) === entry.type) continue;
      entry.close();
      current.entries.delete(id);
    }
    for (const [id, type] of wanted) {
      const layout = layoutOf(type);
      if (current.entries.has(id) || !layout) continue;
      current.entries.set(id, { type, ...openItem(current.socket(), id, layout, current.publish) });
    }
    current.publish();
  }, [items, layoutOf]);

  return live;
}
