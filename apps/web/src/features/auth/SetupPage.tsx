import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';

import { Alert, Button, Card, TextField } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { t } from '../../i18n/index.js';
import { useSession } from '../../shell/session-store.js';

import { MIN_PASSWORD_LENGTH } from './constants.js';
import { useSubmit } from './useSubmit.js';

/** First-run setup: creates the instance admin (FR-AUTH-01). */
export function SetupPage(): ReactElement {
  const signedIn = useSession((s) => s.signedIn);
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');

  const { busy, error, onSubmit } = useSubmit(async () => {
    signedIn(await api.setupAdmin({ username, displayName, password }));
    void navigate('/', { replace: true });
  });

  return (
    <main className="min-h-screen grid place-items-center content-center gap-4 p-4">
      <Card className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-2xl font-bold">{t('setup.title')}</h1>
        <p>{t('setup.intro')}</p>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {error && <Alert tone="error">{error}</Alert>}
          <TextField
            label={t('field.username')}
            hint={t('field.usernameHint')}
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_.\-]+"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
          />
          <TextField
            label={t('field.displayName')}
            name="displayName"
            autoComplete="nickname"
            required
            maxLength={64}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
          />
          <TextField
            label={t('field.password')}
            hint={t('field.passwordHint', { min: MIN_PASSWORD_LENGTH })}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            {t('setup.submit')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
