import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';

import { createItemBody } from '@vtt/shared/api';
import { Alert, Button, Dialog } from '@vtt/ui';

import { errorMessage } from '../../api/errors.js';
import { SelectInput, TextInput } from '../../forms/fields.js';
import { t } from '../../i18n/index.js';

/** Actors and items share these fields (FR-ENT-02, 06); the rules come from the API contract. */
const { name: nameSchema, type: typeSchema, imageUrl: imageUrlSchema } = createItemBody.shape;

export interface NewEntity {
  name: string;
  type: string;
  imageUrl: string | null;
}

export interface CreateEntityDialogProps {
  open: boolean;
  title: string;
  submitLabel: string;
  /** The types the user may create; the first is preselected. */
  types: readonly string[];
  onClose: () => void;
  /** Creates the entity; a rejection is shown in the dialog. */
  onCreate: (entity: NewEntity) => Promise<void>;
}

/** Creates an actor or a library item with a name, a type and an optional image. */
export function CreateEntityDialog({
  open,
  title,
  submitLabel,
  types,
  onClose,
  onCreate,
}: CreateEntityDialogProps): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { name: '', type: types[0] ?? '', imageUrl: '' },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        await onCreate({
          name: value.name.trim(),
          type: value.type,
          imageUrl: value.imageUrl.trim() || null,
        });
        formApi.reset({ name: '', type: value.type, imageUrl: '' });
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
  });

  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <form.Field name="name" validators={{ onChange: nameSchema, onSubmit: nameSchema }}>
          {(field) => <TextInput field={field} label={t('entities.name')} required />}
        </form.Field>
        <form.Field name="type" validators={{ onSubmit: typeSchema }}>
          {(field) => (
            <SelectInput field={field} label={t('entities.type')} required>
              {types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </SelectInput>
          )}
        </form.Field>
        <form.Field
          name="imageUrl"
          validators={{
            onChange: ({ value }) =>
              value.trim() === ''
                ? undefined
                : imageUrlSchema.safeParse(value.trim()).error?.issues[0]?.message,
          }}
        >
          {(field) => (
            <TextInput
              field={field}
              type="url"
              label={t('entities.imageUrl')}
              hint={t('entities.imageUrlHint')}
            />
          )}
        </form.Field>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onClose}>{t('entities.cancel')}</Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(submitting) => (
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitLabel}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </Dialog>
  );
}
