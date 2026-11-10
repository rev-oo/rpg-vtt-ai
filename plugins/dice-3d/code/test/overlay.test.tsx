// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TableEvent } from '@vtt/sdk/client';
import { createTestFrame, type TestFrameOptions } from '@vtt/sdk/client/testing';

import client from '../client.js';

// The overlay in the SDK's test frame (T-1613): jsdom has no WebGL, so throws run unseen, and
// with reduced motion they land at once, on the faces the server rolled.

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Rolled = { die: string; results: { value: number; label?: string }[] }[];

const rolled = (terms: Rolled, senderId = 'user-1'): TableEvent => ({
  type: 'chat.message',
  message: {
    id: 'm1',
    tableId: 'table-1',
    senderId,
    speaker: { name: 'Mira', actorId: null, imageUrl: null },
    audience: 'public',
    recipientIds: [],
    kind: 'roll',
    text: '',
    rolls: [
      {
        expression: '',
        resolved: '',
        total: 0,
        dice: terms.map(({ die, results }) => ({
          formula: die,
          count: results.length,
          die,
          total: 0,
          results: results.map((result) => ({ ...result, active: true })),
        })),
      },
    ],
    card: null,
    translation: null,
    createdAt: '2026-11-10T12:00:00.000Z',
    editedAt: null,
  },
});

function renderOverlay(options: TestFrameOptions = {}) {
  const Dice = client.overlays?.dice?.component;
  if (!Dice) throw new Error('dice-3d has no dice overlay');
  const frame = createTestFrame(options);
  const view = render(
    <frame.Provider>
      <Dice />
    </frame.Provider>,
  );
  const overlay = view.container.querySelector('.dice-3d');
  if (!(overlay instanceof HTMLElement)) throw new Error('The overlay drew no element');
  return { frame, overlay };
}

describe('the dice overlay (T-1613)', () => {
  it("lands a roll's dice on the server's results, without WebGL", () => {
    const { frame, overlay } = renderOverlay();
    expect(overlay.dataset).toMatchObject({ state: 'idle', drawing: 'false' });
    act(() => {
      frame.emit(
        rolled([
          { die: 'd20', results: [{ value: 17 }] },
          { die: 'd6', results: [{ value: 4 }] },
        ]),
      );
    });
    expect(overlay.dataset).toMatchObject({ state: 'resting', shown: '17 4' });
    // It only listens: it asked the host for nothing.
    expect(frame.calls).toEqual([]);
  });

  it("keeps others' rolls off the table when the viewer hides them", () => {
    const { frame, overlay } = renderOverlay({ settings: { showOthers: false } });
    act(() => {
      frame.emit(rolled([{ die: 'd8', results: [{ value: 3 }] }], 'user-2'));
    });
    expect(overlay.dataset.state).toBe('idle');
    act(() => {
      frame.setSettings({ showOthers: true });
    });
    act(() => {
      frame.emit(rolled([{ die: 'd8', results: [{ value: 3 }] }], 'user-2'));
    });
    expect(overlay.dataset).toMatchObject({ state: 'resting', shown: '3' });
  });

  it("throws the system's custom dice with the face the server rolled", () => {
    // Fate dice have six faces, two of each: the overlay throws them as d6s.
    const fate = {
      label: 'Fate',
      faces: ['-', '-', ' ', ' ', '+', '+'].map((label) => ({
        label,
        value: label === '+' ? 1 : label === '-' ? -1 : 0,
      })),
    };
    const { frame, overlay } = renderOverlay({ dice: { dF: fate } });
    act(() => {
      frame.emit(rolled([{ die: 'dF', results: [{ value: 1, label: '+' }] }]));
    });
    expect(overlay.dataset).toMatchObject({ state: 'resting', shown: '+' });
  });
});
