import type { ReactElement, ReactNode } from 'react';

import { t } from '../../i18n/index.js';

export interface EntityRowProps {
  name: string;
  type: string;
  imageUrl: string | null;
  /** Extra facts under the name, e.g. the caller's access. */
  details?: ReactNode;
  /** Buttons and controls on the right. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** One actor or item in a list. */
export function EntityRow({
  name,
  type,
  imageUrl,
  details,
  actions,
  children,
}: EntityRowProps): ReactElement {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
        ) : (
          <span aria-hidden="true" className="size-10 shrink-0 rounded-lg bg-info-soft" />
        )}
        <div className="flex min-w-40 flex-1 flex-col">
          <h3 className="truncate font-semibold">{name}</h3>
          <p className="flex flex-wrap gap-x-2 text-sm text-muted">
            <span>{t('entities.typeLabel', { type })}</span>
            {details && <span aria-hidden="true">·</span>}
            {details}
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </li>
  );
}
