import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import type { DocumentLayout } from '@vtt/plugin-engine';
import { documentName } from '@vtt/shared';
import type { DataIssue } from '@vtt/shared/api';

import { collabUrl, parseMessage, REVOKED } from './connection.js';
import type { Awareness } from './presence.js';
import { createYjsStore, type Layer, type YjsStore } from './yjs-store.js';

/** An actor's live sheet data (specs §9): connecting, refused, or synced and editable. */
export type LiveSheet =
  | { status: 'connecting' }
  | { status: 'denied' }
  | {
      status: 'ready';
      store: YjsStore;
      /** The server opened the sheet read-only: observers, or an unavailable system. */
      readOnly: boolean;
      /** Values the server last reset to their default (FR-SHEET-09). */
      issues: readonly DataIssue[];
      /** The main document's awareness, for presence (T-0507). */
      awareness: Awareness | undefined;
    };

interface LayerState {
  synced: boolean;
  denied: boolean;
  readOnly: boolean;
}

/** The actor or item whose sheet is live (ADR-062). */
export interface LiveEntity {
  kind: 'actor' | 'item';
  id: string;
}

/**
 * Opens an actor's or item's documents on `/ws/collab` while the sheet is shown: `main`, and
 * `secret` when the viewer may see secret fields and the type has some (specs §9.1, §9.3). The
 * session cookie authenticates the socket, so the token is empty.
 */
export function useLiveSheet(
  { kind, id }: LiveEntity,
  layout: DocumentLayout,
  { secret }: { secret: boolean },
): LiveSheet {
  const [sheet, setSheet] = useState<LiveSheet>({ status: 'connecting' });

  useEffect(() => {
    const layers: Layer[] = secret && layout.secret ? ['main', 'secret'] : ['main'];
    const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    const states = new Map<Layer, LayerState>();
    let issues: readonly DataIssue[] = [];

    const opened = layers.map((layer) => {
      const doc = new Y.Doc();
      const state: LayerState = { synced: false, denied: false, readOnly: false };
      states.set(layer, state);
      const provider = new HocuspocusProvider({
        websocketProvider: socket,
        name: documentName({ kind, id, layer }),
        document: doc,
        token: '',
        // Presence (T-0507) lives on the main document only.
        ...(layer === 'secret' && { awareness: null }),
        onAuthenticated: ({ scope }) => {
          state.readOnly = scope === 'readonly';
          update();
        },
        onAuthenticationFailed: () => {
          state.denied = true;
          update();
        },
        onSynced: ({ state: synced }) => {
          state.synced = synced;
          update();
        },
        onStateless: ({ payload }) => {
          const message = parseMessage(payload);
          if (message?.type === 'validation') issues = message.issues;
          // Ownership or the table changed while the sheet was open (§9.3).
          else if (message?.type === 'access') state.readOnly = message.readOnly;
          else return;
          update();
        },
        // The server closes a document whose access is gone; a dropped socket has no reason.
        onClose: ({ event }) => {
          if (!REVOKED.has(event.reason)) return;
          state.denied = true;
          update();
        },
      });
      provider.attach();
      return { layer, doc, provider };
    });

    const providerOf = (layer: Layer) => opened.find((entry) => entry.layer === layer)?.provider;
    let counter = 0;
    const store = createYjsStore({
      docs: {
        main: opened[0]?.doc ?? new Y.Doc(),
        secret: opened.find((entry) => entry.layer === 'secret')?.doc,
      },
      layout,
      adjust: (layer, path, delta) => {
        counter += 1;
        const id = `a${String(counter)}`;
        providerOf(layer)?.sendStateless(JSON.stringify({ type: 'adjust', id, path, delta }));
      },
    });

    function update() {
      const main = states.get('main');
      if (main?.denied) {
        setSheet({ status: 'denied' });
        return;
      }
      const synced = [...states.values()].every((state) => state.synced || state.denied);
      setSheet(
        synced
          ? {
              status: 'ready',
              store,
              readOnly: main?.readOnly ?? true,
              issues,
              awareness: providerOf('main')?.awareness ?? undefined,
            }
          : { status: 'connecting' },
      );
    }

    return () => {
      for (const { provider, doc } of opened) {
        provider.destroy();
        doc.destroy();
      }
      socket.destroy();
      store.destroy();
      setSheet({ status: 'connecting' });
    };
  }, [kind, id, layout, secret]);

  return sheet;
}
