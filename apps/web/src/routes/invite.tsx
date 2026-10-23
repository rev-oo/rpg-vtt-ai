import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';
import { Link, redirect, useNavigate } from 'react-router';

import {
  MIN_PASSWORD_LENGTH,
  signupBody,
  type InstanceInfo,
  type InvitePreview as Preview,
} from '@vtt/shared/api';
import { Alert, Button, Card } from '@vtt/ui';

import { ApiError } from '../api/client.js';
import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { TextInput } from '../forms/fields.js';
import { t } from '../i18n/index.js';
import { invalidateSession, loadSession, storeSession } from '../shell/session.js';

import type { Route } from './+types/invite';

type InviteData =
  | { kind: 'join'; preview: Preview }
  | { kind: 'signup'; preview: Preview; instance: InstanceInfo }
  /** Signed out on an instance without sign-up: the visitor signs in first. */
  | { kind: 'login' }
  | { kind: 'error'; error: string };

function inviteError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'invite_revoked') return t('invite.revoked');
    if (error.code === 'invite_expired') return t('invite.expired');
    if (error.status === 404 || error.status === 400) return t('invite.notFound');
  }
  return errorMessage(error);
}

/** Where a table invite link leads (FR-TABLE-03); signed-out visitors may sign up there. */
export async function clientLoader({
  params,
}: Route.ClientLoaderArgs): Promise<InviteData | Response> {
  const session = await loadSession();
  if (session.needsSetup) return redirect('/setup');
  try {
    if (session.user) return { kind: 'join', preview: await api.previewInvite(params.token) };
    const instance = await api.instanceInfo();
    if (instance.registration !== 'invite') return { kind: 'login' };
    return { kind: 'signup', preview: await api.previewInvite(params.token), instance };
  } catch (error) {
    return { kind: 'error', error: inviteError(error) };
  }
}

export default function InviteRoute({ loaderData, params }: Route.ComponentProps): ReactElement {
  const next = `/login?next=${encodeURIComponent(`/invite/${params.token}`)}`;
  return (
    <main className="grid min-h-screen place-items-center content-center gap-4 p-4">
      <Card className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-2xl font-bold">{t('invite.title')}</h1>
        {loaderData.kind === 'error' && (
          <>
            <Alert tone="error">{loaderData.error}</Alert>
            <Link to="/">{t('table.back')}</Link>
          </>
        )}
        {loaderData.kind === 'login' && (
          <>
            <p>{t('invite.signInFirst')}</p>
            <Link to={next}>{t('invite.signIn')}</Link>
          </>
        )}
        {loaderData.kind === 'join' && <Join token={params.token} preview={loaderData.preview} />}
        {loaderData.kind === 'signup' && (
          <>
            <p>
              {t('invite.intro', {
                table: loaderData.preview.table.name,
                role: t(`tables.role.${loaderData.preview.role}`),
              })}
            </p>
            <Signup token={params.token} />
            <p className="text-sm">
              {t('invite.haveAccount')} <Link to={next}>{t('invite.signIn')}</Link>
            </p>
          </>
        )}
      </Card>
    </main>
  );
}

function Join({ token, preview }: { token: string; preview: Preview }): ReactElement {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const table = await api.acceptInvite(token);
      await navigate(`/tables/${table.id}`, { replace: true });
    } catch (caught) {
      setError(inviteError(caught));
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        {t('invite.intro', {
          table: preview.table.name,
          role: t(`tables.role.${preview.role}`),
        })}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <Button variant="primary" disabled={busy} onClick={() => void join()}>
        {t('invite.join')}
      </Button>
    </>
  );
}

/** A new account that joins the table at once (FR-ADMIN-01). */
function Signup({ token }: { token: string }): ReactElement {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { username: '', displayName: '', password: '' },
    validators: { onChange: signupBody, onSubmit: signupBody },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { table, ...session } = await api.signup(token, signupBody.parse(value));
        storeSession(session);
        await navigate(`/tables/${table.id}`, { replace: true });
      } catch (caught) {
        invalidateSession();
        setError(inviteError(caught));
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
        {(submitting) => (
          <Button type="submit" variant="primary" disabled={submitting}>
            {t('invite.signup')}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
