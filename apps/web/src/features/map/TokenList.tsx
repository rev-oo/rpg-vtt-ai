import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';

import type { SceneView, TokenView } from '@vtt/shared/api';
import { Button, cn, IconButton } from '@vtt/ui';

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

/** A position as people count cells, from 1; on a gridless scene, to a tenth of a cell. */
const place = (cells: number): number => Math.round((cells + 1) * 10) / 10;

/**
 * The scene's tokens, floating over the map (FR-MAP-03, NFR-10): a button opens the list, where
 * each token names its cell and arrow keys on a token the member may move move it a cell at a
 * time. The selected token's actions show under the button whether the list is open or not.
 * Escape or a click elsewhere closes the list.
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
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        // Focus inside the list goes back to the button that opened it.
        if (root.current?.contains(document.activeElement)) toggle.current?.focus();
      } else if (event.target instanceof Node && root.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);
  if (tokens.length === 0) return null;
  const selected = tokens.find((token) => token.id === selectedId);

  const step = (token: TokenView) => (event: ReactKeyboardEvent) => {
    if (!token.movable) return;
    const cell = stepCell(scene, token, event.key);
    if (cell === undefined) return;
    event.preventDefault();
    if (cell) onMove(token, cell);
  };

  return (
    <div
      ref={root}
      className="absolute top-3 right-3 z-10 flex max-w-[calc(100%-5rem)] flex-col items-end gap-2"
    >
      <Button
        ref={toggle}
        icon={<ICON.tokens />}
        className="shadow"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {t('tokens.summary', { count: tokens.length })}
      </Button>
      {open && (
        <div
          id={listId}
          className="flex w-72 max-w-full flex-col gap-2 rounded-lg border border-line bg-surface p-2 shadow-lg"
        >
          <ul
            aria-label={t('tokens.title')}
            className="flex max-h-64 flex-col gap-1 overflow-y-auto"
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
                    'w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-info-soft aria-pressed:bg-info-soft',
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
          {selected?.movable && <p className="px-1 text-xs text-muted">{t('tokens.moveHint')}</p>}
        </div>
      )}
      {selected && (canOpen(selected) || manages) && (
        <div className="flex max-w-full items-center gap-1 rounded-lg bg-surface p-1 pl-3 shadow">
          <span className="min-w-0 truncate text-sm font-semibold">{selected.name}</span>
          {canOpen(selected) && (
            <IconButton
              icon={<ICON.open />}
              label={t('tokens.open', { name: selected.name })}
              variant="ghost"
              onClick={() => {
                onOpen(selected);
              }}
            />
          )}
          {manages && (
            <>
              <IconButton
                icon={selected.hidden ? <ICON.show /> : <ICON.hide />}
                label={t(selected.hidden ? 'tokens.reveal' : 'tokens.hide', {
                  name: selected.name,
                })}
                variant="ghost"
                onClick={() => {
                  onHide(selected, !selected.hidden);
                }}
              />
              <IconButton
                icon={<ICON.delete />}
                label={t('tokens.remove', { name: selected.name })}
                variant="ghost"
                onClick={() => {
                  onRemove(selected);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
