import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import type { Viewer } from '@vtt/sdk/client';

import { t } from '../i18n/index.js';
import { useTableEvents } from '../realtime/use-table-events.js';

import { listen, pageStyles, send } from './frame-channel.js';
import { FRAME_URL } from './frame-protocol.js';
import { useFrameRestarts } from './frame-restarts.js';
import { frameEvent, rateLimiter, runAction, type ActionContext } from './module-actions.js';
import type { LoadedModule, ModuleFrames } from './table-modules.js';

// A module's overlay or panel (T-1603, ADR-077), in the same sandboxed frame as plugin nodes
// (ADR-074): no network, no access to this page. It hears the table's events this page gets,
// which the server filtered for the viewer, and acts only through `runAction`, as the viewer.

export interface ModuleFrameProps {
  module: LoadedModule & { frames: ModuleFrames };
  kind: 'overlay' | 'panel';
  name: string;
  title: string;
  viewer: Viewer;
  context: ActionContext;
  className?: string;
}

export function ModuleFrame({
  module,
  kind,
  name,
  title,
  viewer,
  context,
  className,
}: ModuleFrameProps): ReactElement | null {
  const frame = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);
  const giveUp = useCallback(() => {
    setFailed(true);
  }, []);
  const restarts = useFrameRestarts(giveUp);
  const { begin, live } = restarts;
  const latest = useRef({ module, viewer, context });
  useLayoutEffect(() => {
    latest.current = { module, viewer, context };
  });
  // One limiter for the frame's whole life: reloading settings does not reset it.
  const [allowed] = useState(() => rateLimiter());

  useTableEvents(context.tableId, {
    onEvent: (event) => {
      if (!live()) return;
      const forFrame = frameEvent(event);
      if (forFrame) send(frame.current, { type: 'event', event: forFrame });
    },
  });

  // Listening from the commit that adds the frame: a cached frame page can load and post
  // `ready` before passive effects run, and it says so only once.
  useLayoutEffect(
    () =>
      listen(
        () => frame.current,
        (message) => {
          const current = latest.current;
          switch (message.type) {
            case 'ready':
              if (!begin()) return;
              send(frame.current, {
                type: 'init',
                setup: {
                  ...current.module.frames.code,
                  styles: pageStyles(),
                  view: {
                    kind,
                    name,
                    module: {
                      tableId: current.context.tableId,
                      viewer: current.viewer,
                      settings: current.module.settings,
                    },
                  },
                },
              });
              return;
            case 'action': {
              if (!live()) return;
              const { id } = message;
              if (!allowed()) {
                send(frame.current, { type: 'result', id, ok: false, error: t('module.tooFast') });
                return;
              }
              runAction(message.action, current.context).then(
                (value) => {
                  send(frame.current, { type: 'result', id, ok: true, value });
                },
                (error: unknown) => {
                  const text = error instanceof Error ? error.message : String(error);
                  send(frame.current, { type: 'result', id, ok: false, error: text });
                },
              );
              return;
            }
            case 'failed':
              console.error(`Module ${kind} ${title} failed: ${message.message}`);
              setFailed(true);
              return;
            default:
              return;
          }
        },
      ),
    [kind, name, title, allowed, begin, live],
  );

  // The viewer's settings changed: own changes, the GM's or a reload.
  useEffect(() => {
    if (live()) send(frame.current, { type: 'settings', settings: module.settings });
  }, [module.settings, live]);

  if (failed) {
    // A failed overlay stays out of the way; a failed panel says so.
    return kind === 'overlay' ? null : (
      <p className="p-3 text-sm text-muted">{t('plugin.componentFailed', { name: title })}</p>
    );
  }
  return (
    <iframe
      key={restarts.generation}
      ref={frame}
      src={FRAME_URL}
      title={title}
      sandbox="allow-scripts"
      className={className}
      data-module={module.id}
      onLoad={restarts.onLoad}
    />
  );
}
