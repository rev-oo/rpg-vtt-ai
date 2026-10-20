import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';
import { redirect, useNavigate, useSearchParams } from 'react-router';

import { Alert, Button, Card } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { TextInput } from '../forms/fields.js';
import { loginSchema } from '../forms/schemas.js';
import { t } from '../i18n/index.js';
import { guestRedirect } from '../shell/access.js';
import { safeNext } from '../shell/next.js';
import { loadSession, storeSession } from '../shell/session.js';

import type { Route } from './+types/login';

export async function clientLoader({ request }: Route.ClientLoaderArgs): Promise<Response | null> {
  const to = guestRedirect(await loadSession(), new URL(request.url));
  return to ? redirect(to) : null;
}

export default function LoginRoute(): ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { username: '', password: '' },
    validators: { onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        storeSession(await api.login(loginSchema.parse(value)));
        await navigate(safeNext(params.get('next')), { replace: true });
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
  });

  return (
    <main className="grid min-h-screen place-items-center content-center gap-4 p-4">
      <Card className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-2xl font-bold">{t('login.title')}</h1>
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
                autoComplete="username"
                required
              />
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <TextInput
                field={field}
                label={t('field.password')}
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {t('login.submit')}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </Card>
    </main>
  );
}
