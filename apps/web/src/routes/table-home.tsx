import type { ReactElement } from 'react';

import { useTableData } from '../features/table/table-data.js';
import { t } from '../i18n/index.js';

/** The stage before anything is opened: what the table is, and how to begin (ADR-059). */
export default function TableHomeRoute(): ReactElement {
  const { table } = useTableData();
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-3 py-6" aria-labelledby="table-home">
      <h2 id="table-home" className="text-2xl font-bold">
        {t('workspace.overview')}
      </h2>
      <p className="text-sm text-muted">
        {t(`tables.role.${table.role}`)} ·{' '}
        {t('tables.system', { name: table.systemName, version: table.systemVersion })}
      </p>
      {table.description && <p>{table.description}</p>}
      <p className="text-muted">{t('workspace.hint')}</p>
    </section>
  );
}
