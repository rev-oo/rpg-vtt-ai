import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import type { DocumentLayout } from '@vtt/plugin-engine';
import { documentName } from '@vtt/shared';
import { collabServerMessage, type DataIssue } from '@vtt/shared/api';
import type { SheetStore } from '@vtt/sheet-renderer';

import type { Awareness } from './presence.js';
import { createYjsStore, type Layer } from './yjs-store.js';

/** An actor's live sheet data (specs §9): connecting, refused, or synced and editable. */
export type LiveSheet =
  | { status: 'connecting' }
  | { status: 'denied' }
  | {
      status: 'ready';
      store: SheetStore;
      /** The server opened the sheet read-only: observers, or an unavailable system. */
      readOnly: boolean;
      /** Values the server last reset to their default (FR-SHEET-09). */
      issues: readonly DataIssue[];
      /** The main document's awareness, for presence (T-0507). */
      awareness: Awareness | undefined;
    };

function collabUrl(): string {
  const url = new URL('/ws/collab', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function parseMessage(payload: string) {
  try {
    const parsed = collabServerMessage.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

interface LayerState {
  synced: boolean;
  denied: boolean;
  readOnly: boolean;
}

/**
 * Opens an actor's documents on `/ws/collab` while the sheet is shown: `main`, and `secret`
 * when the viewer may see secret fields and the type has some (specs §9.1, §9.3). The session
 * cookie authenticates the socket, so the token is empty.
 */
export function useLiveSheet(
  actorId: string,
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
        name: documentName({ kind: 'actor', id: actorId, layer }),
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
          if (message?.type !== 'validation') return;
          issues = message.issues;
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
  }, [actorId, layout, secret]);

  return sheet;
}
