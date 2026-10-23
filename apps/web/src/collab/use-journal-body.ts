import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { documentName } from '@vtt/shared';

import { collabUrl, parseMessage, REVOKED } from './use-live-sheet.js';

/** A journal entry's body (ADR-038): connecting, refused, or synced. */
export type JournalBody =
  | { status: 'connecting' }
  | { status: 'denied' }
  | { status: 'ready'; fragment: Y.XmlFragment; readOnly: boolean };

/** The root fragment the body lives in (ADR-038). */
export const JOURNAL_BODY = 'body';

/**
 * Opens `journal:<id>:main` on `/ws/collab` while the entry is shown. The server closes it
 * when the entry is hidden from the viewer, and says when their access becomes read-only.
 */
export function useJournalBody(entryId: string): JournalBody {
  const [body, setBody] = useState<JournalBody>({ status: 'connecting' });

  useEffect(() => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment(JOURNAL_BODY);
    let readOnly = true;
    let synced = false;
    const show = () => {
      if (synced) setBody({ status: 'ready', fragment, readOnly });
    };
    const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: documentName({ kind: 'journal', id: entryId, layer: 'main' }),
      document: doc,
      token: '',
      onAuthenticated: ({ scope }) => {
        readOnly = scope === 'readonly';
        show();
      },
      onAuthenticationFailed: () => {
        setBody({ status: 'denied' });
      },
      onSynced: ({ state }) => {
        synced = state;
        show();
      },
      onStateless: ({ payload }) => {
        const message = parseMessage(payload);
        if (message?.type !== 'access') return;
        readOnly = message.readOnly;
        show();
      },
      onClose: ({ event }) => {
        if (REVOKED.has(event.reason)) setBody({ status: 'denied' });
      },
    });
    provider.attach();

    return () => {
      provider.destroy();
      socket.destroy();
      doc.destroy();
      setBody({ status: 'connecting' });
    };
  }, [entryId]);

  return body;
}
