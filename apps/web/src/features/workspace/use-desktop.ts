import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 768px)';

const media = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;

/** Whether the window is at least 768 px wide; false where it cannot tell (jsdom). */
export function useDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = media();
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => media()?.matches ?? false,
  );
}
