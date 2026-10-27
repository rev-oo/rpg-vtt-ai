import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import type { PackSummary, TableView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';
import { useSystem } from '../../plugin-host/system-context.js';

/**
 * The system's compendium packs (FR-PLUGIN-09, ADR-051): the GM imports one into the table's
 * actors and library items. Importing again adds only what the table does not have yet.
 */
export function Compendium({ table }: { table: TableView }): ReactElement | null {
  const system = useSystem();
  const translate = system.status === 'ready' ? system.translate : (text: string) => text;
  const revalidator = useRevalidator();
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const load = useCallback(() => {
    api.listPacks(table.id).then(setPacks, (e: unknown) => {
      setNotice({ tone: 'error', text: errorMessage(e) });
    });
  }, [table.id]);
  useEffect(load, [load]);

  const importPack = (pack: PackSummary) => {
    setBusy(pack.name);
    setNotice(null);
    api
      .importPack(table.id, pack.name)
      .then(
        ({ created, skipped }) => {
          setNotice({ tone: 'info', text: t('compendium.imported', { created, skipped }) });
          load();
          void revalidator.revalidate();
        },
        (e: unknown) => {
          setNotice({ tone: 'error', text: errorMessage(e) });
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };

  if (packs === null && notice === null) return null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="compendium-heading">
      <h2 id="compendium-heading" className="text-lg font-semibold">
        {t('compendium.title')}
      </h2>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {packs?.length === 0 && <p className="text-muted">{t('compendium.none')}</p>}
      {packs && packs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {packs.map((pack) => {
            const label = translate(pack.label);
            const total = pack.actors + pack.items;
            return (
              <li
                key={pack.name}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"
              >
                <div>
                  <p className="font-semibold">{label}</p>
                  <p className="text-sm text-muted">
                    {t('compendium.contents', {
                      actors: pack.actors,
                      items: pack.items,
                      imported: pack.imported,
                    })}
                  </p>
                </div>
                <Button
                  disabled={busy !== null || pack.imported === total}
                  aria-label={t('compendium.importOf', { name: label })}
                  onClick={() => {
                    importPack(pack);
                  }}
                >
                  {pack.imported === 0 ? t('compendium.import') : t('compendium.importMissing')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
