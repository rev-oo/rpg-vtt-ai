import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FrameCode } from '../src/plugin-host/frame-channel.js';
import type { FrameSheet, HostMessage } from '../src/plugin-host/frame-protocol.js';
import { RESTART_LIMIT } from '../src/plugin-host/frame-restarts.js';
import { PluginFrame } from '../src/plugin-host/PluginFrame.js';

// The app's half of the frame bridge (T-1502). jsdom runs no frame scripts, so the test plays
// the frame: it posts as the frame's window and reads what the app sends it.

const CODE: FrameCode = { pluginId: 'tiny-d20', code: 'export default {};', lang: [{ a: 'A' }] };
const SHEET: FrameSheet = {
  actor: { id: 'a1', name: 'Ayla', type: 'hero' },
  readOnly: false,
  data: { hp: 7 },
  rowPath: [],
  derived: {},
};

function setup(sheet: FrameSheet = SHEET) {
  const onSet = vi.fn();
  const onAdjust = vi.fn();
  const view = render(
    <PluginFrame
      code={CODE}
      title="hpBar"
      view={{ kind: 'node', name: 'hpBar', props: { max: 10 }, sheet }}
      sheet={sheet}
      onSet={onSet}
      onAdjust={onAdjust}
    />,
  );
  const frame = screen.getByTitle<HTMLIFrameElement>('hpBar');
  const window = frame.contentWindow;
  if (!window) throw new Error('no frame window');
  const sent = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
  const fromFrame = (data: unknown, source: MessageEventSource | null = window) => {
    act(() => {
      globalThis.dispatchEvent(new MessageEvent('message', { data, source }));
    });
  };
  const messages = () => sent.mock.calls.map(([message]) => message as HostMessage);
  return { ...view, frame, fromFrame, messages, onSet, onAdjust };
}

describe('plugin frames (T-1502)', () => {
  it('is sandboxed to scripts alone, so it gets an opaque origin', () => {
    const { frame } = setup();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe('/plugin-frame.html');
  });

  it('sends the code and the sheet once the frame is ready, then each change', () => {
    const { fromFrame, messages, rerender } = setup();
    fromFrame({ type: 'ready' });
    fromFrame({ type: 'ready' });
    const [init, ...rest] = messages();
    expect(rest).toEqual([]);
    expect(init).toMatchObject({
      type: 'init',
      setup: { pluginId: 'tiny-d20', code: 'export default {};', lang: [{ a: 'A' }] },
    });
    expect(init?.type === 'init' && init.setup.view).toMatchObject({
      kind: 'node',
      name: 'hpBar',
      props: { max: 10 },
      sheet: SHEET,
    });

    const next = { ...SHEET, data: { hp: 5 } };
    rerender(
      <PluginFrame
        code={CODE}
        title="hpBar"
        view={{ kind: 'node', name: 'hpBar', props: { max: 10 }, sheet: next }}
        sheet={next}
      />,
    );
    expect(messages().at(-1)).toEqual({ type: 'sheet', sheet: next });
  });

  it('passes field writes on and sizes itself to its content', () => {
    const { frame, fromFrame, onSet, onAdjust } = setup();
    fromFrame({ type: 'ready' });
    fromFrame({ type: 'set', path: 'hp', value: 3 });
    fromFrame({ type: 'adjust', path: 'hp', delta: -1 });
    fromFrame({ type: 'height', height: 48 });
    expect(onSet).toHaveBeenCalledWith('hp', 3);
    expect(onAdjust).toHaveBeenCalledWith('hp', -1);
    expect(frame.style.height).toBe('48px');
    fromFrame({ type: 'height', height: 99_999 });
    expect(frame.style.height).toBe('4000px');
  });

  it('ignores other windows and malformed messages', () => {
    const { fromFrame, onSet, onAdjust } = setup();
    fromFrame({ type: 'set', path: 'hp', value: 3 }, globalThis.window);
    fromFrame({ type: 'adjust', path: 'hp', delta: 'lots' });
    fromFrame({ type: 'set', path: '' });
    fromFrame('set hp');
    expect(onSet).not.toHaveBeenCalled();
    expect(onAdjust).not.toHaveBeenCalled();
  });

  it('starts a new frame when the page reloads its frame, as dockview does on a hidden tab', () => {
    const { frame, fromFrame, messages, onSet } = setup();
    fromFrame({ type: 'ready' });
    expect(messages().map((message) => message.type)).toEqual(['init']);
    fireEvent.load(frame);
    fireEvent.load(frame);
    // The reloaded document is no longer trusted: a page the code navigated to gets nothing.
    fromFrame({ type: 'ready' });
    fromFrame({ type: 'set', path: 'hp', value: 3 });
    expect(onSet).not.toHaveBeenCalled();
    expect(messages().map((message) => message.type)).toEqual(['init']);
    // A new element takes its place, on the frame page, and gets the plugin again.
    const fresh = screen.getByTitle<HTMLIFrameElement>('hpBar');
    expect(fresh).not.toBe(frame);
    expect(fresh.getAttribute('src')).toBe('/plugin-frame.html');
    expect(screen.queryByText(/failed to show/)).toBeNull();
  });

  it('gives up on a frame that keeps reloading', () => {
    setup();
    for (let restart = 0; restart <= RESTART_LIMIT; restart += 1) {
      const frame = screen.getByTitle<HTMLIFrameElement>('hpBar');
      fireEvent.load(frame);
      fireEvent.load(frame);
    }
    expect(screen.getByText('The plugin component “hpBar” failed to show.')).toBeInTheDocument();
  });

  it('shows a notice when the component fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fromFrame } = setup();
    fromFrame({ type: 'failed', message: 'boom' });
    expect(screen.getByText(/hpBar/)).toBeInTheDocument();
    expect(screen.queryByTitle('hpBar')).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
