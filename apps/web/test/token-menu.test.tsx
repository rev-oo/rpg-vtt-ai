import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TokenView } from '@vtt/shared/api';

import { menuPosition } from '../src/features/map/menu-position.js';
import { TokenMenu } from '../src/features/map/TokenMenu.js';

// T-1405 (ADR-069): a token's menu on the map.

const ayla: TokenView = {
  id: 'k1',
  sceneId: 's1',
  actorId: 'a1',
  name: 'Ayla',
  imageUrl: null,
  column: 2,
  row: 3,
  hidden: false,
  movable: true,
};

describe('token menu (T-1405)', () => {
  it('focuses its first action, moves by arrows and runs the chosen one', async () => {
    const open = vi.fn();
    const hide = vi.fn();
    const onClose = vi.fn();
    render(
      <TokenMenu
        token={ayla}
        at={{ x: 10, y: 20 }}
        actions={[
          { label: 'Open Ayla', run: open },
          { label: 'Hide Ayla', run: hide },
        ]}
        onClose={onClose}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByRole('menu', { name: 'Ayla' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open Ayla' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Hide Ayla' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Open Ayla' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{Enter}');
    expect(hide).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape and on a press elsewhere', async () => {
    const onClose = vi.fn();
    render(
      <>
        <button type="button">Elsewhere</button>
        <TokenMenu
          token={ayla}
          at={{ x: 0, y: 0 }}
          actions={[{ label: 'Open Ayla', run: vi.fn() }]}
          onClose={onClose}
        />
      </>,
    );
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('opens inside the panel near its edges', () => {
    const panel = { width: 400, height: 300 };
    expect(menuPosition({ x: 50, y: 40 }, panel, 3)).toEqual({ x: 50, y: 40 });
    expect(menuPosition({ x: 390, y: 290 }, panel, 3)).toEqual({ x: 188, y: 186 });
  });
});
