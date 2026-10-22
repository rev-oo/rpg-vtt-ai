import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from '@playwright/test';

/** The instance admin that the first-run test creates. */
export const ADMIN = { username: 'admin', displayName: 'Game Admin', password: 'e2e-password-1' };

/** A browser context signed in through the API; its pages share the session cookie. */
export interface SignedIn {
  context: BrowserContext;
  csrf: string;
  userId: string;
}

async function json<T>(response: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

export async function signIn(
  browser: Browser,
  credentials: { username: string; password: string },
): Promise<SignedIn> {
  const context = await browser.newContext();
  const session = await json<{ user: { id: string }; csrfToken: string }>(
    await context.request.post('/api/v1/auth/login', { data: credentials }),
  );
  return { context, csrf: session.csrfToken, userId: session.user.id };
}

export function post<T>(who: SignedIn, path: string, data: unknown = {}): Promise<T> {
  return who.context.request
    .post(`/api/v1${path}`, { data, headers: { 'x-csrf-token': who.csrf } })
    .then((response) => json<T>(response));
}

export function patch<T>(who: SignedIn, path: string, data: unknown): Promise<T> {
  return who.context.request
    .patch(`/api/v1${path}`, { data, headers: { 'x-csrf-token': who.csrf } })
    .then((response) => json<T>(response));
}

/**
 * Has the admin create a user, then signs that user in and replaces the one-time password
 * (FR-AUTH-02), so the app does not stop at the password change page.
 */
export async function createPlayer(
  browser: Browser,
  admin: SignedIn,
  username: string,
  displayName: string,
): Promise<SignedIn> {
  const { oneTimePassword } = await post<{ oneTimePassword: string }>(admin, '/users', {
    username,
    displayName,
  });
  const player = await signIn(browser, { username, password: oneTimePassword });
  const password = `${username}-password-1`;
  const changed = await player.context.request.post('/api/v1/me/password', {
    data: { currentPassword: oneTimePassword, newPassword: password },
    headers: { 'x-csrf-token': player.csrf },
  });
  expect(changed.status()).toBe(204);
  // Changing the password keeps this session but rotates nothing else; sign in again for a
  // clean state.
  return signIn(browser, { username, password });
}
