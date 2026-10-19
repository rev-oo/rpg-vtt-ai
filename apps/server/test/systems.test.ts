import { describe, expect, it } from 'vitest';

import { authHeaders, createTestApp, createUserClient, setupAdmin } from './support/app.js';
import { insertPlugin } from './support/fixtures.js';

describe('GET /api/v1/systems', () => {
  it('lists enabled system plugins by name to any signed-in user', async () => {
    const { app, db } = await createTestApp();
    insertPlugin(db, { id: 'zeta', name: 'Zeta RPG', version: '2.0.0' });
    insertPlugin(db, { id: 'alpha', name: 'Alpha RPG', version: '1.0.0' });
    insertPlugin(db, { id: 'off', name: 'Disabled RPG', enabled: false });
    const admin = await setupAdmin(app);
    const { client } = await createUserClient(app, admin, 'alice');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/systems',
      headers: authHeaders(client),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      systems: [
        { id: 'alpha', name: 'Alpha RPG', version: '1.0.0' },
        { id: 'zeta', name: 'Zeta RPG', version: '2.0.0' },
      ],
    });
  });

  it('requires a session', async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/systems' })).statusCode).toBe(401);
  });
});
