import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginDefinition } from '@vtt/plugin-schema';
import type { ChatMessage, ServerEvent } from '@vtt/shared/api';

import { setCsrfToken } from '../src/api/client.js';
import { ACTION_LIMIT, type HostMessage } from '../src/plugin-host/frame-protocol.js';
import {
  frameEvent,
  rateLimiter,
  runAction,
  type ActionContext,
} from '../src/plugin-host/module-actions.js';
import { ModuleFrame } from '../src/plugin-host/ModuleFrame.js';
import {
  systemDice,
  TableSystemContext,
  type TableSystem,
} from '../src/plugin-host/system-context.js';
import { declaredFrames, type FramedModule } from '../src/plugin-host/table-modules.js';
import { closeEventsClient } from '../src/realtime/events-client.js';

import { fakeApi } from './support/fake-api.js';
import { fakeWebSocket, serverEvent } from './support/fake-socket.js';

// Module overlays and panels (T-1603, ADR-077). jsdom runs no frame scripts, so the tests play
// the frame: they post as its window and read what the app sends it.

afterEach(() => {
  closeEventsClient();
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

const MESSAGE: ChatMessage = {
  id: 'm1',
  tableId: 't1',
  senderId: 'u2',
  speaker: { name: 'Bob', actorId: null, imageUrl: null },
  audience: 'public',
  recipientIds: [],
  kind: 'roll',
  text: '1d20',
  rolls: [{ expression: '1d20', resolved: '1d20', total: 12, dice: [] }],
  card: null,
  createdAt: '2026-11-07T12:00:00.000Z',
  editedAt: null,
};

function context(extra: Partial<ActionContext> = {}): ActionContext {
  return {
    tableId: 't1',
    moduleId: 'dice-fx',
    actorIds: () => ['00000000-0000-4000-8000-000000000001'],
    open: vi.fn(),
    reload: vi.fn(),
    ...extra,
  };
}

const forbidden = {
  status: 403,
  body: { error: { code: 'forbidden', message: 'Only GMs and assistants may run combat.' } },
};

describe('module frame events (T-1603)', () => {
  it('passes on what the page heard of chat, combat, scenes and tokens', () => {
    const event = (type: string, payload: object) =>
      ({ v: 1, id: 'e', type, tableId: 't1', payload }) as ServerEvent;
    expect(frameEvent(event('chat.message', { message: MESSAGE }))).toEqual({
      type: 'chat.message',
      message: MESSAGE,
    });
    expect(frameEvent(event('chat.deleted', { id: 'm1' }))).toEqual({
      type: 'chat.deleted',
      id: 'm1',
    });
    expect(frameEvent(event('combat.updated', {}))).toEqual({ type: 'combat.updated' });
    expect(frameEvent(event('token.updated', { sceneId: 's1' }))).toEqual({
      type: 'token.updated',
      sceneId: 's1',
    });
    // Entity documents and table settings are not for modules.
    expect(frameEvent(event('table.updated', {}))).toBeNull();
    expect(
      frameEvent(event('entity.changed', { kind: 'actor', id: 'a1', change: 'updated' })),
    ).toBeNull();
  });
});

describe('module frame actions (T-1603)', () => {
  it(`allows ${String(ACTION_LIMIT)} actions in a window, then refuses until it passes`, () => {
    let now = 0;
    const allowed = rateLimiter(3, 1000, () => now);
    expect([allowed(), allowed(), allowed(), allowed()]).toEqual([true, true, true, false]);
    now = 999;
    expect(allowed()).toBe(false);
    now = 1000;
    expect(allowed()).toBe(true);
  });

  it('refuses what is not an action, without a request', async () => {
    const { calls } = fakeApi({});
    for (const action of [
      null,
      { kind: 'fetch', url: 'https://example.com' },
      { kind: 'roll', input: { formula: '' } },
      { kind: 'setting', name: 'x', value: { nested: true } },
      { kind: 'openSheet', actorId: '../admin' },
    ]) {
      await expect(runAction(action, context())).rejects.toThrow(
        'The module asked for something the app does not offer.',
      );
    }
    expect(calls).toEqual([]);
  });

  it('rolls and posts as the viewer, through the API', async () => {
    const { calls } = fakeApi({
      'POST /tables/t1/rolls': { status: 201, body: { message: MESSAGE } },
      'POST /tables/t1/messages': { status: 201, body: { message: MESSAGE } },
    });
    await runAction({ kind: 'roll', input: { formula: '1d20' } }, context());
    await runAction({ kind: 'chat', input: { text: 'hi', audience: 'gm' } }, context());
    expect(calls.map(({ method, path, body }) => [method, path, body])).toEqual([
      [
        'POST',
        '/tables/t1/rolls',
        { formula: '1d20', audience: 'public', recipientIds: [], actorId: null },
      ],
      [
        'POST',
        '/tables/t1/messages',
        { text: 'hi', audience: 'gm', recipientIds: [], actorId: null },
      ],
    ]);
  });

  it("passes on the server's refusal of what the viewer may not do", async () => {
    fakeApi({ 'POST /tables/t1/encounter/start': forbidden });
    await expect(runAction({ kind: 'combat', action: 'start' }, context())).rejects.toThrow(
      'Only GMs and assistants may run combat.',
    );
  });

  it('opens only sheets the viewer sees', async () => {
    fakeApi({});
    const open = vi.fn();
    await expect(
      runAction(
        { kind: 'openSheet', actorId: '00000000-0000-4000-8000-000000000002' },
        context({ open }),
      ),
    ).rejects.toThrow('That is not something you can see at this table.');
    expect(open).not.toHaveBeenCalled();
    await runAction(
      { kind: 'openSheet', actorId: '00000000-0000-4000-8000-000000000001' },
      context({ open }),
    );
    expect(open).toHaveBeenCalledWith({
      kind: 'sheet',
      id: 'actor:00000000-0000-4000-8000-000000000001',
      actorId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it("changes the viewer's own settings, then reloads the modules", async () => {
    const { calls } = fakeApi({
      'PATCH /me/plugins/dice-fx/settings': {
        body: { definitions: {}, lang: {}, defaultLocale: 'en', values: { colour: 'blue' } },
      },
    });
    const reload = vi.fn();
    await runAction({ kind: 'setting', name: 'colour', value: 'blue' }, context({ reload }));
    expect(calls.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['PATCH', '/me/plugins/dice-fx/settings', { values: { colour: 'blue' } }],
    ]);
    expect(reload).toHaveBeenCalledOnce();
  });
});

// Only the frame's code and exports matter here.
const DEFINITION = {} as PluginDefinition;

const MODULE: FramedModule = {
  id: 'dice-fx',
  name: 'Dice FX',
  version: '1.0.0',
  definition: DEFINITION,
  translate: (text) => text,
  settings: { colour: 'red' },
  styles: [],
  client: '/plugins/dice-fx/code/client.js',
  clientError: null,
  frames: {
    code: { pluginId: 'dice-fx', code: 'export default {};', lang: [] },
    overlays: [{ name: 'tray', interactive: false }],
    panels: [],
  },
};

function setup() {
  const sockets = fakeWebSocket();
  const view = render(
    <ModuleFrame
      module={MODULE}
      kind="overlay"
      name="tray"
      title="Dice tray"
      viewer={{ id: 'u1', role: 'player' }}
      context={context()}
    />,
  );
  const frame = screen.getByTitle<HTMLIFrameElement>('Dice tray');
  const window = frame.contentWindow;
  if (!window) throw new Error('no frame window');
  const sent = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
  const fromFrame = (data: unknown) => {
    act(() => {
      globalThis.dispatchEvent(new MessageEvent('message', { data, source: window }));
    });
  };
  const messages = () => sent.mock.calls.map(([message]) => message as HostMessage);
  const socket = () => {
    const last = sockets.at(-1);
    if (!last) throw new Error('no socket');
    return last;
  };
  return { ...view, frame, fromFrame, messages, socket };
}

describe('module frames on the page (T-1603)', () => {
  it('runs sandboxed and gets the module, viewer and settings', () => {
    const { frame, fromFrame, messages } = setup();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    fromFrame({ type: 'ready' });
    expect(messages()[0]).toMatchObject({
      type: 'init',
      setup: {
        pluginId: 'dice-fx',
        view: {
          kind: 'overlay',
          name: 'tray',
          module: {
            tableId: 't1',
            viewer: { id: 'u1', role: 'player' },
            settings: { colour: 'red' },
          },
        },
      },
    });
  });

  it('passes on only the events the page received, and none before it started', () => {
    const { fromFrame, messages, socket } = setup();
    act(() => {
      socket().open();
    });
    const receive = (event: Record<string, unknown>) => {
      act(() => {
        socket().receive(serverEvent(event));
      });
    };
    receive({ type: 'chat.message', tableId: 't1', payload: { message: MESSAGE } });
    expect(messages()).toEqual([]);
    fromFrame({ type: 'ready' });
    receive({ type: 'chat.message', tableId: 't1', payload: { message: MESSAGE } });
    receive({ type: 'table.updated', tableId: 't1', payload: {} });
    expect(messages().slice(1)).toEqual([
      { type: 'event', event: { type: 'chat.message', message: MESSAGE } },
    ]);
  });

  it('answers each action, and refuses those past the limit', async () => {
    fakeApi({ 'POST /tables/t1/rolls': { status: 201, body: { message: MESSAGE } } });
    const { fromFrame, messages } = setup();
    fromFrame({ type: 'ready' });
    for (let index = 0; index <= ACTION_LIMIT; index += 1) {
      fromFrame({
        type: 'action',
        id: String(index),
        action: { kind: 'roll', input: { formula: '1d20' } },
      });
    }
    await vi.waitFor(() => {
      expect(messages().filter((message) => message.type === 'result')).toHaveLength(
        ACTION_LIMIT + 1,
      );
    });
    const results = messages().filter((message) => message.type === 'result');
    expect(results.filter((result) => result.ok)).toHaveLength(ACTION_LIMIT);
    expect(results.find((result) => result.id === String(ACTION_LIMIT))).toEqual({
      type: 'result',
      id: String(ACTION_LIMIT),
      ok: false,
      error: 'The module acted too often; try again in a few seconds.',
    });
  });
});

describe('declared frames and system dice (T-1612)', () => {
  it("lists a module's overlays and panels from its manifest, with no code run", () => {
    const definition = {
      manifest: {
        frames: {
          overlays: { tray: {}, picker: { interactive: true } },
          panels: { log: { title: 'panel.log' } },
        },
      },
    } as unknown as PluginDefinition;
    expect(declaredFrames(definition)).toEqual({
      overlays: [
        { name: 'tray', interactive: false },
        { name: 'picker', interactive: true },
      ],
      panels: [{ name: 'log', title: 'panel.log' }],
    });
    expect(declaredFrames({ manifest: {} } as PluginDefinition)).toEqual({
      overlays: [],
      panels: [],
    });
  });

  const READY = {
    status: 'ready',
    system: {
      definition: {
        dice: {
          dF: {
            label: 'dice.fate',
            faces: ['-', ' ', '+'],
            values: { '-': -1, ' ': 0, '+': 1 },
          },
          dX: { faces: [1, { label: 'two', value: 2 }] },
        },
      },
    },
    translate: (text: string) => (text === 'dice.fate' ? 'Fate' : text),
  } as unknown as TableSystem;
  const FATE = {
    dF: {
      label: 'Fate',
      faces: [
        { label: '-', value: -1 },
        { label: ' ', value: 0 },
        { label: '+', value: 1 },
      ],
    },
    dX: {
      label: 'dX',
      faces: [
        { label: '1', value: 1 },
        { label: 'two', value: 2 },
      ],
    },
  };

  it("gives the system's custom dice with their faces and translated names", () => {
    expect(systemDice({ status: 'loading' })).toEqual({});
    expect(systemDice({ status: 'unavailable' })).toEqual({});
    expect(systemDice(READY)).toEqual(FATE);
  });

  it('sends them when the frame starts, and again once the system loads', () => {
    const frameFor = (system: TableSystem) => (
      <TableSystemContext value={system}>
        <ModuleFrame
          module={MODULE}
          kind="overlay"
          name="tray"
          title="Dice tray"
          viewer={{ id: 'u1', role: 'player' }}
          context={context()}
        />
      </TableSystemContext>
    );
    fakeWebSocket();
    const { rerender } = render(frameFor({ status: 'loading' }));
    const window = screen.getByTitle<HTMLIFrameElement>('Dice tray').contentWindow;
    if (!window) throw new Error('no frame window');
    const sent = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    act(() => {
      globalThis.dispatchEvent(
        new MessageEvent('message', { data: { type: 'ready' }, source: window }),
      );
    });
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      type: 'init',
      setup: { view: { module: { dice: {} } } },
    });
    rerender(frameFor(READY));
    expect(sent.mock.calls.map(([message]) => message as HostMessage)).toContainEqual({
      type: 'dice',
      dice: FATE,
    });
  });
});
