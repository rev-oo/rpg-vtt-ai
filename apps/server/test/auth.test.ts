import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { users } from '../src/db/schema.js';
import { LoginThrottle } from '../src/domain/auth/login-throttle.js';

import { ADMIN, authHeaders, clientFrom, createTestApp, login, setupAdmin } from './support/app.js';

async function setup(options: Parameters<typeof createTestApp>[0] = {}) {
  const t = await createTestApp(options);
  const admin = await setupAdmin(t.app);
  return { ...t, admin };
}

const me = (app: Awaited<ReturnType<typeof setup>>['app'], headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/api/v1/me', headers });

describe('login (FR-AUTH-03, FR-AUTH-04)', () => {
  it('logs in with the right password, case-insensitively by username', async () => {
    const { app } = await setup();
    const res = await login(app, { username: 'ADMIN', password: ADMIN.password });

    expect(res.statusCode).toBe(200);
    const client = clientFrom(res);
    const current = await me(app, authHeaders(client));
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      user: { username: 'admin', isAdmin: true },
      csrfToken: client.csrfToken,
    });
  });

  it('rotates the session: the cookie sent with login stops working', async () => {
    const { app, admin } = await setup();
    const res = await login(app, ADMIN, authHeaders(admin));
    const fresh = clientFrom(res);

    expect(fresh.cookie).not.toBe(admin.cookie);
    expect((await me(app, authHeaders(admin))).statusCode).toBe(401);
    expect((await me(app, authHeaders(fresh))).statusCode).toBe(200);
  });

  it('rejects a wrong password and an unknown user with the same response', async () => {
    const { app } = await setup();
    const wrongPassword = await login(app, { username: 'admin', password: 'nope-nope' });
    const unknownUser = await login(app, { username: 'ghost', password: 'nope-nope' });

    for (const res of [wrongPassword, unknownUser]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: 'invalid_credentials', message: 'Wrong username or password.' },
      });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('refuses disabled accounts even with the right password', async () => {
    const { app, db } = await setup();
    db.update(users).set({ disabledAt: new Date() }).where(eq(users.username, 'admin')).run();

    const res = await login(app, ADMIN);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'account_disabled' } });
  });
});

describe('login rate limiting (FR-AUTH-07)', () => {
  const throttle = () =>
    new LoginThrottle({
      perIp: { max: 4, windowMs: 60_000 },
      perUsername: { max: 2, windowMs: 60_000 },
    });

  it('limits failed attempts per username, even with the right password afterwards', async () => {
    const { app } = await setup({ loginThrottle: throttle() });
    await login(app, { username: 'admin', password: 'wrong-1' });
    await login(app, { username: 'admin', password: 'wrong-2' });

    const res = await login(app, ADMIN);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect(res.headers['retry-after']).toBe('60');
  });

  it('limits failed attempts per IP across usernames', async () => {
    const { app } = await setup({ loginThrottle: throttle() });
    for (const username of ['a', 'b', 'c', 'd']) {
      await login(app, { username, password: 'wrong-pass' });
    }
    expect((await login(app, ADMIN)).statusCode).toBe(429);
  });

  it('uses X-Forwarded-For for the client IP only when TRUST_PROXY is set', async () => {
    for (const [trustProxy, expected] of [
      ['true', 200],
      ['false', 429],
    ] as const) {
      const { app } = await setup({ env: { TRUST_PROXY: trustProxy }, loginThrottle: throttle() });
      for (const username of ['a', 'b', 'c', 'd']) {
        await login(app, { username, password: 'wrong' }, { 'x-forwarded-for': '10.0.0.1' });
      }
      const res = await login(app, ADMIN, { 'x-forwarded-for': '10.0.0.2' });
      expect(res.statusCode).toBe(expected);
    }
  });
});

describe('me and logout', () => {
  it('returns 401 for /me without a session', async () => {
    const { app } = await setup();
    const res = await me(app, {});
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'unauthenticated' } });
  });

  it('logs out: clears the cookie and invalidates the session', async () => {
    const { app, admin } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authHeaders(admin),
    });

    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/^vtt_session=;.*Max-Age=0/);
    expect((await me(app, authHeaders(admin))).statusCode).toBe(401);
  });

  it('rejects logout without the CSRF token', async () => {
    const { app, admin } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authHeaders(admin, { csrf: false }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'csrf_failed' } });
    expect((await me(app, authHeaders(admin))).statusCode).toBe(200);
  });

  it('rejects a CSRF token from another session', async () => {
    const { app, admin } = await setup();
    const other = clientFrom(await login(app, ADMIN));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: admin.cookie, 'x-csrf-token': other.csrfToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it('changes the display name (FR-AUTH-05)', async () => {
    const { app, admin } = await setup();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: authHeaders(admin),
      payload: { displayName: '  Game Master  ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { displayName: 'Game Master' } });
  });
});

describe('password change (FR-AUTH-05)', () => {
  const change = (
    app: Awaited<ReturnType<typeof setup>>['app'],
    headers: Record<string, string>,
    payload: Record<string, string>,
  ) => app.inject({ method: 'POST', url: '/api/v1/me/password', headers, payload });

  it('changes the password and signs out other sessions only', async () => {
    const { app, admin } = await setup();
    const otherDevice = clientFrom(await login(app, ADMIN));

    const res = await change(app, authHeaders(admin), {
      currentPassword: ADMIN.password,
      newPassword: 'brand-new-password',
    });
    expect(res.statusCode).toBe(204);
    expect((await me(app, authHeaders(admin))).statusCode).toBe(200);
    expect((await me(app, authHeaders(otherDevice))).statusCode).toBe(401);
    expect((await login(app, ADMIN)).statusCode).toBe(401);
    expect(
      (await login(app, { username: 'admin', password: 'brand-new-password' })).statusCode,
    ).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    const { app, admin } = await setup();
    const res = await change(app, authHeaders(admin), {
      currentPassword: 'not-it-at-all',
      newPassword: 'brand-new-password',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'wrong_password' } });
  });

  it('counts wrong current passwords as failed logins (T-0701)', async () => {
    const { app, admin } = await setup();
    for (let i = 0; i < 5; i += 1) {
      const res = await change(app, authHeaders(admin), {
        currentPassword: 'not-it-at-all',
        newPassword: 'brand-new-password',
      });
      expect(res.statusCode).toBe(400);
    }
    const res = await change(app, authHeaders(admin), {
      currentPassword: ADMIN.password,
      newPassword: 'brand-new-password',
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect((await login(app, ADMIN)).statusCode).toBe(429);
  });

  it('rejects a missing CSRF token', async () => {
    const { app, admin } = await setup();
    const res = await change(app, authHeaders(admin, { csrf: false }), {
      currentPassword: ADMIN.password,
      newPassword: 'brand-new-password',
    });
    expect(res.statusCode).toBe(403);
  });

  it('clears the must-change-password flag', async () => {
    const { app, db, admin } = await setup();
    db.update(users).set({ mustChangePassword: true }).run();
    await change(app, authHeaders(admin), {
      currentPassword: ADMIN.password,
      newPassword: 'brand-new-password',
    });
    expect(db.select().from(users).get()?.mustChangePassword).toBe(false);
  });
});
