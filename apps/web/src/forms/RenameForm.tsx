import { useForm } from '@tanstack/react-form';
import type { ReactElement } from 'react';
import type { z } from 'zod';

import { Button } from '@vtt/ui';

import { t } from '../i18n/index.js';

import { TextInput } from './fields.js';

/**
 * Renames an actor, item or journal entry in place of its heading (T-1620): the name's field
 * with Cancel and Save. `schema` is the name's rule from `@vtt/shared/api`.
 */
export function RenameForm({
  name,
  label,
  schema,
  onCancel,
  onSave,
}: {
  name: string;
  label: string;
  schema: z.ZodType<string, string>;
  onCancel: () => void;
  onSave: (name: string) => Promise<void>;
}): ReactElement {
  const form = useForm({
    defaultValues: { name },
    onSubmit: async ({ value }) => {
      await onSave(value.name.trim());
    },
  });
  return (
    <form
      className="flex flex-1 flex-wrap items-end gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name" validators={{ onChange: schema, onSubmit: schema }}>
        {(field) => <TextInput field={field} label={label} className="flex-1" required />}
      </form.Field>
      <Button onClick={onCancel}>{t('entities.cancel')}</Button>
      <Button type="submit" variant="primary">
        {t('entities.save')}
      </Button>
    </form>
  );
}
