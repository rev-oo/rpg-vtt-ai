import { t, type MessageKey } from '../i18n/index.js';

import { ApiError } from './client.js';

const MESSAGES: Partial<Record<string, MessageKey>> = {
  invalid_credentials: 'login.invalidCredentials',
  account_disabled: 'login.disabled',
  wrong_password: 'account.wrongPassword',
  system_unavailable: 'createTable.systemUnavailable',
  invalid_speaker: 'chat.invalidSpeaker',
  invalid_recipient: 'chat.invalidRecipient',
  invalid_archive: 'plugins.invalidArchive',
  invalid_plugin: 'plugins.invalidPlugin',
};

/** A user-facing message for a failed request. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t('app.error');
  if (error.code === 'rate_limited') {
    return t('login.rateLimited', { seconds: error.retryAfterSeconds ?? 60 });
  }
  const key = MESSAGES[error.code];
  if (key) return t(key);
  // Validation and conflict messages from the server are already user-facing.
  return error.status < 500 ? error.message : t('app.error');
}
