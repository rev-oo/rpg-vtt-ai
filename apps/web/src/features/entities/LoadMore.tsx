import { useEffect, useRef, type ReactElement } from 'react';

import { Button } from '@vtt/ui';

import { t } from '../../i18n/index.js';

/** Loads the next page when scrolled into view, or when clicked. */
export function LoadMore({
  loading,
  onLoad,
}: {
  loading: boolean;
  onLoad: () => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  useEffect(() => {
    const end = ref.current;
    if (!end || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadRef.current();
    });
    observer.observe(end);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className="flex justify-center">
      <Button variant="ghost" disabled={loading} onClick={onLoad}>
        {t(loading ? 'app.loading' : 'lists.loadMore')}
      </Button>
    </div>
  );
}
