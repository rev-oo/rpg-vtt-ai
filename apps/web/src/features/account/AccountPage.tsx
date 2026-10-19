import { useState, type ReactElement } from 'react';

import { Alert, Button, Card, TextField } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { t } from '../../i18n/index.js';
import { useSession } from '../../shell/session-store.js';
import { MIN_PASSWORD_LENGTH } from '../auth/constants.js';
import { useSubmit } from '../auth/useSubmit.js';

/** Display name and password (FR-AUTH-05). */
export function AccountPage(): ReactElement {
  const user = useSession((s) => s.user);
  const userUpdated = useSession((s) => s.userUpdated);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [profileSaved, setProfileSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordChanged, setPasswordChanged] = useState(false);

  const profile = useSubmit(async () => {
    setProfileSaved(false);
    userUpdated(await api.updateMe({ displayName }));
    setProfileSaved(true);
  });

  const password = useSubmit(async () => {
    setPasswordChanged(false);
    await api.changePassword({ currentPassword, newPassword });
    if (user) userUpdated({ ...user, mustChangePassword: false });
    setCurrentPassword('');
    setNewPassword('');
    setPasswordChanged(true);
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('account.title')}</h1>
      {user?.mustChangePassword && <Alert tone="info">{t('account.mustChangePassword')}</Alert>}

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('account.profile')}</h2>
        <form className="flex flex-col gap-4" onSubmit={profile.onSubmit}>
          {profile.error && <Alert tone="error">{profile.error}</Alert>}
          {profileSaved && <Alert>{t('account.profileSaved')}</Alert>}
          <TextField
            label={t('field.displayName')}
            name="displayName"
            required
            maxLength={64}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
          />
          <div>
            <Button type="submit" disabled={profile.busy}>
              {t('account.saveProfile')}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('account.changePassword')}</h2>
        <form className="flex flex-col gap-4" onSubmit={password.onSubmit}>
          {password.error && <Alert tone="error">{password.error}</Alert>}
          {passwordChanged && <Alert>{t('account.passwordChanged')}</Alert>}
          <TextField
            label={t('account.currentPassword')}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
            }}
          />
          <TextField
            label={t('account.newPassword')}
            hint={t('field.passwordHint', { min: MIN_PASSWORD_LENGTH })}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
            }}
          />
          <div>
            <Button type="submit" variant="primary" disabled={password.busy}>
              {t('account.changePassword')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
