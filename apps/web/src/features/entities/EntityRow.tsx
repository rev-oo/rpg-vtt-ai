import type { ReactElement, ReactNode } from 'react';

import { t } from '../../i18n/index.js';

import { startItemDrag, type ItemDrag } from './item-drag.js';

export interface EntityRowProps {
  name: string;
  type: string;
  imageUrl: string | null;
  /** Extra facts under the name, e.g. the caller's access. */
  details?: ReactNode;
  /** Buttons and controls on the right. */
  actions?: ReactNode;
  /** Under a group heading, the name is one level lower (ADR-061). */
  nested?: boolean;
  /** Lets the row be dropped onto an actor sheet's items (ADR-063). */
  drag?: ItemDrag | undefined;
  children?: ReactNode;
}

/** One actor or item in a list. */
export function EntityRow({
  name,
  type,
  imageUrl,
  details,
  actions,
  nested = false,
  drag,
  children,
}: EntityRowProps): ReactElement {
  const Heading = nested ? 'h4' : 'h3';
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3"
      {...(drag && {
        draggable: true,
        onDragStart: (event) => {
          startItemDrag(event, drag);
        },
      })}
    >
      <div className="flex flex-wrap items-center gap-3">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
        ) : (
          <span aria-hidden="true" className="size-10 shrink-0 rounded-lg bg-info-soft" />
        )}
        <div className="flex min-w-40 flex-1 flex-col">
          <Heading className="truncate font-semibold">{name}</Heading>
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
