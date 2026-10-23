import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';

import { createJournalBody, type CreateJournalInput } from '@vtt/shared/api';
import { Alert, Button, Dialog } from '@vtt/ui';

import { errorMessage } from '../../api/errors.js';
import { TextInput } from '../../forms/fields.js';
import { t } from '../../i18n/index.js';

const titleSchema = createJournalBody.shape.title;

export interface CreateJournalDialogProps {
  open: boolean;
  onClose: () => void;
  /** Creates the entry; a rejection is shown in the dialog. */
  onCreate: (input: CreateJournalInput) => Promise<void>;
}

/** A new journal entry: a title, hidden from players unless shared at once (FR-JOURNAL-03). */
export function CreateJournalDialog({
  open,
  onClose,
  onCreate,
}: CreateJournalDialogProps): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { title: '', shared: false },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        await onCreate({ title: value.title.trim(), hidden: !value.shared });
        formApi.reset();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
  });

  return (
    <Dialog open={open} title={t('journal.new')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <form.Field name="title" validators={{ onChange: titleSchema, onSubmit: titleSchema }}>
          {(field) => <TextInput field={field} label={t('journal.entryTitle')} required />}
        </form.Field>
        <form.Field name="shared">
          {(field) => (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={field.state.value}
                onChange={(e) => {
                  field.handleChange(e.target.checked);
                }}
              />
              {t('journal.shareNow')}
            </label>
          )}
        </form.Field>
        <p className="text-sm text-muted">{t('journal.hiddenNote')}</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onClose}>{t('entities.cancel')}</Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(submitting) => (
              <Button type="submit" variant="primary" disabled={submitting}>
                {t('journal.create')}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </Dialog>
  );
}
