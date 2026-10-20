import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';
import { redirect, useNavigate } from 'react-router';

import { Alert, Button, Card } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { TextInput } from '../forms/fields.js';
import { MIN_PASSWORD_LENGTH, setupSchema } from '../forms/schemas.js';
import { t } from '../i18n/index.js';
import { setupRedirect } from '../shell/access.js';
import { loadSession, storeSession } from '../shell/session.js';

export async function clientLoader(): Promise<Response | null> {
  const to = setupRedirect(await loadSession());
  return to ? redirect(to) : null;
}

/** First-run setup: creates the instance admin (FR-AUTH-01). */
export default function SetupRoute(): ReactElement {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { username: '', displayName: '', password: '' },
    validators: { onChange: setupSchema, onSubmit: setupSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        storeSession(await api.setupAdmin(setupSchema.parse(value)));
        await navigate('/', { replace: true });
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
  });

  return (
    <main className="grid min-h-screen place-items-center content-center gap-4 p-4">
      <Card className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-2xl font-bold">{t('setup.title')}</h1>
        <p>{t('setup.intro')}</p>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {error && <Alert tone="error">{error}</Alert>}
          <form.Field name="username">
            {(field) => (
              <TextInput
                field={field}
                label={t('field.username')}
                hint={t('field.usernameHint')}
                autoComplete="username"
                required
              />
            )}
          </form.Field>
          <form.Field name="displayName">
            {(field) => (
              <TextInput
                field={field}
                label={t('field.displayName')}
                autoComplete="nickname"
                required
              />
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <TextInput
                field={field}
                label={t('field.password')}
                hint={t('field.passwordHint', { min: MIN_PASSWORD_LENGTH })}
                type="password"
                autoComplete="new-password"
                required
              />
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {t('setup.submit')}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </Card>
    </main>
  );
}
