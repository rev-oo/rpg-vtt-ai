import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** At most this many restarts in `RESTART_WINDOW_MS`; past that the frame counts as failed. */
export const RESTART_LIMIT = 10;
export const RESTART_WINDOW_MS = 10_000;

export interface FrameRestarts {
  /** The key of the current `<iframe>` element; it changes on each restart. */
  generation: number;
  /** Claims the current frame's `ready`: true only once per element, and never for a stale one. */
  begin: () => boolean;
  /** True while the current frame started and was not reloaded since. */
  live: () => boolean;
  onLoad: () => void;
}

/**
 * Keeps a plugin frame on the app's frame page (ADR-074, ADR-077). A frame loads again when the
 * page moves it, as dockview does when it hides a tab or moves a group, or when its code
 * navigates it away. Either way the host stops talking to it at once and mounts a new element,
 * which loads the frame page afresh, so a page the code navigated to never gets the plugin's
 * data. Restarting too often, as code that keeps navigating would make it, counts as failing.
 */
export function useFrameRestarts(onGiveUp: () => void): FrameRestarts {
  const [generation, setGeneration] = useState(0);
  const started = useRef(false);
  const stale = useRef(false);
  const loads = useRef(0);
  const restarts = useRef<number[]>([]);

  // A new element: it has not loaded or started yet.
  useLayoutEffect(() => {
    started.current = false;
    stale.current = false;
    loads.current = 0;
  }, [generation]);

  const onLoad = useCallback(() => {
    loads.current += 1;
    if (loads.current === 1) return;
    stale.current = true;
    const now = Date.now();
    restarts.current = restarts.current.filter((time) => time > now - RESTART_WINDOW_MS);
    if (restarts.current.length >= RESTART_LIMIT) {
      onGiveUp();
      return;
    }
    restarts.current.push(now);
    setGeneration((current) => current + 1);
  }, [onGiveUp]);

  const begin = useCallback(() => {
    if (stale.current || started.current) return false;
    started.current = true;
    return true;
  }, []);
  const live = useCallback(() => started.current && !stale.current, []);

  return { generation, begin, live, onLoad };
}
