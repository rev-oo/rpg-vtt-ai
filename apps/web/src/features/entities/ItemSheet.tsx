import { useEffect, useEffectEvent, useId, useState, type ReactElement } from 'react';

import { canSendChat, isGmLike } from '@vtt/shared';
import type { ItemView, TableView } from '@vtt/shared/api';
import { Alert } from '@vtt/ui';

import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { useSystem } from '../../plugin-host/system-context.js';
import { useTableData } from '../table/table-data.js';

import { LiveEntitySheet } from './LiveEntitySheet.js';
import { useRecipeRoll } from './use-recipe-roll.js';

type ItemState =
  { status: 'loading' } | { status: 'ready'; item: ItemView } | { status: 'failed'; error: string };

/**
 * An item's live sheet as a workspace panel (FR-ENT-06, ADR-062). It loads again whenever the
 * table's data does, so a renamed, deleted or no longer visible item shows that.
 */
export function ItemSheetPanel({
  itemId,
  onTitle,
}: {
  itemId: string;
  onTitle: (title: string) => void;
}): ReactElement {
  const data = useTableData();
  const [state, setState] = useState<ItemState>({ status: 'loading' });
  const showTitle = useEffectEvent(onTitle);

  useEffect(() => {
    let current = true;
    api.getItem(itemId).then(
      (item) => {
        if (!current) return;
        setState({ status: 'ready', item });
        showTitle(item.name);
      },
      (error: unknown) => {
        if (!current) return;
        const gone = error instanceof ApiError && (error.status === 404 || error.status === 400);
        setState({ status: 'failed', error: gone ? t('items.notFound') : errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [itemId, data]);

  if (state.status === 'loading') return <p className="text-muted">{t('app.loading')}</p>;
  if (state.status === 'failed') return <Alert tone="error">{state.error}</Alert>;
  return <ItemSheet key={state.item.id} table={data.table} item={state.item} />;
}

function ItemSheet({ table, item }: { table: TableView; item: ItemView }): ReactElement {
  const host = useSystem();
  const titleId = useId();
  const { actors } = useTableData();
  const owner = item.actorId ? actors.find((actor) => actor.id === item.actorId) : undefined;
  const { roll, status, failure } = useRecipeRoll(table.id);
  // An owned item's sheet rolls as its holder, made with the item; library items roll nothing.
  const mayRoll = owner !== undefined && item.access === 'owner' && canSendChat(table.role);

  return (
    <section className="flex flex-col gap-3" aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className="text-xl font-semibold">
          {item.name}
        </h2>
        <p className="text-sm text-muted">
          {owner ? t('items.ownedBy', { name: owner.name }) : t('items.inLibrary')}
        </p>
      </div>
      {item.dataVersion !== table.systemVersion && (
        // Plugin data migrations are LATER (§9.7, ADR-058): say so instead.
        <Alert tone="info">
          {t('sheet.dataVersion', {
            system: table.systemName,
            made: item.dataVersion,
            current: table.systemVersion,
          })}
        </Alert>
      )}
      {host.status === 'loading' && <p className="text-muted">{t('sheet.loading')}</p>}
      {host.status === 'unavailable' && <Alert tone="info">{t('sheet.unavailable')}</Alert>}
      {host.status === 'error' && (
        <Alert tone="error">{t('table.systemFailed', { detail: host.error })}</Alert>
      )}
      {host.status === 'ready' && (
        <>
          {failure && <Alert tone="error">{failure}</Alert>}
          {status && (
            <p role="status" className="text-sm text-muted">
              {status}
            </p>
          )}
          <LiveEntitySheet
            host={host}
            kind="item"
            entity={item}
            secret={isGmLike(table.role)}
            onRoll={
              mayRoll
                ? (name, args) => {
                    roll(owner.id, name, args, item.id);
                  }
                : undefined
            }
          />
        </>
      )}
    </section>
  );
}
