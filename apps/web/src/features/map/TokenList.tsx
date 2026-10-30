import type { KeyboardEvent, ReactElement } from 'react';

import type { SceneView, TokenView } from '@vtt/shared/api';
import { Button, cn } from '@vtt/ui';

import { t } from '../../i18n/index.js';

import { stepCell, type Cell } from './geometry.js';

export interface TokenListProps {
  scene: SceneView;
  tokens: readonly TokenView[];
  selectedId: string | null;
  /** GMs and assistants hide and remove tokens. */
  manages: boolean;
  /** The actors the member may open, by id. */
  canOpen: (token: TokenView) => boolean;
  /** A token picked, or `null` when the selected one is picked again. */
  onSelect: (token: TokenView | null) => void;
  onMove: (token: TokenView, cell: Cell) => void;
  onOpen: (token: TokenView) => void;
  onHide: (token: TokenView, hidden: boolean) => void;
  onRemove: (token: TokenView) => void;
}

/** A position as people count cells, from 1; on a gridless scene, to a tenth of a cell. */
const place = (cells: number): number => Math.round((cells + 1) * 10) / 10;

/**
 * The scene's tokens as a list beside the canvas (FR-MAP-03, NFR-10): each names its cell, and
 * arrow keys on a token the member may move move it a cell at a time.
 */
export function TokenList({
  scene,
  tokens,
  selectedId,
  manages,
  canOpen,
  onSelect,
  onMove,
  onOpen,
  onHide,
  onRemove,
}: TokenListProps): ReactElement | null {
  if (tokens.length === 0) return null;
  const selected = tokens.find((token) => token.id === selectedId);

  const step = (token: TokenView) => (event: KeyboardEvent) => {
    if (!token.movable) return;
    const cell = stepCell(scene, token, event.key);
    if (cell === undefined) return;
    event.preventDefault();
    if (cell) onMove(token, cell);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line bg-surface px-3 py-2">
      <ul aria-label={t('tokens.title')} className="flex flex-wrap gap-1">
        {tokens.map((token) => (
          <li key={token.id}>
            <button
              type="button"
              aria-pressed={token.id === selectedId}
              aria-keyshortcuts={
                token.movable ? 'ArrowLeft ArrowRight ArrowUp ArrowDown' : undefined
              }
              className={cn(
                'rounded-full border border-line px-3 py-1 text-sm aria-pressed:bg-info-soft',
                token.hidden && 'italic text-muted',
              )}
              onClick={() => {
                onSelect(token.id === selectedId ? null : token);
              }}
              onKeyDown={step(token)}
            >
              {t('tokens.at', {
                name: token.name,
                column: place(token.column),
                row: place(token.row),
              })}
              {token.hidden && ` · ${t('tokens.hidden')}`}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="flex flex-wrap items-center gap-1">
          {selected.movable && <p className="mr-2 text-sm text-muted">{t('tokens.moveHint')}</p>}
          {canOpen(selected) && (
            <Button
              variant="ghost"
              onClick={() => {
                onOpen(selected);
              }}
            >
              {t('tokens.open', { name: selected.name })}
            </Button>
          )}
          {manages && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  onHide(selected, !selected.hidden);
                }}
              >
                {t(selected.hidden ? 'tokens.reveal' : 'tokens.hide', { name: selected.name })}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  onRemove(selected);
                }}
              >
                {t('tokens.remove', { name: selected.name })}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
