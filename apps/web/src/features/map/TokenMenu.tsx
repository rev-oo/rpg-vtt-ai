import { useEffect, useEffectEvent, useRef, type KeyboardEvent, type ReactElement } from 'react';

import type { TokenView } from '@vtt/shared/api';

import type { Point } from './geometry.js';
import { MENU_WIDTH } from './menu-position.js';

export interface MenuAction {
  label: string;
  run: () => void;
}

export interface TokenMenuProps {
  token: TokenView;
  /** Where it opens, in pixels of the map panel. */
  at: Point;
  actions: readonly MenuAction[];
  onClose: () => void;
}

/**
 * A token's menu on the map (FR-MAP-03, ADR-069), opened by a right click or the context-menu
 * key: the token list's actions, as the member may take them. Arrows move between them;
 * Escape, a click elsewhere or an action closes it.
 */
export function TokenMenu({ token, at, actions, onClose }: TokenMenuProps): ReactElement {
  const menu = useRef<HTMLUListElement>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    menu.current?.querySelector('button')?.focus();
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', away, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
    };
  }, []);

  const keys = (event: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll('button') ?? [])];
    const current = items.findIndex((item) => item === document.activeElement);
    const by = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose();
    } else if (by !== 0) {
      event.preventDefault();
      items[(current + by + items.length) % items.length]?.focus();
    }
  };

  return (
    <ul
      ref={menu}
      role="menu"
      aria-label={token.name}
      style={{ left: at.x, top: at.y, width: MENU_WIDTH }}
      className="absolute z-10 flex flex-col rounded-lg border border-line bg-surface p-1 shadow-lg"
      onKeyDown={keys}
    >
      {actions.map((action) => (
        <li key={action.label} role="none">
          <button
            type="button"
            role="menuitem"
            className="w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-info-soft focus-visible:bg-info-soft"
            onClick={() => {
              onClose();
              action.run();
            }}
          >
            {action.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
