import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request, requestNoContent, setCsrfToken } from '../src/api/client.js';
import { errorMessage } from '../src/api/errors.js';
import { setupStatusSchema } from '../src/api/schemas.js';
import { t } from '../src/i18n/index.js';
import { safeNext } from '../src/shell/next.js';

import { fakeApi } from './support/fake-api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('t()', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(t('nav.signedInAs', { name: 'Alice' })).toBe('Signed in as Alice');
    expect(t('nav.signedInAs')).toBe('Signed in as {name}');
  });
});

describe('safeNext', () => {
  it.each([
    ['/account', '/account'],
    ['/?a=1', '/?a=1'],
    [null, '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('API client', () => {
  it('sends the CSRF token on mutating requests only', async () => {
    const { calls } = fakeApi({
      'GET /setup/status': { body: { needsSetup: false } },
      'POST /auth/logout': { status: 204 },
    });
    setCsrfToken('tok');
    await request('GET', '/setup/status', setupStatusSchema);
    await requestNoContent('POST', '/auth/logout');

    expect(calls[0]?.headers.get('x-csrf-token')).toBeNull();
    expect(calls[1]?.headers.get('x-csrf-token')).toBe('tok');
  });

  it('turns error envelopes into ApiError with Retry-After', async () => {
    fakeApi({
      'POST /auth/login': {
        status: 429,
        headers: { 'retry-after': '42' },
        body: { error: { code: 'rate_limited', message: 'Slow down' } },
      },
    });
    const error = await requestNoContent('POST', '/auth/login', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfterSeconds: 42 });
    expect(errorMessage(error)).toBe('Too many failed attempts. Try again in 42 seconds.');
  });

  it('rejects responses that do not match the schema', async () => {
    fakeApi({ 'GET /setup/status': { body: { needsSetup: 'yes' } } });
    await expect(request('GET', '/setup/status', setupStatusSchema)).rejects.toThrow();
  });

  it('maps codes to friendly messages and hides server errors', () => {
    expect(errorMessage(new ApiError(401, 'invalid_credentials', 'x'))).toBe(
      'Wrong username or password.',
    );
    expect(errorMessage(new ApiError(409, 'username_taken', 'That username is taken.'))).toBe(
      'That username is taken.',
    );
    expect(errorMessage(new ApiError(500, 'internal_error', 'stack trace'))).toBe(
      'Something went wrong. Please try again.',
    );
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
