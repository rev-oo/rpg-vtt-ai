import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';
import { z } from 'zod';

import { createUserBody, type AdminUserResponse } from '@vtt/shared/api';
import { Alert, Button, Dialog } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/errors.js';
import { TextInput } from '../../forms/fields.js';
import { t } from '../../i18n/index.js';

/** The request body, with the admin box always set, as the form always has it. */
const newUserForm = createUserBody.extend({ isAdmin: z.boolean() });

export interface NewUserDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new user and their one-time password. */
  onCreated: (response: AdminUserResponse) => void;
}

/** Creates a user, who signs in with a one-time password and then picks their own (T-1619). */
export function NewUserDialog({ open, onClose, onCreated }: NewUserDialogProps): ReactElement {
  return (
    <Dialog open={open} title={t('users.newTitle')} onClose={onClose}>
      {open && <NewUserForm onCancel={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function NewUserForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (response: AdminUserResponse) => void;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { username: '', displayName: '', isAdmin: false },
    validators: { onChange: newUserForm, onSubmit: newUserForm },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        onCreated(await api.createUser(newUserForm.parse(value)));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-muted">{t('users.newIntro')}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <form.Field name="username">
        {(field) => (
          <TextInput
            field={field}
            label={t('field.username')}
            hint={t('field.usernameHint')}
            autoComplete="off"
            required
          />
        )}
      </form.Field>
      <form.Field name="displayName">
        {(field) => (
          <TextInput field={field} label={t('field.displayName')} autoComplete="off" required />
        )}
      </form.Field>
      <form.Field name="isAdmin">
        {(field) => (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={field.state.value}
              onChange={(e) => {
                field.handleChange(e.target.checked);
              }}
            />
            {t('users.makeAdminField')}
          </label>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <div className="flex justify-end gap-2">
            <Button onClick={onCancel} disabled={isSubmitting}>
              {t('users.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {t('users.create')}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
