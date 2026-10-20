import { describe, expect, it } from 'vitest';

import { users } from '../src/db/schema.js';
import { verifyPassword } from '../src/domain/auth/password.js';

import { ADMIN, authHeaders, clientFrom, createTestApp } from './support/app.js';

describe('setup flow (FR-AUTH-01)', () => {
  it('reports that a fresh instance needs setup', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ needsSetup: true });
  });

  it('creates the first user as instance admin and logs them in', async () => {
    const { app, db } = await createTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/setup/admin', payload: ADMIN });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ user: Record<string, unknown>; csrfToken: unknown }>();
    expect(body.user).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      username: 'admin',
      displayName: 'Admin',
      isAdmin: true,
      mustChangePassword: false,
    });
    expect(body.csrfToken).toMatch(/^[\w-]{43}$/);

    const [stored] = db.select().from(users).all();
    expect(stored?.isAdmin).toBe(true);
    expect(await verifyPassword(stored?.passwordHash ?? '', ADMIN.password)).toBe(true);

    const status = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(status.json()).toEqual({ needsSetup: false });
    expect(clientFrom(res).cookie).toMatch(/^vtt_session=/);
  });

  it('returns 409 on the second call', async () => {
    const { app, db } = await createTestApp();
    await app.inject({ method: 'POST', url: '/api/v1/setup/admin', payload: ADMIN });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: { ...ADMIN, username: 'intruder' },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: { code: 'already_set_up', message: 'This instance already has users.' },
    });
    expect(db.select().from(users).all()).toHaveLength(1);
  });

  it('lets only one of two concurrent setup requests win', async () => {
    const { app, db } = await createTestApp();
    const results = await Promise.all(
      ['first', 'second'].map((username) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/setup/admin',
          payload: { ...ADMIN, username },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(db.select().from(users).all()).toHaveLength(1);
  });

  it.each([
    [{ ...ADMIN, username: 'no spaces' }, 'username'],
    [{ ...ADMIN, username: 'ab' }, 'username'],
    [{ ...ADMIN, password: 'short' }, 'password'],
    [{ ...ADMIN, displayName: '   ' }, 'displayName'],
    [{ username: 'admin' }, 'password'],
  ])('rejects invalid input %j', async (payload, field) => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/setup/admin', payload });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; details: { path: string }[] } }>();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.map((d) => d.path)).toContain(field);
  });

  it('words validation errors in English', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: { username: 'a!', displayName: ' ', password: 'short' },
    });
    const body = res.json<{ error: { details: { path: string; message: string }[] } }>();
    expect(body.error.details).toEqual([
      { path: 'username', message: '3–32 characters: letters, digits, "_", "." or "-".' },
      { path: 'displayName', message: 'Required.' },
      { path: 'password', message: 'Must be at least 8 characters.' },
    ]);
  });

  it('rejects non-JSON bodies, which a cross-site form could send', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify(ADMIN),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('requires the CSRF token for mutating requests made with a session', async () => {
    const { app } = await createTestApp();
    const admin = clientFrom(
      await app.inject({ method: 'POST', url: '/api/v1/setup/admin', payload: ADMIN }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/admin',
      payload: ADMIN,
      headers: authHeaders(admin, { csrf: false }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'csrf_failed' } });
  });
});
