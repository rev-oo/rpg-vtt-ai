import type { ReactElement } from 'react';

import type { PluginAttribution } from '@vtt/shared/api';

/**
 * The credit a plugin's content needs (T-1614), as its manifest words it: the text, linked to
 * its page when it has one. It is never translated, since a licence may ask for exact words.
 */
export function Attribution({
  attribution,
  className = 'text-sm text-muted',
}: {
  attribution: PluginAttribution;
  className?: string;
}): ReactElement {
  return (
    <p className={className} data-testid="plugin-attribution">
      {attribution.url ? (
        <a
          href={attribution.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-fg"
        >
          {attribution.text}
        </a>
      ) : (
        attribution.text
      )}
    </p>
  );
}
