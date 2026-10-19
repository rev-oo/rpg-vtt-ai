import { useState, type ReactElement } from 'react';

import { Alert, Button, Card, TextField } from '@vtt/ui';

import { api } from '../../api/endpoints.js';
import { t } from '../../i18n/index.js';
import { useSession } from '../../shell/session-store.js';

import { useSubmit } from './useSubmit.js';

export function LoginPage(): ReactElement {
  const signedIn = useSession((s) => s.signedIn);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const { busy, error, onSubmit } = useSubmit(async () => {
    // RequireGuest then continues to `?next=`.
    signedIn(await api.login({ username, password }));
  });

  return (
    <main className="min-h-screen grid place-items-center content-center gap-4 p-4">
      <Card className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-2xl font-bold">{t('login.title')}</h1>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {error && <Alert tone="error">{error}</Alert>}
          <TextField
            label={t('field.username')}
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
          />
          <TextField
            label={t('field.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            {t('login.submit')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
