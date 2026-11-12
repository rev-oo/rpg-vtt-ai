import { useState, type KeyboardEvent, type ReactElement } from 'react';

import type { SceneView, TokenView } from '@vtt/shared/api';
import { Button, cn } from '@vtt/ui';

import { t } from '../../i18n/index.js';
import { ICON } from '../../icons.js';

import { stepCell, type Cell } from './geometry.js';
import { StatusIcons } from './StatusIcons.js';

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

/** Whether the list is open, kept per browser (T-1620). */
const OPEN_KEY = 'vtt.tokens.open';

function storedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function storeOpen(open: boolean): void {
  try {
    if (open) localStorage.setItem(OPEN_KEY, '1');
    else localStorage.removeItem(OPEN_KEY);
  } catch {
    // No storage: the list starts closed next time.
  }
}

/** A position as people count cells, from 1; on a gridless scene, to a tenth of a cell. */
const place = (cells: number): number => Math.round((cells + 1) * 10) / 10;

/**
 * The scene's tokens as a list under the canvas (FR-MAP-03, NFR-10): each names its cell, and
 * arrow keys on a token the member may move move it a cell at a time. The list folds away to
 * leave the map more room, and scrolls when long (T-1620); the selected token's actions stay
 * in view either way.
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
  const [open, setOpen] = useState(storedOpen);
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
      <details
        open={open}
        onToggle={(event) => {
          const next = event.currentTarget.open;
          setOpen(next);
          storeOpen(next);
        }}
      >
        <summary className="cursor-pointer text-sm font-semibold">
          {t('tokens.summary', { count: tokens.length })}
        </summary>
        <ul
          aria-label={t('tokens.title')}
          className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto"
        >
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
                {token.statuses.length > 0 && ' '}
                <StatusIcons statuses={token.statuses} />
              </button>
            </li>
          ))}
        </ul>
      </details>
      {selected && (
        <div className="flex flex-wrap items-center gap-1">
          {selected.movable && <p className="mr-2 text-sm text-muted">{t('tokens.moveHint')}</p>}
          {canOpen(selected) && (
            <Button
              icon={<ICON.open />}
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
                icon={selected.hidden ? <ICON.show /> : <ICON.hide />}
                variant="ghost"
                onClick={() => {
                  onHide(selected, !selected.hidden);
                }}
              >
                {t(selected.hidden ? 'tokens.reveal' : 'tokens.hide', { name: selected.name })}
              </Button>
              <Button
                icon={<ICON.delete />}
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
