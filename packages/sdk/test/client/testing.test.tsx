import { act, cleanup, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@vtt/shared/api';

import {
  useActions,
  useModuleSettings,
  useSystemDice,
  useTableEvents,
  useTranslate,
  useViewer,
} from '../../src/client/index.js';
import { createTestFrame } from '../../src/client/testing.js';

// T-1613: `@vtt/sdk/client/testing`, the frame module components are tested in.

afterEach(cleanup);

const message = (total: number): ChatMessage => ({
  id: 'm1',
  tableId: 'table-1',
  senderId: 'user-2',
  speaker: { name: 'Bob', actorId: null, imageUrl: null },
  audience: 'public',
  recipientIds: [],
  kind: 'roll',
  text: '',
  rolls: [{ expression: '1d20', resolved: '1d20', total, dice: [] }],
  card: null,
  translation: null,
  createdAt: '2026-11-10T12:00:00.000Z',
  editedAt: null,
});

function Tray(): ReactElement {
  const [last, setLast] = useState('none');
  const [settings, set] = useModuleSettings();
  const dice = useSystemDice();
  const viewer = useViewer();
  const actions = useActions();
  const t = useTranslate();
  const [error, setError] = useState('');
  useTableEvents((event) => {
    if (event.type === 'chat.message') setLast(String(event.message.rolls[0]?.total));
  });
  return (
    <div>
      <p>{`${t('tray.last')} ${last} ${String(settings.colour)} ${viewer.role}`}</p>
      <p>{Object.keys(dice).join(' ') || 'no dice'}</p>
      <button
        type="button"
        onClick={() => {
          void set('colour', 'blue');
          actions.roll('1d20', { audience: 'gm' }).catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : 'failed');
          });
        }}
      >
        Go
      </button>
      <p>{error}</p>
    </div>
  );
}

describe('createTestFrame (T-1613)', () => {
  it('renders a module component with events, settings and dice, and records its calls', async () => {
    const frame = createTestFrame({
      settings: { colour: 'red' },
      lang: { 'tray.last': 'Last' },
    });
    render(
      <frame.Provider>
        <Tray />
      </frame.Provider>,
    );
    expect(screen.getByText('Last none red player')).toBeTruthy();
    expect(screen.getByText('no dice')).toBeTruthy();
    act(() => {
      frame.emit({ type: 'chat.message', message: message(17) });
      frame.setDice({ dF: { label: 'Fate', faces: [{ label: '+', value: 1 }] } });
    });
    expect(screen.getByText('Last 17 red player')).toBeTruthy();
    expect(screen.getByText('dF')).toBeTruthy();
    await act(async () => {
      screen.getByRole('button', { name: 'Go' }).click();
      await Promise.resolve();
    });
    expect(frame.calls).toEqual([
      { kind: 'setSetting', name: 'colour', value: 'blue' },
      { kind: 'roll', formula: '1d20', options: { audience: 'gm' } },
    ]);
    // The viewer's own setting changed, as the host would reload it.
    expect(frame.settings).toEqual({ colour: 'blue' });
    expect(screen.getByText('Last 17 blue player')).toBeTruthy();
  });

  it('refuses calls as the server would', async () => {
    const frame = createTestFrame({
      viewer: { id: 'gm', role: 'gm' },
      refuse: (call) => (call.kind === 'roll' ? 'Rolls are off.' : undefined),
    });
    render(
      <frame.Provider>
        <Tray />
      </frame.Provider>,
    );
    await act(async () => {
      screen.getByRole('button', { name: 'Go' }).click();
      await Promise.resolve();
    });
    expect(await screen.findByText('Rolls are off.')).toBeTruthy();
    expect(frame.calls.map((call) => call.kind)).toEqual(['setSetting', 'roll']);
  });

  it('answers encounter() with the encounter it was given', async () => {
    function Round(): ReactElement {
      const actions = useActions();
      const [round, setRound] = useState('?');
      return (
        <button
          type="button"
          onClick={() => {
            void actions.encounter().then((view) => {
              setRound(view === null ? 'none' : 'some');
            });
          }}
        >
          {round}
        </button>
      );
    }
    const frame = createTestFrame();
    render(
      <frame.Provider>
        <Round />
      </frame.Provider>,
    );
    act(() => {
      screen.getByRole('button').click();
    });
    expect(await screen.findByText('none')).toBeTruthy();
    expect(frame.calls).toEqual([{ kind: 'encounter' }]);
  });
});
