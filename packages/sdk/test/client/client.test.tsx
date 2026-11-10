import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ClientSheetContext,
  defineClient,
  useActor,
  useDerived,
  useField,
  useModuleSettings,
  useTableEvents,
  useTranslate,
  useSystemDice,
  useViewer,
  ModuleFrameContext,
  type ClientSheet,
  type ModuleActions,
  type ModuleFrame,
  type TableEvent,
} from '../../src/client/index.js';

function Probe() {
  const [hp, setHp] = useField('hp.value');
  const mod = useDerived('strMod');
  const actor = useActor();
  const t = useTranslate();
  return (
    <button
      type="button"
      onClick={() => {
        setHp(Number(hp) - 1);
      }}
    >
      {`${t('hp')} ${String(hp)} ${String(mod)} ${actor?.name ?? ''}`}
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sheet = (overrides: Partial<ClientSheet> = {}): ClientSheet => ({
  actor: { id: 'a1', name: 'Ayla', type: 'character' },
  readOnly: false,
  get: (path) => (path === 'hp.value' ? 7 : undefined),
  set: vi.fn(),
  adjust: vi.fn(),
  derived: (key) => (key === 'strMod' ? 2 : undefined),
  translate: (text) => text.toUpperCase(),
  ...overrides,
});

describe('@vtt/sdk/client (specs §8.10)', () => {
  it('reads and writes the sheet through the host', () => {
    const value = sheet();
    render(
      <ClientSheetContext.Provider value={value}>
        <Probe />
      </ClientSheetContext.Provider>,
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('HP 7 2 Ayla');
    button.click();
    expect(value.set).toHaveBeenCalledWith('hp.value', 6);
  });

  it('does not write while read-only', () => {
    const value = sheet({ readOnly: true });
    render(
      <ClientSheetContext.Provider value={value}>
        <Probe />
      </ClientSheetContext.Provider>,
    );
    screen.getByRole('button').click();
    expect(value.set).not.toHaveBeenCalled();
  });

  it('only works inside a sheet', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/only works inside a plugin sheet node/);
  });

  it('defines client code as given', () => {
    const definition = { nodes: { probe: () => null } };
    expect(defineClient(definition)).toBe(definition);
  });
});

describe('module frame hooks (T-1603, ADR-077)', () => {
  function Overlay() {
    const [settings, set] = useModuleSettings();
    const viewer = useViewer();
    const [last, setLast] = useState('none');
    useTableEvents((event) => {
      if (event.type === 'chat.message') setLast(String(event.message.rolls[0]?.total));
    });
    const t = useTranslate();
    return (
      <button
        type="button"
        onClick={() => {
          void set('colour', 'blue');
        }}
      >
        {`${t('last')} ${last} ${String(settings.colour)} ${viewer.role} ${viewer.tableId}`}
      </button>
    );
  }

  function moduleFrame(): ModuleFrame & { emit: (event: TableEvent) => void } {
    const listeners = new Set<(event: TableEvent) => void>();
    return {
      tableId: 't1',
      viewer: { id: 'u1', role: 'player' },
      settings: { colour: 'red' },
      dice: { dF: { label: 'Fate', faces: [{ label: '+', value: 1 }] } },
      setSetting: vi.fn(() => Promise.resolve()),
      listen: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      actions: {} as ModuleActions,
      translate: (text) => (text === 'last' ? 'Last' : text),
      emit: (event) => {
        for (const listener of listeners) listener(event);
      },
    };
  }

  it('hear table events, read settings and set the viewer’s own', () => {
    const frame = moduleFrame();
    const { unmount } = render(
      <ModuleFrameContext.Provider value={frame}>
        <Overlay />
      </ModuleFrameContext.Provider>,
    );
    expect(screen.getByRole('button').textContent).toBe('Last none red player t1');
    act(() => {
      frame.emit({
        type: 'chat.message',
        message: {
          id: 'm1',
          tableId: 't1',
          senderId: 'u2',
          speaker: { name: 'Bob', actorId: null, imageUrl: null },
          audience: 'public',
          recipientIds: [],
          kind: 'roll',
          text: '',
          rolls: [{ expression: '1d20', resolved: '1d20', total: 15, dice: [] }],
          card: null,
          createdAt: '2026-11-07T12:00:00.000Z',
          editedAt: null,
        },
      });
    });
    expect(screen.getByRole('button').textContent).toBe('Last 15 red player t1');
    screen.getByRole('button').click();
    expect(frame.setSetting).toHaveBeenCalledWith('colour', 'blue');
    unmount();
    // Unmounted, the overlay stops listening.
    expect(() => {
      frame.emit({ type: 'combat.updated' });
    }).not.toThrow();
  });

  it('only work inside a module overlay or panel', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Overlay />)).toThrow(
      'useModuleSettings() only works inside a module overlay or panel',
    );
  });

  it("read the system's custom dice (T-1612)", () => {
    function Dice() {
      const dice = useSystemDice();
      return <p>{Object.entries(dice).map(([name, die]) => `${name} ${die.label}`)}</p>;
    }
    render(
      <ModuleFrameContext.Provider value={moduleFrame()}>
        <Dice />
      </ModuleFrameContext.Provider>,
    );
    expect(screen.getByText('dF Fate')).toBeTruthy();
  });

  it('declares overlays and panels', () => {
    const definition = defineClient({
      overlays: { tray: { component: Overlay } },
      panels: { log: { component: Overlay } },
    });
    expect(Object.keys(definition.overlays ?? {})).toEqual(['tray']);
    expect(Object.keys(definition.panels ?? {})).toEqual(['log']);
  });
});
