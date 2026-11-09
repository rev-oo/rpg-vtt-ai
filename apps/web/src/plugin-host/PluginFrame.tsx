import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import { t } from '../i18n/index.js';

import { listen, pageStyles, send } from './frame-channel.js';
import {
  FRAME_URL,
  MAX_FRAME_HEIGHT,
  type FrameSetup,
  type FrameSheet,
  type FrameView,
} from './frame-protocol.js';
import { useFrameRestarts } from './frame-restarts.js';

// The app's half of the plugin bridge (T-1502, ADR-074): one sandboxed <iframe> per custom
// node or card. `allow-scripts` alone gives the frame an opaque origin, so it has no cookies,
// no storage and no access to this page; its own policy gives it no network.

export interface PluginFrameProps {
  code: Omit<FrameSetup, 'view' | 'styles'>;
  view: Exclude<FrameView, { kind: 'probe' }>;
  /** Names the node or card, for screen readers and in the failure notice. */
  title: string;
  /** A node's sheet, sent again whenever it changes. */
  sheet?: FrameSheet | undefined;
  onSet?: ((path: string, value: unknown) => void) | undefined;
  onAdjust?: ((path: string, delta: number) => void) | undefined;
}

/** A plugin node or card in its own sandboxed frame, sized to its content. */
export function PluginFrame({
  code,
  view,
  title,
  sheet,
  onSet,
  onAdjust,
}: PluginFrameProps): ReactElement {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const [failed, setFailed] = useState(false);
  // What the listener reads, without listening again on every render.
  const latest = useRef({ code, view, sheet, onSet, onAdjust });
  useLayoutEffect(() => {
    latest.current = { code, view, sheet, onSet, onAdjust };
  });
  const giveUp = useCallback(() => {
    setFailed(true);
  }, []);
  const restarts = useFrameRestarts(giveUp);
  const { begin, live } = restarts;

  useEffect(
    () =>
      listen(
        () => frame.current,
        (message) => {
          const current = latest.current;
          switch (message.type) {
            case 'ready': {
              // Each frame element gets the plugin once: see useFrameRestarts.
              if (!begin()) return;
              const view =
                current.view.kind === 'node' && current.sheet
                  ? { ...current.view, sheet: current.sheet }
                  : current.view;
              send(frame.current, {
                type: 'init',
                setup: { ...current.code, styles: pageStyles(), view },
              });
              return;
            }
            case 'height':
              setHeight(Math.min(message.height, MAX_FRAME_HEIGHT));
              return;
            case 'set':
              if (!live()) return;
              current.onSet?.(message.path, message.value);
              return;
            case 'adjust':
              if (!live()) return;
              current.onAdjust?.(message.path, message.delta);
              return;
            case 'failed':
              console.error(`Plugin component ${title} failed: ${message.message}`);
              setFailed(true);
              return;
            case 'exports':
              return;
          }
        },
      ),
    [title, begin, live],
  );

  useEffect(() => {
    if (live() && sheet) send(frame.current, { type: 'sheet', sheet });
  }, [sheet, live]);

  if (failed) {
    return (
      <p className="rounded-lg border border-dashed border-line p-2 text-sm text-muted">
        {t('plugin.componentFailed', { name: title })}
      </p>
    );
  }
  return (
    <iframe
      key={restarts.generation}
      ref={frame}
      src={FRAME_URL}
      title={title}
      sandbox="allow-scripts"
      className="block w-full border-0 bg-transparent"
      style={{ height }}
      onLoad={restarts.onLoad}
    />
  );
}
