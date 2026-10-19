import { useEffect, useState, type ReactElement } from 'react';

import { Alert, Button, Dialog, Select, TextField } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import type { GameSystem, GameTable } from '../../api/schemas.js';
import { t } from '../../i18n/index.js';
import { useSubmit } from '../auth/useSubmit.js';

export interface CreateTableDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (table: GameTable) => void;
}

/** Creates a table with one of the enabled system plugins (FR-TABLE-01). */
export function CreateTableDialog({
  open,
  onClose,
  onCreated,
}: CreateTableDialogProps): ReactElement {
  const [systems, setSystems] = useState<GameSystem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemId, setSystemId] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    api
      .listSystems()
      .then((list) => {
        if (!active) return;
        setLoadError(null);
        setSystems(list);
        setSystemId((current) => current || (list[0]?.id ?? ''));
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [open]);

  const { busy, error, onSubmit } = useSubmit(async () => {
    const table = await api.createTable({ name, description, systemId });
    setName('');
    setDescription('');
    onCreated(table);
  });

  const noSystems = systems?.length === 0;

  return (
    <Dialog open={open} title={t('createTable.title')} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        {(error ?? loadError) && <Alert tone="error">{error ?? loadError}</Alert>}
        {noSystems && <Alert>{t('createTable.noSystems')}</Alert>}
        <TextField
          label={t('createTable.name')}
          name="name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <TextField
          label={t('createTable.description')}
          name="description"
          maxLength={2000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
        <Select
          label={t('createTable.system')}
          name="systemId"
          required
          disabled={!systems || noSystems}
          value={systemId}
          onChange={(e) => {
            setSystemId(e.target.value);
          }}
        >
          {systems?.map((system) => (
            <option key={system.id} value={system.id}>
              {t('tables.system', { name: system.name, version: system.version })}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onClose}>{t('createTable.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || !systemId}>
            {t('createTable.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
