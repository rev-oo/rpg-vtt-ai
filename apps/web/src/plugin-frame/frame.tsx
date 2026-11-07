import * as React from 'react';
import { Component, type ComponentType, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot, type Root } from 'react-dom/client';

import type { Value } from '@vtt/formula';
import * as sdk from '@vtt/sdk/client';
import type {
  CardProps,
  ClientSheet,
  ModuleActions,
  ModuleFrame,
  NodeProps,
  PostOptions,
  TableEvent,
} from '@vtt/sdk/client';

import {
  FRAME_RUNTIME_GLOBAL,
  type FrameAction,
  type FrameMessage,
  type FrameModule,
  type FrameSetup,
  type FrameSheet,
  type HostMessage,
} from '../plugin-host/frame-protocol.js';

// The frame's half of the plugin bridge (T-1502, ADR-074). It runs in a sandboxed <iframe>
// with an opaque origin: no cookies, no storage, no network (its policy allows none), and no
// way into the app's page. The app sends the plugin's code and the sheet; this side renders
// one node or card with them and sends back field changes and its height.

// React and the SDK for the plugin's imports, through the import map of the frame page.
(globalThis as Record<string, unknown>)[FRAME_RUNTIME_GLOBAL] = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '@vtt/sdk/client': sdk,
};

const post = (
  message: FrameMessage | { type: 'action'; id: string; action: FrameAction },
): void => {
  // The app's origin is the only other party; the frame's own is opaque, so `*` is the only
  // target there is, and the app checks that a message comes from this frame.
  window.parent.postMessage(message, '*');
};

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2000);

type Components = Record<string, ComponentType<never>>;

/** The default export of `code/client.js`: objects of components under `nodes` and `cards`. */
function components(value: unknown, key: 'nodes' | 'cards'): Components {
  if (typeof value !== 'object' || value === null) {
    throw new Error('code/client.js must export defineClient({ … }) by default');
  }
  const group: unknown = (value as Record<string, unknown>)[key];
  if (group === undefined) return {};
  if (typeof group !== 'object' || group === null) {
    throw new Error(`code/client.js: "${key}" must be an object of components`);
  }
  const result: Components = {};
  for (const [name, component] of Object.entries(group)) {
    if (typeof component !== 'function' && (typeof component !== 'object' || component === null)) {
      throw new Error(`code/client.js: ${key}.${name} is not a component`);
    }
    result[name] = component as ComponentType<never>;
  }
  return result;
}

interface Declared {
  component: ComponentType;
  interactive: boolean;
  title: string;
}

/** A module's `overlays` or `panels`: objects of `{ component, … }` by name (ADR-077). */
function declared(value: unknown, key: 'overlays' | 'panels'): Record<string, Declared> {
  if (typeof value !== 'object' || value === null) return {};
  const group: unknown = (value as Record<string, unknown>)[key];
  if (group === undefined) return {};
  if (typeof group !== 'object' || group === null) {
    throw new Error(`code/client.js: "${key}" must be an object`);
  }
  const result: Record<string, Declared> = {};
  for (const [name, entry] of Object.entries(group)) {
    const { component, interactive, title } = (entry ?? {}) as Record<string, unknown>;
    if (typeof component !== 'function' && (typeof component !== 'object' || component === null)) {
      throw new Error(`code/client.js: ${key}.${name}.component is not a component`);
    }
    result[name] = {
      component: component as ComponentType,
      interactive: interactive === true,
      title: typeof title === 'string' ? title : name,
    };
  }
  return result;
}

interface Loaded {
  nodes: Components;
  cards: Components;
  overlays: Record<string, Declared>;
  panels: Record<string, Declared>;
}

/** Runs the plugin's code as a module, so it imports React and the SDK by name. */
async function loadCode(code: string): Promise<Loaded> {
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
  const loaded = (await import(/* @vite-ignore */ url)) as { default?: unknown };
  return {
    nodes: components(loaded.default, 'nodes'),
    cards: components(loaded.default, 'cards'),
    overlays: declared(loaded.default, 'overlays'),
    panels: declared(loaded.default, 'panels'),
  };
}

function addStyles(styles: readonly string[]): void {
  for (const text of styles) {
    const element = document.createElement('style');
    element.textContent = text;
    document.head.append(element);
  }
}

function translator(lang: FrameSetup['lang']): (text: string) => string {
  return (text) => {
    for (const texts of lang) if (Object.hasOwn(texts, text)) return texts[text] ?? text;
    return text;
  };
}

/** The value at a dot path, walking objects only: collections are maps of rows by id. */
function valueAt(data: unknown, path: readonly string[]): unknown {
  let current = data;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** The SDK's view of the sheet; its writes go to the app, which checks and stores them. */
function clientSheet(sheet: FrameSheet, translate: (text: string) => string): ClientSheet {
  return {
    actor: sheet.actor,
    readOnly: sheet.readOnly,
    get: (path) => valueAt(sheet.data, [...sheet.rowPath, ...path.split('.')]),
    set: (path, value) => {
      if (!sheet.readOnly) post({ type: 'set', path, value });
    },
    adjust: (path, delta) => {
      if (!sheet.readOnly) post({ type: 'adjust', path, delta });
    },
    derived: (key) =>
      Object.hasOwn(sheet.derived, key)
        ? (sheet.derived[key] as ReturnType<ClientSheet['derived']>)
        : undefined,
    translate,
  };
}

/** Reports a failing component to the app, which shows a notice in its place. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    post({ type: 'failed', message: errorText(error) });
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Actions waiting for the host's answer, by id. */
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let nextAction = 0;

/** Asks the host to act as the viewer; settles with the host's `result`. */
function act(action: FrameAction): Promise<unknown> {
  nextAction += 1;
  const id = String(nextAction);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    post({ type: 'action', id, action });
  });
}

const target = (options: PostOptions = {}) => ({
  audience: options.audience ?? 'public',
  recipientIds: options.recipientIds ?? [],
  actorId: options.actorId ?? null,
});

const actions: ModuleActions = {
  sendChat: async (text, options) => {
    await act({ kind: 'chat', input: { text, ...target(options) } });
  },
  roll: async (formula, options) => {
    await act({ kind: 'roll', input: { formula, ...target(options) } });
  },
  openSheet: async (actorId) => {
    await act({ kind: 'openSheet', actorId });
  },
  openJournal: async (entryId) => {
    await act({ kind: 'openJournal', entryId });
  },
  combat: async (action) => {
    await act({ kind: 'combat', action });
  },
  encounter: async () =>
    (await act({ kind: 'encounter' })) as Awaited<ReturnType<ModuleActions['encounter']>>,
};

const listeners = new Set<(event: TableEvent) => void>();

let root: Root | null = null;
let render: ((sheet: FrameSheet) => void) | null = null;
let renderModule: ((settings: Readonly<Record<string, Value>>) => void) | null = null;

/** Draws a module's overlay or panel with what the host said of the table (ADR-077). */
function startModule(
  Declared: ComponentType,
  module: FrameModule,
  translate: (text: string) => string,
): void {
  // The host's page shows through: an overlay over the table, a panel on its own background.
  addStyles(['html, body { background: transparent !important; }']);
  renderModule = (settings) => {
    const frame: ModuleFrame = {
      tableId: module.tableId,
      viewer: module.viewer,
      settings,
      setSetting: async (name, value) => {
        await act({ kind: 'setting', name, value: value as string | number | boolean });
      },
      listen: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      actions,
      translate,
    };
    root?.render(
      <sdk.ModuleFrameContext.Provider value={frame}>
        <Boundary>
          <Declared />
        </Boundary>
      </sdk.ModuleFrameContext.Provider>,
    );
  };
  renderModule(module.settings);
}

async function start(setup: FrameSetup): Promise<void> {
  const loaded = await loadCode(setup.code);
  const { view } = setup;
  if (view.kind === 'probe') {
    post({
      type: 'exports',
      nodes: Object.keys(loaded.nodes),
      cards: Object.keys(loaded.cards),
      overlays: Object.entries(loaded.overlays).map(([name, { interactive }]) => ({
        name,
        interactive,
      })),
      panels: Object.entries(loaded.panels).map(([name, { title }]) => ({ name, title })),
    });
    return;
  }
  addStyles(setup.styles);
  const translate = translator(setup.lang);
  const container = document.getElementById('root');
  if (!container) throw new Error('the frame page has no root');
  // The plugin's stylesheets are scoped to its id (ADR-021).
  container.dataset.plugin = setup.pluginId;
  root = createRoot(container);
  if (view.kind === 'overlay' || view.kind === 'panel') {
    const found = (view.kind === 'overlay' ? loaded.overlays : loaded.panels)[view.name];
    if (!found) throw new Error(`the code has no ${view.kind} "${view.name}"`);
    startModule(found.component, view.module, translate);
    return;
  }
  if (view.kind === 'card') {
    const Card = loaded.cards[view.name] as ComponentType<CardProps> | undefined;
    if (!Card) throw new Error(`the code has no card "${view.name}"`);
    const props = { card: view.card, rolls: view.rolls, speaker: view.speaker } as Omit<
      CardProps,
      'translate'
    >;
    root.render(
      <Boundary>
        <Card {...props} translate={translate} />
      </Boundary>,
    );
    return;
  }
  const Node = loaded.nodes[view.name] as ComponentType<NodeProps> | undefined;
  if (!Node) throw new Error(`the code has no node "${view.name}"`);
  const { props } = view;
  render = (sheet) => {
    root?.render(
      <sdk.ClientSheetContext.Provider value={clientSheet(sheet, translate)}>
        <Boundary>
          <Node props={props} />
        </Boundary>
      </sdk.ClientSheetContext.Provider>,
    );
  };
  render(view.sheet);
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (message.type === 'init' && root === null) {
    start(message.setup).catch((error: unknown) => {
      post({ type: 'failed', message: errorText(error) });
    });
  } else if (message.type === 'sheet') {
    render?.(message.sheet);
  } else if (message.type === 'event') {
    for (const listener of listeners) {
      try {
        listener(message.event);
      } catch (error) {
        console.error(error);
      }
    }
  } else if (message.type === 'settings') {
    renderModule?.(message.settings);
  } else if (message.type === 'result') {
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) waiting?.resolve(message.value);
    else waiting?.reject(new Error(message.error));
  }
});

// The app sizes the frame to its content.
new ResizeObserver(() => {
  post({ type: 'height', height: Math.ceil(document.documentElement.scrollHeight) });
}).observe(document.body);

post({ type: 'ready' });
