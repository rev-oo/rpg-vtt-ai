import { useForm } from '@tanstack/react-form';
import { useState, type ReactElement } from 'react';
import { useRevalidator } from 'react-router';

import { changePasswordBody, MIN_PASSWORD_LENGTH, updateMeBody } from '@vtt/shared/api';
import { Alert, Button, Card } from '@vtt/ui';

import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/errors.js';
import { TextInput } from '../forms/fields.js';
import { t } from '../i18n/index.js';
import { storeUser } from '../shell/session.js';
import { useSession } from '../shell/use-session.js';

type Status = { tone: 'error' | 'success'; message: string } | null;

function StatusAlert({ status }: { status: Status }): ReactElement | null {
  if (!status) return null;
  return status.tone === 'error' ? (
    <Alert tone="error">{status.message}</Alert>
  ) : (
    <Alert>{status.message}</Alert>
  );
}

/** Display name and password (FR-AUTH-05). */
export default function AccountRoute(): ReactElement {
  const { user } = useSession();
  const revalidator = useRevalidator();
  const [profileStatus, setProfileStatus] = useState<Status>(null);
  const [passwordStatus, setPasswordStatus] = useState<Status>(null);

  const profile = useForm({
    defaultValues: { displayName: user?.displayName ?? '' },
    validators: { onChange: updateMeBody, onSubmit: updateMeBody },
    onSubmit: async ({ value }) => {
      setProfileStatus(null);
      try {
        storeUser(await api.updateMe(updateMeBody.parse(value)));
        await revalidator.revalidate();
        setProfileStatus({ tone: 'success', message: t('account.profileSaved') });
      } catch (caught) {
        setProfileStatus({ tone: 'error', message: errorMessage(caught) });
      }
    },
  });

  const password = useForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    validators: { onChange: changePasswordBody, onSubmit: changePasswordBody },
    onSubmit: async ({ value, formApi }) => {
      setPasswordStatus(null);
      try {
        await api.changePassword(value);
        if (user) storeUser({ ...user, mustChangePassword: false });
        await revalidator.revalidate();
        formApi.reset();
        setPasswordStatus({ tone: 'success', message: t('account.passwordChanged') });
      } catch (caught) {
        setPasswordStatus({ tone: 'error', message: errorMessage(caught) });
      }
    },
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('account.title')}</h1>
      {user?.mustChangePassword && <Alert tone="info">{t('account.mustChangePassword')}</Alert>}

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('account.profile')}</h2>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void profile.handleSubmit();
          }}
        >
          <StatusAlert status={profileStatus} />
          <profile.Field name="displayName">
            {(field) => <TextInput field={field} label={t('field.displayName')} required />}
          </profile.Field>
          <div>
            <profile.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  {t('account.saveProfile')}
                </Button>
              )}
            </profile.Subscribe>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('account.changePassword')}</h2>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void password.handleSubmit();
          }}
        >
          <StatusAlert status={passwordStatus} />
          <password.Field name="currentPassword">
            {(field) => (
              <TextInput
                field={field}
                label={t('account.currentPassword')}
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </password.Field>
          <password.Field name="newPassword">
            {(field) => (
              <TextInput
                field={field}
                label={t('account.newPassword')}
                hint={t('field.passwordHint', { min: MIN_PASSWORD_LENGTH })}
                type="password"
                autoComplete="new-password"
                required
              />
            )}
          </password.Field>
          <div>
            <password.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {t('account.changePassword')}
                </Button>
              )}
            </password.Subscribe>
          </div>
        </form>
      </Card>
    </div>
  );
}
