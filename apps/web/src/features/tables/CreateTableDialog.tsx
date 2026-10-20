import { useForm } from '@tanstack/react-form';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert, Button, Dialog } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import type { GameSystem, GameTable } from '../../api/schemas.js';
import { SelectInput, TextInput } from '../../forms/fields.js';
import { createTableSchema } from '../../forms/schemas.js';
import { t } from '../../i18n/index.js';

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
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { name: '', description: '', systemId: '' },
    validators: { onChange: createTableSchema, onSubmit: createTableSchema },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        const table = await api.createTable(createTableSchema.parse(value));
        formApi.reset({ name: '', description: '', systemId: value.systemId });
        onCreated(table);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
  });

  useEffect(() => {
    if (!open) return;
    let active = true;
    api
      .listSystems()
      .then((list) => {
        if (!active) return;
        setError(null);
        setSystems(list);
        const first = list[0];
        if (first && !form.getFieldValue('systemId')) form.setFieldValue('systemId', first.id);
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, [open, form]);

  const noSystems = systems?.length === 0;

  return (
    <Dialog open={open} title={t('createTable.title')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        {noSystems && <Alert>{t('createTable.noSystems')}</Alert>}
        <form.Field name="name">
          {(field) => <TextInput field={field} label={t('createTable.name')} required />}
        </form.Field>
        <form.Field name="description">
          {(field) => <TextInput field={field} label={t('createTable.description')} />}
        </form.Field>
        <form.Field name="systemId">
          {(field) => (
            <SelectInput
              field={field}
              label={t('createTable.system')}
              required
              disabled={!systems || noSystems}
            >
              {systems?.map((system) => (
                <option key={system.id} value={system.id}>
                  {t('tables.system', { name: system.name, version: system.version })}
                </option>
              ))}
            </SelectInput>
          )}
        </form.Field>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onClose}>{t('createTable.cancel')}</Button>
          <form.Subscribe selector={(s) => [s.isSubmitting, s.values.systemId] as const}>
            {([isSubmitting, systemId]) => (
              <Button type="submit" variant="primary" disabled={isSubmitting || !systemId}>
                {t('createTable.submit')}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </Dialog>
  );
}
