import {
  FRAME_URL,
  frameMessageSchema,
  type FrameMessage,
  type FrameSetup,
  type HostMessage,
} from './frame-protocol.js';

// Talking to plugin frames (T-1502, ADR-074). A frame's origin is opaque, so messages to it
// name no target origin, and messages from it count only when they come from its window and
// pass the protocol's schema.

/** The plugin parts every frame of a system gets. */
export type FrameCode = Omit<FrameSetup, 'view' | 'styles'>;

/** The page's stylesheets as text, for plugin components to look like the rest of the app. */
export function pageStyles(): string[] {
  return [...document.styleSheets].flatMap((sheet) => {
    try {
      return [[...sheet.cssRules].map((rule) => rule.cssText).join('\n')];
    } catch {
      // A stylesheet from another origin keeps its rules; the app has none.
      return [];
    }
  });
}

export const send = (frame: HTMLIFrameElement | null, message: HostMessage): void => {
  // The frame's origin is opaque, so no target origin can name it.
  frame?.contentWindow?.postMessage(message, '*');
};

/** Calls `receive` with each checked message from `frame`'s window. */
export function listen(
  frame: () => HTMLIFrameElement | null,
  receive: (message: FrameMessage) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    const window = frame()?.contentWindow;
    if (!window || event.source !== window) return;
    const parsed = frameMessageSchema.safeParse(event.data);
    if (parsed.success) receive(parsed.data);
  };
  globalThis.addEventListener('message', onMessage);
  return () => {
    globalThis.removeEventListener('message', onMessage);
  };
}

/** How long a probe may take to load the code and list what it exports. */
const PROBE_TIME_LIMIT_MS = 10_000;

/**
 * Runs a plugin's client code once in a hidden frame and lists the components it exports,
 * so the app knows what to render in frames. Rejects when the code fails to load.
 */
/** What a plugin's client code exports. */
export interface ClientExports {
  nodes: string[];
  cards: string[];
  /** A module's overlays and panels (ADR-077). */
  overlays: { name: string; interactive: boolean }[];
  panels: { name: string; title: string }[];
}

export function probeClient(code: FrameCode): Promise<ClientExports> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.hidden = true;
  frame.src = FRAME_URL;
  return new Promise<ClientExports>((resolve, reject) => {
    let stop = (): void => undefined;
    const timer = setTimeout(() => {
      fail(new Error('the client code took too long to load'));
    }, PROBE_TIME_LIMIT_MS);
    const done = () => {
      clearTimeout(timer);
      stop();
      frame.remove();
    };
    const fail = (error: Error) => {
      done();
      reject(error);
    };
    stop = listen(
      () => frame,
      (message) => {
        if (message.type === 'ready') {
          send(frame, {
            type: 'init',
            setup: { ...code, styles: [], view: { kind: 'probe' } },
          });
        } else if (message.type === 'exports') {
          done();
          resolve({
            nodes: message.nodes,
            cards: message.cards,
            overlays: message.overlays,
            panels: message.panels,
          });
        } else if (message.type === 'failed') {
          fail(new Error(message.message));
        }
      },
    );
    document.body.append(frame);
  });
}
