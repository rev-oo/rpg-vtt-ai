import { useEffect, useId, useState, type ReactElement } from 'react';

import { canSeeGmContent } from '@vtt/shared';
import type { CompendiumEntryResponse } from '@vtt/shared/api';
import { Alert } from '@vtt/ui';

import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { PluginSheet } from '../../plugin-host/PluginSheet.js';
import { useSystem } from '../../plugin-host/system-context.js';
import { useItemTypes } from '../entities/item-groups.js';
import { useTypeLabels } from '../entities/type-labels.js';
import { Attribution } from '../plugins/Attribution.js';
import { useTableData } from '../table/table-data.js';

type EntryState =
  | { status: 'loading' }
  | { status: 'ready'; found: CompendiumEntryResponse }
  | { status: 'failed'; error: string };

/**
 * A compendium entry's sheet, read-only, in a panel of its own (T-1620): pack entries are not
 * the table's, so nothing on it changes or rolls. Copy it to edit it.
 */
export function CompendiumSheetPanel({ entryRef }: { entryRef: string }): ReactElement {
  const { table } = useTableData();
  const [state, setState] = useState<EntryState>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    api.compendiumEntry(table.id, entryRef).then(
      (found) => {
        if (current) setState({ status: 'ready', found });
      },
      (error: unknown) => {
        if (!current) return;
        const gone = error instanceof ApiError && error.status === 404;
        setState({
          status: 'failed',
          error: gone ? t('compendium.notFound') : errorMessage(error),
        });
      },
    );
    return () => {
      current = false;
    };
  }, [table.id, entryRef]);

  if (state.status === 'loading') return <p className="text-muted">{t('app.loading')}</p>;
  if (state.status === 'failed') return <Alert tone="error">{state.error}</Alert>;
  return <CompendiumSheet found={state.found} />;
}

function CompendiumSheet({
  found: { entry, pack },
}: {
  found: CompendiumEntryResponse;
}): ReactElement {
  const { table } = useTableData();
  const host = useSystem();
  const labels = useTypeLabels();
  const { translate } = useItemTypes();
  const titleId = useId();
  return (
    <section className="flex flex-col gap-3" aria-labelledby={titleId}>
      <div>
        <h2 id={titleId} className="text-xl font-semibold">
          {entry.name}
        </h2>
        <p className="text-sm text-muted">
          {t('compendium.sheetOf', {
            type: labels[entry.kind](entry.type),
            pack: translate(pack.label),
          })}
        </p>
      </div>
      {host.status === 'loading' && <p className="text-muted">{t('sheet.loading')}</p>}
      {host.status === 'unavailable' && <Alert tone="info">{t('sheet.unavailable')}</Alert>}
      {host.status === 'error' && (
        <Alert tone="error">{t('table.systemFailed', { detail: host.error })}</Alert>
      )}
      {host.status === 'ready' && (
        <PluginSheet
          host={host}
          actor={{ id: entry.ref, name: entry.name, type: entry.type, system: entry.system }}
          kind={entry.kind}
          readOnly
          secret={canSeeGmContent(table.role)}
        />
      )}
      {pack.attribution && (
        // The credit a pack's plugin needs, beside the entry it credits (T-1614).
        <Attribution attribution={pack.attribution} className="text-xs text-muted" />
      )}
    </section>
  );
}
