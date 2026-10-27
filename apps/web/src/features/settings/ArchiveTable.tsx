import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import type { TableView } from '@vtt/shared/api';
import { Alert, Button } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { t } from '../../i18n/index.js';

/** Archives the table, making it read-only for everyone, or brings it back (FR-TABLE-06). */
export function ArchiveTable({ table }: { table: TableView }): ReactElement {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = table.archivedAt !== null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setTableArchived(table.id, !archived);
      await revalidator.revalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="archive-heading">
      <h2 id="archive-heading" className="text-lg font-semibold">
        {t('archive.title')}
      </h2>
      <p className="text-muted">{t(archived ? 'archive.archivedHelp' : 'archive.help')}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button variant="secondary" disabled={busy} onClick={() => void toggle()}>
          {t(archived ? 'archive.unarchive' : 'archive.archive')}
        </Button>
      </div>
    </section>
  );
}
