import { useCallback, useEffect, useState } from 'react';

import type { TokenView } from '@vtt/shared/api';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { useTableEvents } from '../../realtime/use-table-events.js';

export interface Tokens {
  tokens: readonly TokenView[];
  error: string | null;
  /**
   * Runs a change; its answer replaces that token (or adds it), `null` removes it, and a
   * failure is shown and refetched.
   */
  change: (tokenId: string, action: Promise<TokenView | null>) => void;
  /** Moves a token at once, before the server answers. */
  move: (token: TokenView, column: number, row: number) => void;
}

/**
 * A scene's tokens as the member may see them (FR-MAP-03, ADR-068). They refetch on
 * `token.updated` for the scene, which the server sends only to those who may see the change.
 */
export function useTokens(tableId: string, sceneId: string): Tokens {
  const [tokens, setTokens] = useState<readonly TokenView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.listTokens(sceneId).then(setTokens, (e: unknown) => {
      setError(errorMessage(e));
    });
  }, [sceneId]);
  useEffect(refresh, [refresh]);
  useTableEvents(tableId, {
    onEvent: (event) => {
      if (event.type === 'token.updated' && event.payload.sceneId === sceneId) refresh();
    },
    onResync: refresh,
  });

  const change = (tokenId: string, action: Promise<TokenView | null>) => {
    setError(null);
    action.then(
      (next) => {
        setTokens((list) => {
          if (!next) return list.filter((token) => token.id !== tokenId);
          return list.some((token) => token.id === tokenId)
            ? list.map((token) => (token.id === tokenId ? next : token))
            : [...list, next];
        });
      },
      (e: unknown) => {
        setError(errorMessage(e));
        refresh();
      },
    );
  };
  const move = (token: TokenView, column: number, row: number) => {
    setTokens((list) =>
      list.map((other) => (other.id === token.id ? { ...other, column, row } : other)),
    );
    change(token.id, api.updateToken(token.id, { column, row }));
  };
  return { tokens, error, move, change };
}
