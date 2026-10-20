import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request, requestNoContent, setCsrfToken } from '../src/api/client.js';
import { errorMessage } from '../src/api/errors.js';
import { setupStatusSchema } from '../src/api/schemas.js';
import { t } from '../src/i18n/index.js';
import { guestRedirect, setupRedirect, userRedirect } from '../src/shell/access.js';
import { safeNext } from '../src/shell/next.js';
import type { SessionState } from '../src/shell/session.js';

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

describe('route access', () => {
  const user = { id: 'u1', username: 'alice', displayName: 'Alice', isAdmin: false };
  const fresh: SessionState = { needsSetup: true, user: null };
  const anonymous: SessionState = { needsSetup: false, user: null };
  const signedIn: SessionState = {
    needsSetup: false,
    user: { ...user, mustChangePassword: false },
  };
  const mustChange: SessionState = {
    needsSetup: false,
    user: { ...user, mustChangePassword: true },
  };
  const url = (path: string) => new URL(path, 'http://vtt.test');

  it('allows setup only on a fresh instance', () => {
    expect(setupRedirect(fresh)).toBeNull();
    expect(setupRedirect(anonymous)).toBe('/');
  });

  it('sends signed-in visitors from login to ?next', () => {
    expect(guestRedirect(fresh, url('/login'))).toBe('/setup');
    expect(guestRedirect(anonymous, url('/login'))).toBeNull();
    expect(guestRedirect(signedIn, url('/login?next=%2Faccount'))).toBe('/account');
    expect(guestRedirect(signedIn, url('/login?next=//evil.example'))).toBe('/');
  });

  it('requires a user and a permanent password for the app', () => {
    expect(userRedirect(fresh, url('/'))).toBe('/setup');
    expect(userRedirect(anonymous, url('/account?tab=1'))).toBe('/login?next=%2Faccount%3Ftab%3D1');
    expect(userRedirect(mustChange, url('/'))).toBe('/account');
    expect(userRedirect(mustChange, url('/account'))).toBeNull();
    expect(userRedirect(signedIn, url('/'))).toBeNull();
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
